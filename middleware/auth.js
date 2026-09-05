/**
 * middleware/auth.js
 * Lightweight session-based access control for MedLens.
 * Demo credentials: clinician@medlens.local / demo123
 */
const crypto = require('crypto');

// In-memory token store for active sessions: token -> { user, expiresAt }
const activeSessions = new Map();

const AUTH_SECRET = process.env.SESSION_SECRET || 'medlens-demo-session-secret';

function createSession(user) {
  // Valid for 24 hours
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({ user, expiresAt });
  const b64Payload = Buffer.from(payload).toString('base64url');
  const hmac = crypto.createHmac('sha256', AUTH_SECRET).update(b64Payload).digest('hex');
  const token = `${b64Payload}.${hmac}`;

  activeSessions.set(token, { user, expiresAt });
  return token;
}

function invalidateSession(token) {
  activeSessions.delete(token);
}

function getSessionUser(token) {
  if (!token) return null;
  const session = activeSessions.get(token);
  if (session) {
    if (Date.now() > session.expiresAt) {
      activeSessions.delete(token);
      return null;
    }
    return session.user;
  }

  // Stateless fallback across distributed serverless function invocations
  try {
    const parts = token.split('.');
    if (parts.length === 2) {
      const [b64Payload, signature] = parts;
      const expected = crypto.createHmac('sha256', AUTH_SECRET).update(b64Payload).digest('hex');
      if (signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        const decoded = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
        if (decoded && decoded.expiresAt && Date.now() <= decoded.expiresAt) {
          return decoded.user;
        }
      }
    }
  } catch (_) {}

  return null;
}

// Express middleware
function requireAuth(req, res, next) {
  // Extract token from Cookie or Authorization header
  let token = null;

  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)medlens_session=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  const user = getSessionUser(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

module.exports = {
  requireAuth,
  createSession,
  invalidateSession,
  getSessionUser,
};
