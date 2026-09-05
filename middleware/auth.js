/**
 * middleware/auth.js
 * Lightweight session-based access control for MedLens.
 * Demo credentials: clinician@medlens.local / demo123
 */
const crypto = require('crypto');

// In-memory token store for active sessions: token -> { user, expiresAt }
const activeSessions = new Map();

// Helper to generate a random session token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(user) {
  const token = generateToken();
  // Valid for 24 hours
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  activeSessions.set(token, { user, expiresAt });
  return token;
}

function invalidateSession(token) {
  activeSessions.delete(token);
}

function getSessionUser(token) {
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }
  return session.user;
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
