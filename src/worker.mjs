import { createRemoteJWKSet, jwtVerify } from 'jose';
import calculationService from '../backend/services/calculation-service.js';
import sectionsService from '../backend/services/sections-service.js';
import validationService from '../backend/services/validation-service.js';
import reportService from '../backend/services/report-service.js';
import specialSectionService from '../backend/services/special-section-service.js';

const { calculateBeam } = calculationService;
const {
  listSectionFamilies,
  listPublicSections,
  listFrame3dSections,
  getSectionById,
  buildSectionPreview,
  buildSectionSourceIndex
} = sectionsService;
const { validateCalculationRequest } = validationService;
const { buildReportHtml, buildLatexReport, buildHandCalculationPdf } = reportService;
const { listSpecialSectionOptions, resolveSpecialSectionDefinition } = specialSectionService;

const VERSION = '1.0.0';
const ALLOWED_ORIGINS = new Set([
  'https://beam-calculator.pages.dev',
  'https://beamcalculatorstudio.com',
  'https://codex-frame3d-foundation-v1.beam-calculator.pages.dev',
  'https://codex-fea-platform-spike.beam-calculator.pages.dev',
  'http://localhost:8787',
  'http://localhost:8765',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:8787',
  'http://127.0.0.1:8765',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173'
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://beam-calculator.pages.dev';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function jsonResponse(request, status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
      ...headers
    }
  });
}

function textResponse(request, status, body, contentType) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      ...corsHeaders(request)
    }
  });
}

function binaryResponse(request, status, body, contentType, filename) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      ...corsHeaders(request)
    }
  });
}

async function readJson(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const err = new Error('Request body must be application/json.');
    err.statusCode = 415;
    throw err;
  }
  try {
    return await request.json();
  } catch {
    const err = new Error('Malformed JSON request.');
    err.statusCode = 400;
    throw err;
  }
}

function isCadFemPath(pathname) {
  return pathname === '/api/cad/projects' ||
    pathname.startsWith('/api/cad/projects/') ||
    pathname.startsWith('/api/fea/studies/') ||
    pathname.startsWith('/api/jobs/');
}

const jwksCache = new Map();

function accessConfiguration(env) {
  const teamDomain = String(env?.CF_ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const audience = String(env?.CF_ACCESS_AUD || '');
  if (!teamDomain || !audience) return null;
  return {
    teamDomain,
    audience,
    issuer: `https://${teamDomain}`
  };
}

async function cadFemIdentity(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  const configuration = accessConfiguration(env);
  if (!token || !configuration) return null;
  let jwks = jwksCache.get(configuration.teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${configuration.issuer}/cdn-cgi/access/certs`));
    jwksCache.set(configuration.teamDomain, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, {
    issuer: configuration.issuer,
    audience: configuration.audience
  });
  if (!payload.sub || !payload.email) return null;
  return {
    subject: String(payload.sub),
    email: String(payload.email),
    name: typeof payload.name === 'string' ? payload.name : ''
  };
}

export function buildCadFemUpstreamRequest(request, {
  hasServiceBinding,
  originUrl,
  gatewayToken,
  identity
}) {
  const publicUrl = new URL(request.url);
  const upstreamUrl = hasServiceBinding
    ? publicUrl
    : new URL(`${publicUrl.pathname}${publicUrl.search}`, originUrl);
  const upstreamRequest = new Request(upstreamUrl, request);
  upstreamRequest.headers.delete('Authorization');
  upstreamRequest.headers.delete('Cookie');
  upstreamRequest.headers.delete('Cf-Access-Jwt-Assertion');
  upstreamRequest.headers.delete('X-Cad-Fem-Gateway-Token');
  upstreamRequest.headers.delete('X-Beam-User-Subject');
  upstreamRequest.headers.delete('X-Beam-User-Email');
  upstreamRequest.headers.delete('X-Beam-User-Name');
  upstreamRequest.headers.set('X-Cad-Fem-Gateway-Token', gatewayToken);
  upstreamRequest.headers.set('X-Beam-User-Subject', identity.subject);
  upstreamRequest.headers.set('X-Beam-User-Email', identity.email);
  if (identity.name) upstreamRequest.headers.set('X-Beam-User-Name', identity.name);
  return upstreamRequest;
}

async function proxyCadFemRequest(request, env) {
  let identity;
  try {
    identity = await cadFemIdentity(request, env);
  } catch {
    identity = null;
  }
  if (!identity) {
    return jsonResponse(request, 401, {
      ok: false,
      error: {
        code: 'auth_required',
        message: 'Authenticated staging access is required for CAD/FEM project and compute routes.'
      }
    });
  }
  const hasServiceBinding = env?.CAD_FEM_SERVICE && typeof env.CAD_FEM_SERVICE.fetch === 'function';
  const originUrl = String(env?.CAD_FEM_ORIGIN_URL || '');
  if (!hasServiceBinding && !originUrl) {
    return jsonResponse(request, 503, {
      ok: false,
      error: {
        code: 'native_compute_unavailable',
        message: 'The native CAD/FEM service binding is not configured. No browser solver fallback is available.'
      }
    });
  }
  if (!env.CAD_FEM_GATEWAY_TOKEN) {
    return jsonResponse(request, 503, {
      ok: false,
      error: {
        code: 'gateway_unconfigured',
        message: 'The CAD/FEM origin gateway token is not configured.'
      }
    });
  }
  const upstreamRequest = buildCadFemUpstreamRequest(request, {
    hasServiceBinding,
    originUrl,
    gatewayToken: env.CAD_FEM_GATEWAY_TOKEN,
    identity
  });
  const upstream = hasServiceBinding
    ? await env.CAD_FEM_SERVICE.fetch(upstreamRequest)
    : await fetch(upstreamRequest);
  const responseHeaders = new Headers(upstream.headers);
  for (const [name, value] of Object.entries(corsHeaders(request))) {
    responseHeaders.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}

function publicSectionRow(section) {
  const id = publicSectionId(section.designation);
  return {
    ...section,
    id,
    backendId: section.id,
    ok: undefined,
    mass: section.mass_kg_m,
    source: section.sourceName
  };
}

function publicSectionId(designation) {
  return String(designation || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function findSectionFromRouteId(rawId) {
  const id = decodeURIComponent(String(rawId || ''));
  const direct = getSectionById(id);
  if (direct) return direct;
  const match = listPublicSections().find((section) => (
    section.id === id ||
    publicSectionId(section.designation) === id ||
    publicSectionId(`${section.family} ${section.designation}`) === id
  ));
  return match ? getSectionById(match.id) : null;
}

function previewForResponse(section) {
  const preview = buildSectionPreview(section);
  if (!preview) return null;
  const props = preview.visibleProperties || {};
  return {
    ...preview,
    id: publicSectionId(preview.designation),
    backendId: preview.id,
    properties: {
      h: props.h_mm,
      b: props.b_mm,
      tw: props.tw_mm,
      tf: props.tf_mm,
      r: props.r_mm,
      A: props.A_mm2,
      mass: props.mass_kg_m,
      Iy: props.Iy_mm4,
      WelY: props.Wel_y_mm3
    },
    sourceName: preview.source?.title || 'Source to be confirmed'
  };
}

async function route(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method === 'GET' && pathname === '/api/health') {
    return jsonResponse(request, 200, {
      ok: true,
      service: 'Beam Calculator API',
      version: VERSION,
      environment: 'production'
    });
  }

  if (request.method === 'GET' && pathname === '/api/sections') {
    return jsonResponse(request, 200, {
      ok: true,
      families: listSectionFamilies(),
      sections: listPublicSections().map(publicSectionRow)
    });
  }

  if (request.method === 'GET' && pathname === '/api/sections/sources') {
    return jsonResponse(request, 200, {
      ok: true,
      sources: buildSectionSourceIndex()
    });
  }

  if (isCadFemPath(pathname)) {
    return proxyCadFemRequest(request, env);
  }

  if (request.method === 'GET' && pathname === '/api/frame3d/sections') {
    return jsonResponse(request, 200, {
      ok: true,
      sections: listFrame3dSections()
    });
  }

  if (request.method === 'GET' && pathname === '/api/special-sections') {
    return jsonResponse(request, 200, { ok: true, ...listSpecialSectionOptions() });
  }

  if (request.method === 'POST' && pathname === '/api/special-sections/preview') {
    const body = await readJson(request);
    return jsonResponse(request, 200, { ok: true, ...resolveSpecialSectionDefinition(body.sectionDefinition || body) });
  }

  const previewMatch = pathname.match(/^\/api\/sections\/(.+)\/preview$/);
  if (request.method === 'GET' && previewMatch) {
    const section = findSectionFromRouteId(previewMatch[1]);
    if (!section) return jsonResponse(request, 404, { ok: false, error: { code: 'section_not_found', message: 'Selected section was not found.' } });
    return jsonResponse(request, 200, { ok: true, section: previewForResponse(section) });
  }

  if (request.method === 'POST' && pathname === '/api/calculate') {
    const body = await readJson(request);
    validateCalculationRequest(body);
    return jsonResponse(request, 200, { ok: true, ...calculateBeam(body) });
  }

  if (request.method === 'POST' && pathname === '/api/report') {
    const body = await readJson(request);
    const input = body.input || {};
    if (input.section) validateCalculationRequest(input);
    const result = input.section ? calculateBeam(input) : body.result;
    const html = buildReportHtml(input, result || {}, body.metadata || input.metadata || {});
    return textResponse(request, 200, html, 'text/html; charset=utf-8');
  }

  if (request.method === 'POST' && pathname === '/api/hand-calculation') {
    const body = await readJson(request);
    const input = body.input || {};
    if (input.section) validateCalculationRequest(input);
    const result = input.section ? calculateBeam(input) : body.result;
    const pdf = buildHandCalculationPdf(input, result || {}, body.metadata || input.metadata || {});
    return binaryResponse(request, 200, pdf, 'application/pdf', 'beam-hand-calculation.pdf');
  }

  if (request.method === 'POST' && pathname === '/api/report/latex') {
    const body = await readJson(request);
    const input = body.input || {};
    if (input.section) validateCalculationRequest(input);
    const result = input.section ? calculateBeam(input) : body.result;
    const latex = buildLatexReport(input, result || {}, body.metadata || input.metadata || {});
    return textResponse(request, 200, latex, 'application/x-tex; charset=utf-8');
  }

  return jsonResponse(request, 404, {
    ok: false,
    error: {
      code: 'not_found',
      message: 'API endpoint not found.'
    }
  });
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      const status = err.statusCode || 500;
      return jsonResponse(request, status, {
        ok: false,
        error: {
          code: err.code || (status >= 500 ? 'worker_error' : 'request_error'),
          message: status >= 500 ? 'The calculation service could not complete the request.' : err.message
        }
      });
    }
  }
};
