// Döner Dükkanı game server: serves the built game and keeps player accounts and saves.
// No dependencies. Data lives in JSON files under DATA_DIR:
//   users.json      email → { id, email, salt, hash, created }
//   sessions.json   sha256(token) → { userId, created, seen }
//   saves/<id>.json { save, updated }
//   pending/<email>.json  a save waiting for that email to sign up (see admin.mjs)
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(here, '../dist'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(here, '../data'));

const SESSION_DAYS = 180;
const MAX_BODY = 100 * 1024;
const MAX_SAVE = 64 * 1024;
const COOKIE = 'dd_session';

mkdirSync(path.join(DATA_DIR, 'saves'), { recursive: true });

// ---------- storage ----------

/** A JSON file held in memory; writes are atomic (tmp + rename) and serialized. */
class JsonFile {
  constructor(file, fallback) {
    this.file = file;
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
    this.chain = Promise.resolve();
  }
  save() {
    const body = JSON.stringify(this.data);
    this.chain = this.chain.then(() => atomicWrite(this.file, body));
    return this.chain;
  }
}

async function atomicWrite(file, body) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, file);
}

const users = new JsonFile(path.join(DATA_DIR, 'users.json'), {});
const sessions = new JsonFile(path.join(DATA_DIR, 'sessions.json'), {});
const savePath = (id) => path.join(DATA_DIR, 'saves', `${id}.json`);

function readSave(id) {
  const f = savePath(id);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

// ---------- auth ----------

const scrypt = promisify(crypto.scrypt);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(password, salt) {
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return key.toString('hex');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e) => String(e ?? '').trim().toLowerCase();

/** Fixed-window counter: at most `max` hits per key per `windowMs`. */
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    h.n++;
    return h.n <= max;
  };
}
const perIp = limiter(20, 15 * 60 * 1000);

/** Wrong-password lockout per email: 5 misses locks the account for 15 minutes. */
const fails = new Map();
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
const locked = (email) => { const f = fails.get(email); return !!f && f.reset > Date.now() && f.n >= LOCK_AFTER; };
function recordFail(email) {
  const now = Date.now();
  const f = fails.get(email);
  if (!f || f.reset < now) fails.set(email, { n: 1, reset: now + LOCK_MS });
  else f.n++;
}

function newSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.data[sha256(token)] = { userId, created: now, seen: now };
  void sessions.save();
  return token;
}

function sessionUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = sessions.data[sha256(token)];
  if (!s || Date.now() - s.seen > SESSION_DAYS * 864e5) return null;
  return Object.values(users.data).find((u) => u.id === s.userId) ?? null;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const sessionCookie = (token, maxAge) =>
  `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

// ---------- http helpers ----------

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

const clientIp = (req) => req.socket.remoteAddress ?? '?';

function validSave(save) {
  return save && typeof save === 'object' && !Array.isArray(save)
    && Number.isFinite(save.money) && Array.isArray(save.unlocked)
    && JSON.stringify(save).length <= MAX_SAVE;
}

// ---------- api ----------

async function api(req, res, route) {
  const user = sessionUser(req);
  const method = req.method;

  if (route === 'me' && method === 'GET') {
    return user ? send(res, 200, { ok: true, email: user.email }) : send(res, 401, { ok: false });
  }

  if ((route === 'register' || route === 'login') && method === 'POST') {
    if (!perIp(clientIp(req))) return send(res, 429, { ok: false, error: 'too_many' });
    const body = await readBody(req);
    const email = normEmail(body.email);
    const password = String(body.password ?? '');
    if (!EMAIL_RE.test(email) || email.length > 254) return send(res, 400, { ok: false, error: 'bad_email' });
    if (password.length < 8 || password.length > 128) return send(res, 400, { ok: false, error: 'bad_password' });

    if (route === 'register') {
      if (users.data[email]) return send(res, 409, { ok: false, error: 'exists' });
      const salt = crypto.randomBytes(16).toString('hex');
      const u = { id: crypto.randomUUID(), email, salt, hash: await hashPassword(password, salt), created: Date.now() };
      users.data[email] = u;
      await users.save();
      // A save set aside for this email (admin.mjs import-save) becomes the account's game.
      const pending = path.join(DATA_DIR, 'pending', `${encodeURIComponent(email)}.json`);
      if (existsSync(pending)) await rename(pending, savePath(u.id));
      const token = newSession(u.id);
      return send(res, 200, { ok: true, email }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
    }

    if (locked(email)) return send(res, 429, { ok: false, error: 'too_many' });
    const u = users.data[email];
    const hash = u ? await hashPassword(password, u.salt) : await hashPassword(password, 'x'.repeat(32));
    const good = !!u && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.hash, 'hex'));
    if (!good) {
      recordFail(email);
      return send(res, 401, { ok: false, error: 'wrong' });
    }
    fails.delete(email);
    const token = newSession(u.id);
    return send(res, 200, { ok: true, email }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
  }

  if (route === 'logout' && method === 'POST') {
    const token = parseCookies(req)[COOKIE];
    if (token && sessions.data[sha256(token)]) {
      delete sessions.data[sha256(token)];
      await sessions.save();
    }
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (route === 'save') {
    if (!user) return send(res, 401, { ok: false });
    if (method === 'GET') return send(res, 200, { ok: true, save: readSave(user.id)?.save ?? null });
    if (method === 'PUT') {
      const body = await readBody(req);
      if (!validSave(body.save)) return send(res, 400, { ok: false, error: 'bad_save' });
      // Refuse to overwrite a newer game saved from another device.
      const stored = readSave(user.id)?.save;
      if (stored && (stored.t ?? 0) > (Number(body.knownT) || 0)) return send(res, 409, { ok: false, error: 'conflict' });
      await atomicWrite(savePath(user.id), JSON.stringify({ save: body.save, updated: Date.now() }));
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { ok: false, error: 'not_found' });
}

// ---------- static files ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp4': 'audio/mp4', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);
const cache = new Map();

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    return send(res, 404, 'Bulunamadı', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const ext = path.extname(file);
  const mtime = statSync(file).mtimeMs;
  let entry = cache.get(file);
  if (!entry || entry.mtime !== mtime) {
    const raw = readFileSync(file);
    entry = { mtime, raw, gz: COMPRESSIBLE.has(ext) ? zlib.gzipSync(raw) : null };
    cache.set(file, entry);
  }
  const gzip = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    // Hashed build assets never change; the page itself must always be fresh.
    'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : gzip ? entry.gz : entry.raw);
}

// ---------- server ----------

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://x');
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname.slice(5));
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false });
    return serveStatic(req, res, pathname);
  } catch (err) {
    const code = err?.message === 'too_large' ? 413 : err?.message === 'bad_json' ? 400 : 500;
    if (code === 500) console.error(err);
    if (!res.headersSent) send(res, code, { ok: false, error: code === 500 ? 'server' : err.message });
  }
}).listen(PORT, HOST, () => console.log(`Döner Dükkanı on http://${HOST}:${PORT} (public ${PUBLIC_DIR}, data ${DATA_DIR})`));
