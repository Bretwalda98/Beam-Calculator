const { createHmac, timingSafeEqual } = require('crypto');
const { config } = require('../config');

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const buckets = new Map();

function sendJson(res, statusCode, body, extraHeaders = {}) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    ...extraHeaders
  });
  res.end(json);
}

function sendError(res, statusCode, message, code = 'request_error') {
  sendJson(res, statusCode, { error: { code, message } });
}

function setSecurityHeaders(res, options = {}) {
  const legacyFrontend = Boolean(options.legacyFrontend);
  const frame3dFrontend = Boolean(options.frame3dFrontend);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  const policy = legacyFrontend ? [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://pagead2.googlesyndication.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "connect-src 'self' https:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ] : frame3dFrontend ? [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ] : [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ];
  res.setHeader('Content-Security-Policy', policy.join('; '));
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
}

function rateLimit(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  const key = `${ip}:${req.url.split('?')[0]}`;
  const now = Date.now();
  const bucket = buckets.get(key) || { reset: now + RATE_LIMIT_WINDOW_MS, count: 0 };
  if (now > bucket.reset) {
    bucket.reset = now + RATE_LIMIT_WINDOW_MS;
    bucket.count = 0;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > RATE_LIMIT_MAX) {
    sendError(res, 429, 'Too many requests. Please wait and try again.', 'rate_limited');
    return false;
  }
  return true;
}

function parseJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error('Malformed JSON request.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function signValue(value) {
  if (!config.sessionSecret) return '';
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function verifySignedValue(value, signature) {
  if (!config.sessionSecret || !value || !signature) return false;
  const expected = signValue(value);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, decodeURIComponent(rest.join('=') || '')];
  }).filter(([key]) => key));
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.beam_session || '';
  const [payload, signature] = token.split('.');
  if (!verifySignedValue(payload, signature)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.userId || !decoded.email) return null;
    return decoded;
  } catch {
    return null;
  }
}

function setSessionCookie(res, session) {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = signValue(payload);
  const secure = config.env === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `beam_session=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}

function clearSessionCookie(res) {
  const secure = config.env === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `beam_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    sendError(res, 401, 'Sign in is required for this action.', 'auth_required');
    return null;
  }
  return session;
}

module.exports = {
  sendJson,
  sendError,
  setSecurityHeaders,
  applyCors,
  rateLimit,
  parseJsonBody,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth
};
