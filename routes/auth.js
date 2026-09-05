/**
 * routes/auth.js
 * Authentication endpoints for login, session check, and logout.
 */
const express = require('express');
const router  = express.Router();
const { createSession, invalidateSession, getSessionUser, requireAuth } = require('../middleware/auth');

// Standard hardcoded demo credentials
const DEMO_USER = {
  email: 'clinician@medlens.local',
  password: 'demo123',
  name: 'Dr. Alex Vance, MD',
  role: 'Attending Physician',
};

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Accept demo user or shorthand "demo" / "demo123"
  const isMatch =
    (email.trim().toLowerCase() === DEMO_USER.email.toLowerCase() || email.trim().toLowerCase() === 'demo') &&
    password === DEMO_USER.password;

  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid email or password. Use demo credentials.' });
  }

  const token = createSession({
    email: DEMO_USER.email,
    name: DEMO_USER.name,
    role: DEMO_USER.role,
  });

  // Set HTTP-only style cookie
  res.setHeader('Set-Cookie', `medlens_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);

  res.json({
    message: 'Login successful',
    token,
    user: {
      email: DEMO_USER.email,
      name: DEMO_USER.name,
      role: DEMO_USER.role,
    },
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  let token = null;
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)medlens_session=([^;]+)/);
    if (match) token = match[1];
  }
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
  }

  const user = getSessionUser(token);
  if (!user) {
    return res.status(401).json({ authenticated: false });
  }

  res.json({ authenticated: true, user });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  let token = null;
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)medlens_session=([^;]+)/);
    if (match) token = match[1];
  }
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
  }

  if (token) invalidateSession(token);

  res.setHeader('Set-Cookie', 'medlens_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
