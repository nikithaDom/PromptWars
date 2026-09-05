/**
 * routes/record.js
 * GET /api/patients/:id/record
 * Returns the full patient object (fields + all reports) from db.json.
 */
const express         = require('express');
const router          = express.Router();
const { readDB }      = require('../data/db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/:id/record', (req, res) => {
  const db      = readDB();
  const patient = db.patients.find(p => p.id === req.params.id);

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  res.json(patient);
});

module.exports = router;
