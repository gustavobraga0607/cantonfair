'use strict';

const crypto = require('node:crypto');

const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_DAYS * 86400_000;
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha256(token), userId, expiresAt]);
  // Limpeza oportunista de sessões vencidas.
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

async function getSessionUser(db, token) {
  if (!token) return null;
  const row = await db.get(`
    SELECT u.id, u.name, u.email, u.cnpj
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`, [sha256(token), Date.now()]);
  return row ? { id: row.id, name: row.name, email: row.email, cnpj: row.cnpj } : null;
}

async function destroySession(db, token) {
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
}

// Limitador simples de tentativas de login por IP+e-mail.
function createRateLimiter({ max = 10, windowMs = 15 * 60_000 } = {}) {
  const hits = new Map();
  return {
    hit(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.reset < now) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return true;
      }
      entry.count++;
      return entry.count <= max;
    },
    clear(key) { hits.delete(key); },
  };
}

module.exports = { hashPassword, verifyPassword, createSession, getSessionUser, destroySession, createRateLimiter };
