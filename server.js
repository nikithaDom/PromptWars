/**
 * server.js
 * Express entry point. Mounts all API routes and serves static frontend files.
 *
 * Start with:  node server.js
 * Then open:   http://localhost:3000
 */
require('dotenv').config();

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// Parse JSON request bodies
app.use(express.json());

// Root redirect to dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});

// Serve everything in /public as static files
app.use(express.static(path.join(__dirname, 'public')));

// ---- API routes ----
// Each file handles one group of endpoints.
app.use('/api/auth',     require('./routes/auth'));       // Auth endpoints (login, logout, me)
app.use('/api/patients', require('./routes/patients'));   // GET /api/patients, POST /api/patients
app.use('/api/patients', require('./routes/reports'));    // POST /api/patients/:id/reports
app.use('/api/patients', require('./routes/record'));     // GET  /api/patients/:id/record
app.use('/api/patients', require('./routes/summary'));    // POST /api/patients/:id/summary
app.use('/api/patients', require('./routes/audit'));          // GET timeline, POST edit, POST verify
app.use('/api/patients', require('./routes/comparison'));     // GET /api/patients/:id/comparison
app.use('/api/patients', require('./routes/conflicts'));      // GET conflicts, POST scan, POST acknowledge
app.use('/api/patients', require('./routes/clarifications')); // GET clarifications, POST resolve
app.use('/api/patients', require('./routes/export'));         // GET /api/patients/:id/export (PDF / Print)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MedLens running → http://localhost:${PORT}`);
  });
}

module.exports = app;
