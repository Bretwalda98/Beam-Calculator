const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const { config, requireProductionSecret } = require('./backend/config');
const {
  sendJson,
  sendError,
  setSecurityHeaders,
  applyCors,
  rateLimit,
  parseJsonBody,
  getSession,
  clearSessionCookie,
  requireAuth
} = require('./backend/middleware/http');
const { calculateBeam } = require('./backend/services/calculation-service');
const {
  listSectionFamilies,
  listPublicSections,
  listSectionNames,
  listFrame3dSections,
  getSectionById,
  buildSectionPreview,
  buildSectionSourceIndex
} = require('./backend/services/sections-service');
const { validateCalculationRequest } = require('./backend/services/validation-service');
const { providers, oauthStart, unauthenticatedSession } = require('./backend/auth/auth-service');
const { listProjects, readProject, saveProject, archiveProject } = require('./backend/services/project-service');
const { resultToPdf, buildReportHtml, buildLatexReport, buildHandCalculationPdf } = require('./backend/services/report-service');
const { listSpecialSectionOptions, resolveSpecialSectionDefinition } = require('./backend/services/special-section-service');

requireProductionSecret();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm'
};

function publicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const routeMap = new Map([
    ['/', path.join(config.publicDir, 'index.html')],
    ['/beam', path.join(config.publicDir, 'beam', 'index.html')],
    ['/beam/', path.join(config.publicDir, 'beam', 'index.html')],
    ['/privacy', path.join(config.publicDir, 'privacy', 'index.html')],
    ['/privacy/', path.join(config.publicDir, 'privacy', 'index.html')],
    ['/frame3d', path.join(config.publicDir, 'dist', 'frame3d', 'index.html')],
    ['/frame3d/', path.join(config.publicDir, 'dist', 'frame3d', 'index.html')]
  ]);
  if (routeMap.has(decoded)) return routeMap.get(decoded);
  const safePath = decoded.replace(/^\/+/, '');
  const candidate = path.normalize(safePath);
  if (candidate.startsWith('..') || path.isAbsolute(candidate)) return null;
  if (candidate.includes('backend') || candidate.includes('storage') || candidate.includes('sections-database')) return null;
  if (candidate.startsWith(`public${path.sep}`) || candidate === 'public') {
    return path.join(config.publicDir, candidate);
  }
  if (candidate.startsWith(`frame3d${path.sep}`)) {
    return path.join(config.publicDir, 'dist', candidate);
  }
  if (['ads.txt', 'robots.txt', 'sitemap.xml'].includes(candidate)) return path.join(config.publicDir, candidate);
  return null;
}

async function serveStatic(req, res, pathname) {
  const file = publicPath(pathname);
  if (!file) return sendError(res, 404, 'Not found.', 'not_found');
  const resolved = path.resolve(file);
  const allowedFiles = [
    path.resolve(config.publicDir, 'index.html'),
    path.resolve(config.publicDir, 'beam', 'index.html'),
    path.resolve(config.publicDir, 'privacy', 'index.html'),
    path.resolve(config.publicDir, 'ads.txt'),
    path.resolve(config.publicDir, 'robots.txt'),
    path.resolve(config.publicDir, 'sitemap.xml')
  ];
  const allowedRoots = [
    path.resolve(config.publicDir, 'public'),
    path.resolve(config.publicDir, 'dist', 'frame3d')
  ];
  const isAllowed = allowedFiles.includes(resolved) || allowedRoots.some((root) => resolved.startsWith(`${root}${path.sep}`));
  if (!isAllowed) return sendError(res, 404, 'Not found.', 'not_found');
  try {
    const body = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': body.length });
    res.end(body);
  } catch {
    sendError(res, 404, 'Not found.', 'not_found');
  }
}

async function routeApi(req, res, url) {
  if (!rateLimit(req, res)) return;
  const pathname = url.pathname;
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, env: config.env, version: require('./package.json').version });
    }
    if (req.method === 'GET' && pathname === '/api/auth/providers') {
      return sendJson(res, 200, providers());
    }
    if (req.method === 'GET' && pathname === '/api/auth/session') {
      const session = getSession(req);
      return sendJson(res, 200, session ? { authenticated: true, user: { id: session.userId, email: session.email, name: session.name || '' }, providers: providers() } : unauthenticatedSession());
    }
    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/auth/google/start') {
      return sendJson(res, 200, oauthStart('google'));
    }
    if (req.method === 'GET' && pathname === '/api/auth/apple/start') {
      return sendJson(res, 200, oauthStart('apple'));
    }
    if (req.method === 'POST' && pathname === '/api/auth/email/start') {
      const err = new Error('Email login is not configured. Add SMTP or transactional email settings before enabling this provider.');
      err.statusCode = 501;
      throw err;
    }
    if (req.method === 'DELETE' && pathname === '/api/account') {
      const session = requireAuth(req, res);
      if (!session) return;
      return sendJson(res, 202, { ok: true, message: 'Account deletion request accepted. Production deployment must queue verified data deletion and audit logging.' });
    }
    if (req.method === 'GET' && pathname === '/api/sections') {
      return sendJson(res, 200, { families: listSectionFamilies(), sections: listPublicSections() });
    }
    if (req.method === 'GET' && pathname === '/api/sections/sources') {
      return sendJson(res, 200, { sources: buildSectionSourceIndex() });
    }
    if (req.method === 'GET' && pathname === '/api/frame3d/sections') {
      return sendJson(res, 200, { sections: listFrame3dSections() });
    }
    if (req.method === 'GET' && pathname === '/api/special-sections') {
      return sendJson(res, 200, listSpecialSectionOptions());
    }
    if (req.method === 'POST' && pathname === '/api/special-sections/preview') {
      const body = await parseJsonBody(req);
      return sendJson(res, 200, resolveSpecialSectionDefinition(body.sectionDefinition || body));
    }
    const previewMatch = pathname.match(/^\/api\/sections\/(.+)\/preview$/);
    if (req.method === 'GET' && previewMatch) {
      const section = getSectionById(previewMatch[1]);
      if (!section) return sendError(res, 404, 'Selected section was not found.', 'section_not_found');
      return sendJson(res, 200, { section: buildSectionPreview(section) });
    }
    const familyMatch = pathname.match(/^\/api\/sections\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && familyMatch) {
      return sendJson(res, 200, { family: familyMatch[1].toUpperCase(), sections: listSectionNames(familyMatch[1]) });
    }
    if (req.method === 'POST' && pathname === '/api/calculate') {
      const body = await parseJsonBody(req);
      validateCalculationRequest(body);
      const result = calculateBeam(body);
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && pathname === '/api/pdf') {
      const body = await parseJsonBody(req);
      const input = body.input || {};
      if (input.section) validateCalculationRequest(input);
      const result = input.section ? calculateBeam(input) : (body.result || calculateBeam(input));
      const pdf = resultToPdf(result, body.metadata || input.metadata || {}, input);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="beam-calculation.pdf"',
        'Content-Length': pdf.length
      });
      return res.end(pdf);
    }
    if (req.method === 'POST' && (pathname === '/api/report/html' || pathname === '/api/report')) {
      const body = await parseJsonBody(req);
      const input = body.input || {};
      if (input.section) validateCalculationRequest(input);
      const result = input.section ? calculateBeam(input) : (body.result || calculateBeam(input));
      const html = buildReportHtml(input, result, body.metadata || input.metadata || {});
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'inline; filename="beam-calculation-report.html"',
        'Content-Length': Buffer.byteLength(html)
      });
      return res.end(html);
    }
    if (req.method === 'POST' && pathname === '/api/hand-calculation') {
      const body = await parseJsonBody(req);
      const input = body.input || {};
      if (input.section) validateCalculationRequest(input);
      const result = input.section ? calculateBeam(input) : (body.result || calculateBeam(input));
      const pdf = buildHandCalculationPdf(input, result, body.metadata || input.metadata || {});
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="beam-hand-calculation.pdf"',
        'Content-Length': pdf.length
      });
      return res.end(pdf);
    }
    if (req.method === 'POST' && pathname === '/api/report/latex') {
      const body = await parseJsonBody(req);
      const input = body.input || {};
      if (input.section) validateCalculationRequest(input);
      const result = input.section ? calculateBeam(input) : (body.result || calculateBeam(input));
      const latex = buildLatexReport(input, result, body.metadata || input.metadata || {});
      res.writeHead(200, {
        'Content-Type': 'application/x-tex; charset=utf-8',
        'Content-Disposition': 'attachment; filename="beam-calculation-report.tex"',
        'Content-Length': Buffer.byteLength(latex)
      });
      return res.end(latex);
    }
    if (pathname === '/api/projects' && req.method === 'GET') {
      const session = requireAuth(req, res);
      if (!session) return;
      return sendJson(res, 200, { projects: await listProjects(session.userId) });
    }
    if (pathname === '/api/projects' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const body = await parseJsonBody(req);
      return sendJson(res, 200, { project: await saveProject(session.userId, body) });
    }
    const projectMatch = pathname.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(archive|pdf))?$/i);
    if (projectMatch && req.method === 'GET' && !projectMatch[2]) {
      const session = requireAuth(req, res);
      if (!session) return;
      return sendJson(res, 200, { project: await readProject(session.userId, projectMatch[1]) });
    }
    if (projectMatch && req.method === 'POST' && projectMatch[2] === 'archive') {
      const session = requireAuth(req, res);
      if (!session) return;
      return sendJson(res, 200, { project: await archiveProject(session.userId, projectMatch[1]) });
    }
    if (projectMatch && req.method === 'GET' && projectMatch[2] === 'pdf') {
      const session = requireAuth(req, res);
      if (!session) return;
      const project = await readProject(session.userId, projectMatch[1]);
      const result = project.latestInput ? calculateBeam(project.latestInput) : project.latestResult;
      const pdf = resultToPdf(result, project.metadata, project.latestInput || {});
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${project.id}.pdf"`,
        'Content-Length': pdf.length
      });
      return res.end(pdf);
    }
    return sendError(res, 404, 'API endpoint not found.', 'not_found');
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500 && status !== 501) console.error('[server]', err);
    return sendError(res, status, status >= 500 && status !== 501 ? 'The server could not complete the request.' : err.message, err.code || 'api_error');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const isApi = url.pathname.startsWith('/api/');
  const isFrame3d = url.pathname === '/frame3d' || url.pathname.startsWith('/frame3d/');
  setSecurityHeaders(res, {
    legacyFrontend: !isApi && !isFrame3d,
    frame3dFrontend: isFrame3d
  });
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname.startsWith('/api/')) return routeApi(req, res, url);
  return serveStatic(req, res, url.pathname);
});

if (require.main === module) {
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`Beam Calculator API listening on http://127.0.0.1:${config.port}`);
  });
}

module.exports = { server };
