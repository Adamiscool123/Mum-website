/* Admin auth: PBKDF2 passwords, opaque session tokens (hashed at rest),
   IP rate limiting on login. One shared clinic account by design. */

const enc = new TextEncoder();

function b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64dec(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

export async function hashPassword(password, iterations = 50000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256
  );
  return ['pbkdf2', String(iterations), b64(salt), b64(bits)].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'pbkdf2') return false;
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: b64dec(saltB64), iterations: parseInt(iterStr, 10) }, key, 256
    );
    const a = new Uint8Array(bits), b = b64dec(hashB64);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch { return false; }
}

async function sha256b64(s) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

const SESSION_DAYS = 30;

export async function createSession(db, userId) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare(
    `INSERT INTO admin_sessions (token_hash, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).bind(await sha256b64(token), userId).run();
  return token;
}

export async function sessionUser(db, token) {
  if (!token) return null;
  const row = await db.prepare(
    `SELECT u.id, u.username, u.role FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
  ).bind(await sha256b64(token)).first();
  return row || null;
}

export async function destroySession(db, token) {
  if (!token) return;
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256b64(token)).run();
}

export function readSessionCookie(c) {
  const cookie = c.req.header('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)areum_admin=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function sessionCookieHeader(token, clear) {
  const base = 'areum_admin=' + (clear ? '' : encodeURIComponent(token)) +
    '; Path=/; HttpOnly; SameSite=Lax; Secure';
  return clear ? base + '; Max-Age=0' : base + '; Max-Age=' + SESSION_DAYS * 86400;
}

/** Sliding-window rate limit: max 8 attempts per IP per 15 minutes. */
export async function loginAllowed(db, ip) {
  await db.prepare("DELETE FROM login_attempts WHERE attempted_at < datetime('now','-15 minutes')").run();
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND attempted_at > datetime('now','-15 minutes')"
  ).bind(ip).first();
  return row.n < 8;
}

export async function recordAttempt(db, ip) {
  await db.prepare("INSERT INTO login_attempts (ip, attempted_at) VALUES (?, datetime('now'))").bind(ip).run();
}
