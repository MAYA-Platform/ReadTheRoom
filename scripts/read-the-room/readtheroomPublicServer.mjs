import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyReadTheRoomPolicy,
  buildReadTheRoomArtifacts,
  sanitizeReadTheRoomArtifactsForPublic,
  sanitizeReadTheRoomProfileForPublic
} from './readtheroomPolicy.js';
import {
  buildReadTheRoomCalibrationSessionContract,
  calculateReadTheRoomBehaviorMatchScore,
  createReadTheRoomCalibrationStore
} from './readtheroomCalibrationSession.js';

const VERSION = 'readtheroom_public_server_v1_0';
const HOST = String(process.env.HOST || '127.0.0.1');
const PORT = Number(process.env.PORT || 8877);
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 1000;
const MAX_CHOICES_PER_SESSION = 64;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..', '..');
const publicRoot = path.join(rootDir, 'read-the-room-public-pro');
const publicProfile = sanitizeReadTheRoomProfileForPublic({});
const calibrationStore = createReadTheRoomCalibrationStore({
  rootDir,
  memoryOnly: true,
  allowClientSessionId: false,
  maxSessions: MAX_SESSIONS,
  sessionTtlMs: SESSION_TTL_MS,
  maxChoicesPerSession: MAX_CHOICES_PER_SESSION
});

const API_METHODS = new Map([
  ['/api/health', new Set(['GET'])],
  ['/api/readtheroom/calibration-session', new Set(['GET', 'POST'])],
  ['/api/readtheroom/profile', new Set(['GET'])],
  ['/api/readtheroom/artifacts', new Set(['GET'])],
  ['/api/readtheroom/archetypes', new Set(['GET', 'POST'])],
  ['/api/readtheroom/apply', new Set(['POST'])],
  ['/api/readtheroom/score-movement', new Set(['POST'])]
]);
const STATIC_PREFIXES = [
  '/read-the-room-public-pro/',
  '/read-the-room-public-pro-v3-4/',
  '/readtheroom-public-pro/'
];
const STATIC_ROOTS = new Set([
  '/', '/index.html',
  '/read-the-room-public-pro', '/read-the-room-public-pro/',
  '/read-the-room-public-pro-v3-4', '/read-the-room-public-pro-v3-4/',
  '/readtheroom-public-pro', '/readtheroom-public-pro/'
]);
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8']
]);

function securityHeaders(contentType = null, cacheControl = 'no-store') {
  const headers = {
    'Cache-Control': cacheControl,
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...securityHeaders('application/json; charset=utf-8'),
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders
  });
  res.end(payload);
}

function sendNotFound(res) {
  sendJson(res, 404, { ok: false, error: 'not_found' });
}

function sendMethodNotAllowed(res, methods) {
  sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: [...methods].join(', ') });
}

function sanitizePublicValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizePublicValue);
  if (typeof value === 'object') {
    const safe = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/(?:path|directory|root)$/i.test(key)) continue;
      safe[key] = sanitizePublicValue(entry);
    }
    return safe;
  }
  if (typeof value === 'string') {
    return value.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\s"']+/gi, 'public_local_path');
  }
  return value;
}

function readJson(req) {
  return new Promise((resolve) => {
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      req.resume();
      resolve({ ok: false, status: 413, error: 'payload_too_large' });
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        resolve({ ok: false, status: 413, error: 'payload_too_large' });
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({ ok: true, payload: {} });
        return;
      }
      try {
        const payload = JSON.parse(raw);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          resolve({ ok: false, status: 400, error: 'json_object_required' });
          return;
        }
        resolve({ ok: true, payload });
      } catch {
        resolve({ ok: false, status: 400, error: 'malformed_json' });
      }
    });
    req.on('error', () => resolve({ ok: false, status: 400, error: 'request_error' }));
  });
}

function neutralArchetypes() {
  return {
    ok: true,
    version: 'readtheroom_public_archetypes_v1',
    doctrine: 'archetypes_are_mirrors_not_masters',
    applied: false,
    hiddenDefault: false,
    selected: null,
    recommendedReview: null,
    controls: ['accept', 'reject', 'edit', 'export', 'reset', 'delete'],
    comparisons: [{
      id: 'neutral_default',
      name: 'Neutral Starting Point',
      score: 0,
      fit: 'neutral',
      status: 'active_default',
      applied: false,
      requiresUserReview: false,
      hiddenDefault: false,
      note: 'No optional behavior mirror is applied by default.'
    }]
  };
}

async function handleCalibration(req, res, url) {
  if (req.method === 'GET') {
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    if (!sessionId) return sendJson(res, 200, buildReadTheRoomCalibrationSessionContract());
    const session = calibrationStore.getSession(sessionId);
    if (!session) return sendJson(res, 404, { ok: false, error: 'calibration_session_not_found', version: VERSION });
    return sendJson(res, 200, { ok: true, version: VERSION, session: sanitizePublicValue(session) });
  }
  const parsed = await readJson(req);
  if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error, version: VERSION });
  const payload = parsed.payload;
  const action = String(payload.action || 'start').trim();
  try {
    if (action === 'start') {
      const session = calibrationStore.startSession(payload);
      return sendJson(res, 200, { ok: true, version: VERSION, action, session: sanitizePublicValue(session) });
    }
    if (action === 'choice') {
      const session = calibrationStore.recordChoice(payload);
      return sendJson(res, 200, { ok: true, version: VERSION, action, session: sanitizePublicValue(session), receipt: sanitizePublicValue(session.receipt) });
    }
    if (action === 'get') {
      const session = calibrationStore.getSession(payload.sessionId);
      if (!session) return sendJson(res, 404, { ok: false, error: 'calibration_session_not_found', version: VERSION });
      return sendJson(res, 200, { ok: true, version: VERSION, action, session: sanitizePublicValue(session) });
    }
    if (action === 'receipt') {
      const receipt = calibrationStore.getReceipt(payload.sessionId);
      if (!receipt) return sendJson(res, 404, { ok: false, error: 'calibration_session_not_found', version: VERSION });
      return sendJson(res, 200, { ok: true, version: VERSION, action, receipt: sanitizePublicValue(receipt) });
    }
    return sendJson(res, 400, { ok: false, error: 'unsupported_action', allowedActions: ['start', 'choice', 'get', 'receipt'], version: VERSION });
  } catch (error) {
    const status = error?.code === 'calibration_session_not_found' ? 404
      : error?.code === 'calibration_choice_limit_reached' ? 409
        : 500;
    const publicError = status === 404 ? 'calibration_session_not_found'
      : status === 409 ? 'calibration_choice_limit_reached'
        : 'calibration_session_error';
    return sendJson(res, status, { ok: false, error: publicError, version: VERSION });
  }
}

async function handleApi(req, res, url) {
  const methods = API_METHODS.get(url.pathname);
  if (!methods) return sendNotFound(res);
  if (!methods.has(req.method || 'GET')) return sendMethodNotAllowed(res, methods);

  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, app: 'ReadTheRoom Public Professional', version: VERSION, persistence: 'ephemeral_memory' });
  }
  if (url.pathname === '/api/readtheroom/calibration-session') {
    return handleCalibration(req, res, url);
  }
  if (url.pathname === '/api/readtheroom/profile') {
    return sendJson(res, 200, { ok: true, version: VERSION, publicMode: true, profile: publicProfile });
  }
  if (url.pathname === '/api/readtheroom/artifacts') {
    const artifacts = sanitizeReadTheRoomArtifactsForPublic(buildReadTheRoomArtifacts(publicProfile));
    return sendJson(res, 200, { ok: true, version: VERSION, publicMode: true, artifacts: sanitizePublicValue(artifacts), logicArchetypeComparison: neutralArchetypes() });
  }
  if (url.pathname === '/api/readtheroom/archetypes') {
    if (req.method === 'POST') {
      const parsed = await readJson(req);
      if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error, version: VERSION });
    }
    return sendJson(res, 200, neutralArchetypes());
  }
  if (url.pathname === '/api/readtheroom/score-movement') {
    const parsed = await readJson(req);
    if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error, version: VERSION });
    const result = calculateReadTheRoomBehaviorMatchScore({
      baselineScore: parsed.payload.baselineScore,
      rawLift: parsed.payload.rawLift
    });
    return sendJson(res, 200, { ok: true, version: VERSION, publicMode: true, behaviorMatch: result });
  }
  if (url.pathname === '/api/readtheroom/apply') {
    const parsed = await readJson(req);
    if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error, version: VERSION });
    const message = String(parsed.payload.message || parsed.payload.context || '').slice(0, 6000);
    const reply = String(parsed.payload.reply || '').slice(0, 12000);
    if (!message || !reply) return sendJson(res, 400, { ok: false, error: 'missing_message_or_reply', version: VERSION });
    const applied = applyReadTheRoomPolicy(reply, message, publicProfile);
    const result = sanitizePublicValue(applied?.text || reply);
    const toolSuggestion = sanitizePublicValue(applied?.toolSuggestion || { enabled: false, label: 'suppressed', reason: 'not_evaluated' });
    const lane = String(applied?.lane || 'standard');
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      publicMode: true,
      result,
      lane,
      toolSuggestion,
      readTheRoom: {
        version: VERSION,
        publicMode: true,
        lane,
        toolSuggestion,
        profileMeta: sanitizePublicValue(applied?.profileMeta || {}),
        logicArchetypeComparison: neutralArchetypes(),
        textChanged: result !== reply
      },
      receipt: {
        type: 'readtheroom_policy_applied',
        timestamp: new Date().toISOString(),
        publicMode: true,
        lane,
        toolGate: toolSuggestion.label || 'suppressed',
        textChanged: result !== reply
      }
    });
  }
  return sendNotFound(res);
}

function resolveStaticPath(urlPath) {
  if (STATIC_ROOTS.has(urlPath)) return path.join(publicRoot, 'index.html');
  const prefix = STATIC_PREFIXES.find((candidate) => urlPath.startsWith(candidate));
  if (!prefix) return null;
  let relative;
  try {
    relative = decodeURIComponent(urlPath.slice(prefix.length));
  } catch {
    return null;
  }
  if (!relative) relative = 'index.html';
  relative = relative.replaceAll('\\', '/');
  if (relative.includes('\0') || relative.split('/').includes('..') || relative.startsWith('/')) return null;
  const normalized = path.posix.normalize(relative);
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('.')) return null;
  const candidate = path.resolve(publicRoot, normalized);
  const rootWithSeparator = `${path.resolve(publicRoot)}${path.sep}`;
  if (candidate !== path.resolve(publicRoot) && !candidate.startsWith(rootWithSeparator)) return null;
  return candidate;
}

function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) return sendMethodNotAllowed(res, new Set(['GET', 'HEAD']));
  const filePath = resolveStaticPath(url.pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendNotFound(res);
  const contentType = MIME.get(path.extname(filePath).toLowerCase());
  if (!contentType) return sendNotFound(res);
  const data = fs.readFileSync(filePath);
  const cacheControl = /\.(woff2|png|jpg|jpeg|svg|ico)$/i.test(filePath)
    ? 'public, max-age=86400, immutable'
    : 'no-store';
  res.writeHead(200, {
    ...securityHeaders(contentType, cacheControl),
    'Content-Length': data.length
  });
  if (req.method === 'HEAD') return res.end();
  return res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch {
    return sendJson(res, 500, { ok: false, error: 'internal_error', version: VERSION });
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;
server.listen(PORT, HOST, () => {
  console.log(`[readtheroom-public] ready http://${HOST}:${PORT}/read-the-room-public-pro-v3-4/`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
