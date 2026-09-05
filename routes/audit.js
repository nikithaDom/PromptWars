/**
 * routes/audit.js
 * Endpoints for timeline audit trail, field editing, and clinical verification.
 */
const express = require('express');
const router  = express.Router();
const { readDB, writeDB, logEvent } = require('../data/db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/patients/:id/timeline
// Returns the chronological event log for this patient
router.get('/:id/timeline', (req, res) => {
  const db = readDB();
  const patient = db.patients.find(p => p.id === req.params.id);

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  res.json({ timeline: patient.timeline || [] });
});

// POST /api/patients/:id/fields/edit
// Edits either a top-level patient info field or a specific test result in a report.
// Updates source to 'user_provided' and writes an audit event with old & new values.
router.post('/:id/fields/edit', (req, res) => {
  const { id } = req.params;
  const { targetType, fieldName, reportId, testId, newValue } = req.body || {};

  if (!targetType || newValue === undefined) {
    return res.status(400).json({ error: 'targetType and newValue are required' });
  }

  const db = readDB();
  const patient = db.patients.find(p => p.id === id);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  let oldValue = null;
  let label = fieldName;

  if (targetType === 'patient_field') {
    if (!patient.fields || !patient.fields[fieldName]) {
      return res.status(400).json({ error: `Unknown patient field: ${fieldName}` });
    }
    oldValue = patient.fields[fieldName].value;
    patient.fields[fieldName].value = newValue;
    patient.fields[fieldName].source = 'user_provided';
    label = fieldName.replace('_', ' ');

  } else if (targetType === 'test_result') {
    const report = (patient.reports || []).find(r => r.id === reportId);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const result = (report.results || []).find(r => r.id === testId);
    if (!result) return res.status(404).json({ error: 'Test result not found' });

    const prop = fieldName || 'value'; // default to editing test value
    if (!result[prop]) {
      return res.status(400).json({ error: `Unknown property: ${prop}` });
    }

    oldValue = result[prop].value;
    result[prop].value = newValue;
    result[prop].source = 'user_provided';
    label = `${result.test_name?.value || 'Test'} (${prop})`;
  } else {
    return res.status(400).json({ error: 'Invalid targetType. Must be patient_field or test_result' });
  }

  // Audit event
  const event = logEvent(patient, {
    type: 'field_edited',
    description: `Edited ${label}: was "${oldValue ?? 'none'}" → now "${newValue}"`,
    source: 'user_provided',
    details: {
      targetType,
      fieldName,
      reportId,
      testId,
      oldValue,
      newValue,
    },
  });

  writeDB(db);

  res.json({ message: 'Field updated', event, patient });
});

// POST /api/patients/:id/fields/verify
// Clinician marks a test result or field as human-verified.
router.post('/:id/fields/verify', (req, res) => {
  const { id } = req.params;
  const { targetType, reportId, testId, fieldName } = req.body || {};

  const db = readDB();
  const patient = db.patients.find(p => p.id === id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  let label = '';
  if (targetType === 'test_result') {
    const report = (patient.reports || []).find(r => r.id === reportId);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const result = (report.results || []).find(r => r.id === testId);
    if (!result) return res.status(404).json({ error: 'Test result not found' });

    result.verified = true;
    result.verified_at = new Date().toISOString();
    result.verified_by = req.user?.name || 'Clinician';
    label = `${result.test_name?.value || 'Test'}`;
  } else {
    return res.status(400).json({ error: 'Only test_result verification is currently supported' });
  }

  const event = logEvent(patient, {
    type: 'field_verified',
    description: `Verified ${label} by ${req.user?.name || 'Clinician'}`,
    source: 'user_provided',
    details: {
      reportId,
      testId,
      verified_by: req.user?.name || 'Clinician',
    },
  });

  writeDB(db);

  res.json({ message: 'Verified successfully', event });
});

module.exports = router;
