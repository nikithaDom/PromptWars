/**
 * routes/patients.js
 * Patient management routes:
 *  - GET /api/patients: Lists all patients with optional search filter (?q=...)
 *  - POST /api/patients: Creates a new patient record with audit logging
 */
const express = require('express');
const router  = express.Router();
const { readDB, writeDB, logEvent } = require('../data/db');
const { requireAuth } = require('../middleware/auth');
const { validatePatientIntake } = require('../lib/validation');

// Protect patient endpoints with auth
router.use(requireAuth);

// GET /api/patients
// Returns summary list of all patients for the dashboard
router.get('/', (req, res) => {
  const db = readDB();
  const q = (req.query.q || '').trim().toLowerCase();

  let list = db.patients.map(p => {
    const name = p.fields?.name?.value || `Patient #${p.id.slice(-4)}`;
    const mrn  = p.fields?.mrn?.value  || `MRN-${p.id.slice(-6)}`;
    const age  = p.fields?.age?.value  || '—';
    const sex  = p.fields?.sex?.value  || '—';
    const reportCount = (p.reports || []).length;
    const createdAt   = p.created_at;
    const updatedAt   = p.updated_at || p.created_at;

    // Collect latest test names across reports
    const testNamesSet = new Set();
    (p.reports || []).forEach(r => {
      (r.results || []).forEach(resItem => {
        if (resItem.test_name?.value) testNamesSet.add(resItem.test_name.value);
      });
    });

    return {
      id: p.id,
      name,
      mrn,
      age,
      sex,
      report_count: reportCount,
      created_at: createdAt,
      updated_at: updatedAt,
      test_count: testNamesSet.size,
    };
  });

  // Filter if search query provided
  if (q) {
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.mrn.toLowerCase().includes(q) ||
      p.id.includes(q)
    );
  }

  // Sort by updated_at descending (newest first)
  list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  res.json({ patients: list, total: list.length });
});

// POST /api/patients
// Saves a new patient record. Every field is tagged source: "user_provided".
router.post('/', (req, res) => {
  const validation = validatePatientIntake(req.body);
  if (!validation.isValid) {
    return res.status(400).json({
      error: validation.errors[0] || 'Invalid intake submission',
      details: validation.errors,
    });
  }

  const {
    name, mrn, age, sex, symptoms,
    existing_conditions, allergies, current_medications, notes,
  } = validation.sanitized;

  const db = readDB();
  const id = Date.now().toString();
  const patientName = name || `Patient #${id.slice(-4)}`;
  const patientMrn  = mrn  || `MRN-${Math.floor(100000 + Math.random() * 900000)}`;

  const now = new Date().toISOString();

  const patient = {
    id,
    created_at: now,
    updated_at: now,
    fields: {
      name:                 { value: patientName,               source: 'user_provided' },
      mrn:                  { value: patientMrn,                source: 'user_provided' },
      age:                  { value: age,                       source: 'user_provided' },
      sex:                  { value: sex,                       source: 'user_provided' },
      symptoms:             { value: symptoms            || '', source: 'user_provided' },
      existing_conditions:  { value: existing_conditions || '', source: 'user_provided' },
      allergies:            { value: allergies            || '', source: 'user_provided' },
      current_medications:  { value: current_medications  || '', source: 'user_provided' },
      notes:                { value: notes               || '', source: 'user_provided' },
    },
    reports: [],
    timeline: [],
    clarifications: [],
  };

  // Initial audit event
  logEvent(patient, {
    type: 'patient_created',
    description: `Patient profile created (${patientName}, ${patientMrn}, ${age}y, ${sex})`,
    source: 'user_provided',
    details: {
      name: patientName,
      mrn: patientMrn,
      age,
      sex,
    },
  });

  db.patients.push(patient);
  writeDB(db);

  res.json({ id, name: patientName, mrn: patientMrn });
});

module.exports = router;
