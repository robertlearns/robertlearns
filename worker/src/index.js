/* ============================================================
   ee-sync — minimal account + progress-sync API for the
   EE Knowledge Base (robertlearns.github.io).

   Data stored per user: username, salted PBKDF2 password hash,
   salted recovery-code hash, progress JSON, timestamps, rev.
   No email, no IP persisted, no cookies.

   Bindings: DB (D1), AUTH_SECRET (secret, HMAC key for tokens).
   ============================================================ */

const ALLOWED_ORIGINS = [
  "https://robertlearns.github.io",
];
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const PBKDF2_ITER = 100000;          // Cloudflare free-plan cap
const TOKEN_TTL_S = 30 * 24 * 3600;  // 30 days
const MAX_PROGRESS_BYTES = 32 * 1024;
const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;
const MODULE_ID_RE = /^m\d{2}$/;

/* ---------------- rate limiting (best-effort, in-memory) ---------------- */
const rl = new Map(); // ip -> {n, windowStart}
function rateLimited(ip) {
  const now = Date.now();
  const e = rl.get(ip);
  if (!e || now - e.windowStart > 60000) {
    rl.set(ip, { n: 1, windowStart: now });
    if (rl.size > 10000) rl.clear(); // memory backstop
    return false;
  }
  e.n++;
  return e.n > 10;
}

/* ---------------- small utils ---------------- */
const enc = new TextEncoder();

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64url(buf) {
  return b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(status, body, origin) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...corsHeaders(origin),
    },
  });
}
function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function allowedOrigin(req) {
  const o = req.headers.get("Origin");
  if (!o) return null;
  if (ALLOWED_ORIGINS.includes(o) || DEV_ORIGIN.test(o)) return o;
  return null;
}

/* ---------------- crypto ---------------- */
async function pbkdf2(password, saltBytes) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: PBKDF2_ITER },
    key, 256);
  return b64(bits);
}
async function hashSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: await pbkdf2(secret, salt) };
}
async function verifySecret(secret, saltB64, expectedHash) {
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const h = await pbkdf2(secret, salt);
  return timingSafeEqual(h, expectedHash);
}

function makeRecoveryCode() {
  // 20 chars base32 (Crockford-ish, no padding) ≈ 100 bits of entropy
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let out = "";
  for (let i = 0; i < 20; i++) {
    out += alphabet[bytes[i] % 32];
    if (i % 5 === 4 && i < 19) out += "-";
  }
  return out; // e.g. XXXXX-XXXXX-XXXXX-XXXXX
}
function normalizeRecoveryCode(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function hmac(secretKey, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function makeToken(env, user) {
  const payload = b64url(enc.encode(JSON.stringify({
    sub: user.id, u: user.username, ep: user.token_epoch,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S,
  })));
  return payload + "." + (await hmac(env.AUTH_SECRET, payload));
}
async function verifyToken(env, req) {
  const auth = req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  const expect = await hmac(env.AUTH_SECRET, payload);
  if (!timingSafeEqual(sig, expect)) return null;
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))); }
  catch { return null; }
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims; // {sub, u, ep, exp}
}
async function requireUser(env, req) {
  const claims = await verifyToken(env, req);
  if (!claims) return null;
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND token_epoch = ?")
    .bind(claims.sub, claims.ep).first();
  return user || null;
}

/* ---------------- progress validation ---------------- */
function validProgress(p) {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return false;
  for (const key of Object.keys(p)) {
    if (key !== "completed" && key !== "quiz") return false;
  }
  const c = p.completed || {};
  if (typeof c !== "object" || Array.isArray(c)) return false;
  for (const [id, v] of Object.entries(c)) {
    if (!MODULE_ID_RE.test(id) || v !== true) return false;
  }
  const q = p.quiz || {};
  if (typeof q !== "object" || Array.isArray(q)) return false;
  for (const [id, v] of Object.entries(q)) {
    if (!MODULE_ID_RE.test(id)) return false;
    if (typeof v !== "object" || v === null) return false;
    const { score, total, ...rest } = v;
    if (Object.keys(rest).length) return false;
    if (!Number.isInteger(score) || !Number.isInteger(total)) return false;
    if (score < 0 || total < 1 || total > 500 || score > total) return false;
  }
  return true;
}

async function readBody(req) {
  try {
    const text = await req.text();
    if (text.length > MAX_PROGRESS_BYTES) return undefined;
    return JSON.parse(text);
  } catch { return undefined; }
}

/* ---------------- handlers ---------------- */
async function handleRegister(env, req, origin) {
  const body = await readBody(req);
  if (!body) return json(400, { error: "invalid request" }, origin);
  const username = String(body.username || "").toLowerCase().trim();
  const password = String(body.password || "");
  if (!USERNAME_RE.test(username)) return json(400, { error: "username must be 3-32 chars: a-z 0-9 _ -" }, origin);
  if (password.length < 8 || password.length > 200) return json(400, { error: "password must be 8-200 characters" }, origin);

  const pw = await hashSecret(password);
  const recoveryCode = makeRecoveryCode();
  const rc = await hashSecret(normalizeRecoveryCode(recoveryCode));
  const now = Date.now();
  try {
    const res = await env.DB.prepare(
      `INSERT INTO users (username, pw_salt, pw_hash, rc_salt, rc_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, username, token_epoch`)
      .bind(username, pw.salt, pw.hash, rc.salt, rc.hash, now, now).first();
    const token = await makeToken(env, res);
    return json(201, { token, username, recoveryCode }, origin);
  } catch (e) {
    if (String(e).includes("UNIQUE")) return json(409, { error: "username already taken" }, origin);
    throw e;
  }
}

async function handleLogin(env, req, origin) {
  const body = await readBody(req);
  if (!body) return json(400, { error: "invalid request" }, origin);
  const username = String(body.username || "").toLowerCase().trim();
  const password = String(body.password || "");
  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  const ok = user && await verifySecret(password, user.pw_salt, user.pw_hash);
  if (!ok) return json(401, { error: "invalid credentials" }, origin);
  const token = await makeToken(env, user);
  return json(200, { token, username: user.username, progress: JSON.parse(user.progress), rev: user.rev }, origin);
}

async function handleGetProgress(env, req, origin) {
  const user = await requireUser(env, req);
  if (!user) return json(401, { error: "unauthorized" }, origin);
  return json(200, { progress: JSON.parse(user.progress), rev: user.rev, updatedAt: user.updated_at }, origin);
}

async function handlePutProgress(env, req, origin) {
  const user = await requireUser(env, req);
  if (!user) return json(401, { error: "unauthorized" }, origin);
  const body = await readBody(req);
  if (!body || !validProgress(body.progress) || !Number.isInteger(body.baseRev)) {
    return json(400, { error: "invalid progress" }, origin);
  }
  if (body.baseRev !== user.rev) {
    return json(409, { progress: JSON.parse(user.progress), rev: user.rev }, origin);
  }
  const newRev = user.rev + 1;
  // Guard the rev in the WHERE clause too, so two concurrent PUTs can't both win.
  const res = await env.DB.prepare(
    "UPDATE users SET progress = ?, rev = ?, updated_at = ? WHERE id = ? AND rev = ?")
    .bind(JSON.stringify(body.progress), newRev, Date.now(), user.id, user.rev).run();
  if (!res.meta.changes) {
    const fresh = await env.DB.prepare("SELECT progress, rev FROM users WHERE id = ?").bind(user.id).first();
    return json(409, { progress: JSON.parse(fresh.progress), rev: fresh.rev }, origin);
  }
  return json(200, { rev: newRev }, origin);
}

async function handleRecover(env, req, origin) {
  const body = await readBody(req);
  if (!body) return json(400, { error: "invalid request" }, origin);
  const username = String(body.username || "").toLowerCase().trim();
  const code = normalizeRecoveryCode(body.recoveryCode);
  const newPassword = String(body.newPassword || "");
  if (newPassword.length < 8 || newPassword.length > 200) return json(400, { error: "password must be 8-200 characters" }, origin);
  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  const ok = user && await verifySecret(code, user.rc_salt, user.rc_hash);
  if (!ok) return json(401, { error: "invalid recovery code" }, origin);

  const pw = await hashSecret(newPassword);
  const recoveryCode = makeRecoveryCode();
  const rc = await hashSecret(normalizeRecoveryCode(recoveryCode));
  const epoch = user.token_epoch + 1; // invalidates all existing tokens
  await env.DB.prepare(
    `UPDATE users SET pw_salt = ?, pw_hash = ?, rc_salt = ?, rc_hash = ?, token_epoch = ?, updated_at = ? WHERE id = ?`)
    .bind(pw.salt, pw.hash, rc.salt, rc.hash, epoch, Date.now(), user.id).run();
  const token = await makeToken(env, { ...user, token_epoch: epoch });
  return json(200, { token, username: user.username, recoveryCode }, origin);
}

async function handleDeleteAccount(env, req, origin) {
  const user = await requireUser(env, req);
  if (!user) return json(401, { error: "unauthorized" }, origin);
  const body = await readBody(req);
  const password = String((body && body.password) || "");
  if (!(await verifySecret(password, user.pw_salt, user.pw_hash))) {
    return json(401, { error: "wrong password" }, origin);
  }
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  return json(204, null, origin);
}

/* ---------------- router ---------------- */
export default {
  async fetch(req, env) {
    const origin = allowedOrigin(req);
    const url = new URL(req.url);
    const route = req.method + " " + url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    // Browser calls always carry an Origin header; reject foreign origins outright.
    if (req.headers.get("Origin") && !origin) {
      return json(403, { error: "forbidden origin" });
    }

    const authRoutes = ["POST /api/register", "POST /api/login", "POST /api/recover"];
    if (authRoutes.includes(route)) {
      const ip = req.headers.get("CF-Connecting-IP") || "?";
      if (rateLimited(ip)) return json(429, { error: "too many attempts, try again in a minute" }, origin);
    }

    try {
      switch (route) {
        case "POST /api/register":  return await handleRegister(env, req, origin);
        case "POST /api/login":     return await handleLogin(env, req, origin);
        case "GET /api/progress":   return await handleGetProgress(env, req, origin);
        case "PUT /api/progress":   return await handlePutProgress(env, req, origin);
        case "POST /api/recover":   return await handleRecover(env, req, origin);
        case "DELETE /api/account": return await handleDeleteAccount(env, req, origin);
        default: return json(404, { error: "not found" }, origin);
      }
    } catch (e) {
      console.error(e);
      return json(500, { error: "server error" }, origin);
    }
  },
};
