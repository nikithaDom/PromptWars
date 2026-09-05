/**
 * routes/comparison.js
 * Longitudinal lab test comparison over time.
 * Enforces plain code arithmetic — NO LLM calls.
 */
const express = require('express');
const router  = express.Router();
const { readDB } = require('../data/db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/patients/:id/comparison
// Compares test results across multiple reports for the same patient.
router.get('/:id/comparison', (req, res) => {
  const db = readDB();
  const patient = db.patients.find(p => p.id === req.params.id);

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const reports = (patient.reports || []).slice().sort(
    (a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at)
  );

  // Group tests by canonical name
  const testsMap = new Map();

  reports.forEach((report, reportIndex) => {
    (report.results || []).forEach(r => {
      const rawName = (r.test_name?.value || '').trim();
      if (!rawName) return;

      const normKey = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!testsMap.has(normKey)) {
        testsMap.set(normKey, {
          canonicalName: rawName,
          unit: r.unit?.value || '',
          readings: [],
        });
      }

      const entry = testsMap.get(normKey);
      if (!entry.unit && r.unit?.value) entry.unit = r.unit.value;

      const rawVal = r.value?.value;
      const numVal = parseFloat(rawVal);
      const isNumeric = !isNaN(numVal);

      entry.readings.push({
        reportId: report.id || `rep-${reportIndex + 1}`,
        reportIndex: reportIndex + 1,
        filename: report.filename,
        date: report.uploaded_at,
        rawValue: rawVal,
        numericValue: isNumeric ? numVal : null,
        unit: r.unit?.value || entry.unit || '',
        rangeText: r.reference_range_raw_text?.value || '—',
        low: r.reference_range_low?.value,
        high: r.reference_range_high?.value,
      });
    });
  });

  // Calculate trends with arithmetic
  const comparisons = [];

  testsMap.forEach((testData) => {
    // Sort readings by date
    testData.readings.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calculate progression across readings
    const trends = testData.readings.map((reading, idx, arr) => {
      if (idx === 0) {
        return {
          ...reading,
          delta: null,
          percentChange: null,
          direction: 'initial', // First reading baseline
        };
      }

      const prev = arr[idx - 1];
      if (reading.numericValue !== null && prev.numericValue !== null) {
        const diff = Number((reading.numericValue - prev.numericValue).toFixed(3));
        let direction = 'flat';
        if (diff > 0.0001) direction = 'up';
        else if (diff < -0.0001) direction = 'down';

        let percentChange = null;
        if (prev.numericValue !== 0) {
          percentChange = Number(((diff / Math.abs(prev.numericValue)) * 100).toFixed(1));
        }

        return {
          ...reading,
          delta: diff,
          percentChange,
          direction,
        };
      }

      return {
        ...reading,
        delta: null,
        percentChange: null,
        direction: 'non-numeric',
      };
    });

    comparisons.push({
      testName: testData.canonicalName,
      unit: testData.unit,
      totalReadings: trends.length,
      hasMultiReports: trends.length > 1,
      latestReading: trends[trends.length - 1],
      baselineReading: trends[0],
      readings: trends,
    });
  });

  // Sort: tests with multiple readings first, then alphabetically
  comparisons.sort((a, b) => {
    if (b.totalReadings !== a.totalReadings) {
      return b.totalReadings - a.totalReadings;
    }
    return a.testName.localeCompare(b.testName);
  });

  res.json({
    patientId: patient.id,
    reportCount: reports.length,
    comparisons,
    multiReadingCount: comparisons.filter(c => c.hasMultiReports).length,
  });
});

module.exports = router;
