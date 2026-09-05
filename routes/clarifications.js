/**
 * routes/clarifications.js
 * Context-Aware Clarification Questions.
 *
 * When extraction confidence is low, a unit is missing, or a value is ambiguous,
 * generates a specific clarifying question instead of silently guessing.
 * The user's response updates the field with source: 'user_clarified' and logs to the audit history.
 */
const express = require('express');
const router  = express.Router();
const { readDB, writeDB, logEvent } = require('../data/db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

/**
 * Detects items needing clarification from an uploaded report.
 * @param {Object} patient
 * @param {Object} report
 */
function scanClarifications(patient, report) {
  if (!patient.clarifications) patient.clarifications = [];
  const detected = [];

  (report.results || []).forEach(r => {
    const testName = r.test_name?.value || 'Lab test';
    const val = r.value?.value;
    const unit = (r.unit?.value || '').trim();
    const conf = typeof r.confidence?.value === 'number' ? r.confidence.value : 0.85;

    // 1. Missing or unspecified unit
    if (!unit || unit === '—' || unit.toLowerCase() === 'none' || unit.toLowerCase() === 'unclear') {
      const exists = patient.clarifications.some(
        c => c.reportId === report.id && c.testId === r.id && c.field === 'unit'
      );
      if (!exists) {
        let suggested = [];
        const lowerName = testName.toLowerCase();
        if (lowerName.includes('glucose')) suggested = ['mg/dL', 'mmol/L'];
        else if (lowerName.includes('cholesterol') || lowerName.includes('triglyceride')) suggested = ['mg/dL', 'mmol/L'];
        else if (lowerName.includes('hemoglobin') || lowerName.includes('hgb')) suggested = ['g/dL', 'g/L'];
        else if (lowerName.includes('creatinine')) suggested = ['mg/dL', 'umol/L'];

        detected.push({
          id: `clar-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          reportId: report.id,
          testId: r.id,
          testName,
          field: 'unit',
          question: `The report shows "${val}" for ${testName} but the unit is unclear or missing. What is the unit of measurement?`,
          currentValue: unit || '—',
          suggestedOptions: suggested,
          status: 'pending',
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          answer: null,
        });
      }
    }

    // 2. Low confidence (< 0.70)
    if (conf < 0.70) {
      const exists = patient.clarifications.some(
        c => c.reportId === report.id && c.testId === r.id && c.field === 'value'
      );
      if (!exists) {
        detected.push({
          id: `clar-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          reportId: report.id,
          testId: r.id,
          testName,
          field: 'value',
          question: `Low extraction certainty (${Math.round(conf * 100)}%) for ${testName} (detected "${val}"). Is this value accurate, or should it be corrected?`,
          currentValue: String(val),
          suggestedOptions: [],
          status: 'pending',
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          answer: null,
        });
      }
    }

    // 3. Ambiguous characters in value (e.g. "?", "~", "approx")
    if (typeof val === 'string' && (val.includes('?') || val.includes('~') || val.toLowerCase().includes('approx'))) {
      const exists = patient.clarifications.some(
        c => c.reportId === report.id && c.testId === r.id && c.field === 'value_ambiguous'
      );
      if (!exists) {
        detected.push({
          id: `clar-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          reportId: report.id,
          testId: r.id,
          testName,
          field: 'value',
          question: `The value for ${testName} was extracted with ambiguous characters ("${val}"). Please provide the verified reading.`,
          currentValue: val,
          suggestedOptions: [],
          status: 'pending',
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          answer: null,
        });
      }
    }
  });

  detected.forEach(c => patient.clarifications.unshift(c));
  return detected;
}

// GET /api/patients/:id/clarifications
router.get('/:id/clarifications', (req, res) => {
  const db = readDB();
  const patient = db.patients.find(p => p.id === req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  res.json({ clarifications: patient.clarifications || [] });
});

// POST /api/patients/:id/clarifications/:cid/resolve
// Feeds the user's answer back into the structured field with source: "user_clarified"
router.post('/:id/clarifications/:cid/resolve', (req, res) => {
  const { id, cid } = req.params;
  const { answer } = req.body || {};

  if (answer === undefined || answer === null || String(answer).trim() === '') {
    return res.status(400).json({ error: 'Answer is required' });
  }

  const cleanAnswer = String(answer).trim();
  const db = readDB();
  const patient = db.patients.find(p => p.id === id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const clar = (patient.clarifications || []).find(c => c.id === cid);
  if (!clar) return res.status(404).json({ error: 'Clarification question not found' });

  // Find the target test result
  const report = (patient.reports || []).find(r => r.id === clar.reportId);
  if (!report) return res.status(404).json({ error: 'Associated report not found' });

  const testResult = (report.results || []).find(r => r.id === clar.testId);
  if (!testResult) return res.status(404).json({ error: 'Associated test result not found' });

  const field = clar.field || 'value';
  const oldValue = testResult[field]?.value ?? 'unspecified';

  // Apply user's answer and stamp source as 'user_clarified'
  if (!testResult[field]) testResult[field] = {};
  testResult[field].value = cleanAnswer;
  testResult[field].source = 'user_clarified';

  // Mark clarification as resolved
  clar.status = 'resolved';
  clar.resolvedAt = new Date().toISOString();
  clar.answer = cleanAnswer;

  // Log to audit history
  logEvent(patient, {
    type: 'field_edited',
    description: `User clarified ${clar.testName} (${field}): was "${oldValue}" → "${cleanAnswer}"`,
    source: 'user_provided',
    details: {
      clarificationId: cid,
      reportId: clar.reportId,
      testId: clar.testId,
      testName: clar.testName,
      field,
      oldValue,
      newValue: cleanAnswer,
    },
  });

  writeDB(db);

  res.json({
    message: 'Clarification resolved and field updated',
    clarification: clar,
    testResult,
  });
});

module.exports = router;
module.exports.scanClarifications = scanClarifications;
