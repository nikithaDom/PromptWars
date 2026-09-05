/**
 * routes/conflicts.js
 * Inconsistency & Conflict Detection Engine.
 *
 * Runs narrow checks:
 *  (a) Newly extracted report vs patient's existing profile (e.g. allergies, conditions, medications).
 *  (b) Same test across reports with implausible jumps close in time.
 *
 * Rules:
 *  - Surfaced as "Possible inconsistency — needs human review".
 *  - Never auto-resolved, always shown as AI-suggested with a reason.
 *  - Never phrased as a fact.
 */
const express = require('express');
const router  = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { readDB, writeDB, logEvent } = require('../data/db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

// Algorithmic check: cross-report implausible jumps
function checkCrossReportDivergence(patient) {
  const detected = [];
  const reports = (patient.reports || []).slice().sort(
    (a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at)
  );

  if (reports.length < 2) return detected;

  // Track values by test
  const testMap = new Map();
  reports.forEach(report => {
    (report.results || []).forEach(r => {
      const name = (r.test_name?.value || '').trim().toLowerCase();
      const num = parseFloat(r.value?.value);
      if (!name || isNaN(num)) return;

      if (!testMap.has(name)) testMap.set(name, []);
      testMap.get(name).push({
        reportId: report.id,
        filename: report.filename,
        date: new Date(report.uploaded_at),
        value: num,
        unit: r.unit?.value || '',
        testName: r.test_name?.value,
      });
    });
  });

  testMap.forEach((readings, name) => {
    if (readings.length < 2) return;

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];
      const daysDiff = Math.abs((curr.date - prev.date) / (1000 * 60 * 60 * 24));

      // Check if values diverged drastically in a short window
      if (prev.value > 0) {
        const foldChange = curr.value / prev.value;
        const percentChange = Math.abs((curr.value - prev.value) / prev.value) * 100;

        // Severe divergence: > 200% shift or > 3x change within 14 days
        if ((percentChange >= 200 || foldChange >= 3 || foldChange <= 0.33) && daysDiff <= 14) {
          detected.push({
            id: `conf-div-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            created_at: new Date().toISOString(),
            type: 'test_divergence',
            title: `Substantial variation in ${curr.testName}`,
            reason: `Possible inconsistency — needs human review: ${curr.testName} shifted from ${prev.value} ${prev.unit} (${prev.filename}) to ${curr.value} ${curr.unit} (${curr.filename}) across a ${Math.round(daysDiff)}-day interval. This may represent an acute change, different assay methodology, or transcription discrepancy.`,
            status: 'pending',
            severity: 'warning',
            details: {
              testName: curr.testName,
              prevValue: prev.value,
              currValue: curr.value,
              unit: curr.unit,
            },
          });
        }
      }
    }
  });

  return detected;
}

// LLM check: profile vs latest report
async function checkProfileVsReport(patient, latestReport) {
  const genAI = getGenAI();
  if (!genAI || !latestReport) return [];

  const fields = patient.fields || {};
  const profileSummary = {
    allergies: fields.allergies?.value || 'None reported',
    existing_conditions: fields.existing_conditions?.value || 'None reported',
    current_medications: fields.current_medications?.value || 'None reported',
    symptoms: fields.symptoms?.value || 'None reported',
  };

  const reportSummary = {
    filename: latestReport.filename,
    extracted_tests: (latestReport.results || []).map(r => ({
      test: r.test_name?.value,
      value: r.value?.value,
      unit: r.unit?.value,
      range: r.reference_range_raw_text?.value,
    })),
  };

  const systemInstruction = `You are a clinical consistency auditing assistant.
Compare the patient's existing profile against this newly extracted lab report.
Look ONLY for possible contradictions or inconsistencies, such as:
1. Patient lists no allergies, but report notes a drug allergy or allergy marker.
2. Patient lists no history of a condition, but report shows evidence suggesting human review is warranted.
3. Patient lists medications that conflict with lab notes.

CRITICAL RULES:
- Return ONLY a valid JSON array of conflict objects. If no inconsistencies, return [].
- Each item MUST have keys: id, type ("profile_conflict"), title, reason, severity ("warning" or "info").
- The "reason" MUST start with: "Possible inconsistency — needs human review: "
- NEVER phrase findings as medical facts or diagnoses (e.g. use "The report notes... whereas profile indicates...").
- Return strictly JSON, no markdown fences.`;

  try {
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      systemInstruction,
      generationConfig: { responseMimeType: 'application/json' },
    });

    const prompt = `Patient Profile:\n${JSON.stringify(profileSummary, null, 2)}\n\nExtracted Lab Report:\n${JSON.stringify(reportSummary, null, 2)}`;
    const res = await model.generateContent(prompt);
    const text = (await res.response).text().trim();

    let list = JSON.parse(text);
    if (!Array.isArray(list)) list = list.conflicts || [];

    return list.map(item => ({
      id: item.id || `conf-prof-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      created_at: new Date().toISOString(),
      type: 'profile_conflict',
      title: item.title || 'Profile discrepancy',
      reason: item.reason.startsWith('Possible inconsistency')
        ? item.reason
        : `Possible inconsistency — needs human review: ${item.reason}`,
      status: 'pending',
      severity: item.severity || 'warning',
    }));
  } catch (err) {
    console.error('Profile vs report conflict check error:', err.message);
    return [];
  }
}

// POST /api/patients/:id/conflicts/scan
// Triggers an inconsistency check and updates patient.conflicts
router.post('/:id/conflicts/scan', async (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const patient = db.patients.find(p => p.id === id);

  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  if (!patient.conflicts) patient.conflicts = [];

  const divergenceConflicts = checkCrossReportDivergence(patient);

  const reports = patient.reports || [];
  const latestReport = reports.length > 0 ? reports[reports.length - 1] : null;
  const profileConflicts = await checkProfileVsReport(patient, latestReport);

  const newConflicts = [...divergenceConflicts, ...profileConflicts];

  // Avoid duplicates
  newConflicts.forEach(c => {
    const exists = patient.conflicts.some(
      existing => existing.title === c.title && existing.type === c.type
    );
    if (!exists) {
      patient.conflicts.unshift(c);
      logEvent(patient, {
        type: 'field_edited',
        description: `Flagged: ${c.reason}`,
        source: 'ai_extracted',
        details: { conflict_id: c.id, type: c.type },
      });
    }
  });

  writeDB(db);
  res.json({ conflicts: patient.conflicts, newlyFound: newConflicts.length });
});

// GET /api/patients/:id/conflicts
router.get('/:id/conflicts', (req, res) => {
  const db = readDB();
  const patient = db.patients.find(p => p.id === req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  res.json({ conflicts: patient.conflicts || [] });
});

// POST /api/patients/:id/conflicts/:cid/acknowledge
router.post('/:id/conflicts/:cid/acknowledge', (req, res) => {
  const { id, cid } = req.params;
  const db = readDB();
  const patient = db.patients.find(p => p.id === id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const conflict = (patient.conflicts || []).find(c => c.id === cid);
  if (!conflict) return res.status(404).json({ error: 'Conflict not found' });

  conflict.status = 'acknowledged';
  conflict.acknowledged_at = new Date().toISOString();
  conflict.acknowledged_by = req.user?.name || 'Clinician';

  logEvent(patient, {
    type: 'field_verified',
    description: `Reviewed and acknowledged inconsistency: "${conflict.title}"`,
    source: 'user_provided',
    details: { conflict_id: cid, acknowledged_by: req.user?.name || 'Clinician' },
  });

  writeDB(db);
  res.json({ message: 'Inconsistency acknowledged', conflict });
});

module.exports = router;
module.exports.checkCrossReportDivergence = checkCrossReportDivergence;
module.exports.checkProfileVsReport = checkProfileVsReport;
