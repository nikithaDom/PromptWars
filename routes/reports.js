/**
 * routes/reports.js
 * POST /api/patients/:id/reports
 *
 * Accepts an image or PDF upload, sends it to Google Gemini for extraction,
 * and stores the tagged results in the patient's record.
 *
 * CRITICAL rules enforced here:
 *  - reference_range_* fields are set to null if Gemini returns null —
 *    we never substitute a "normal range from medical knowledge".
 *  - Every extracted field is tagged source: "ai_extracted".
 *  - The uploaded file is deleted from disk after extraction.
 */
const express           = require('express');
const router            = express.Router();
const multer            = require('multer');
const path              = require('path');
const fs                = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { readDB, writeDB, logEvent } = require('../data/db');
const { requireAuth } = require('../middleware/auth');
const { computeReferenceFlag } = require('../lib/clinical');
const { validateExtractionResults } = require('../lib/validation');

router.use(requireAuth);

// Use memory storage so uploads work in read-only serverless environments
const upload = multer({ storage: multer.memoryStorage() });

// Mockable extraction hook for integration tests
let customExtractor = null;
function setExtractor(fn) {
  customExtractor = fn;
}

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is not configured in your .env file.');
  }
  return new GoogleGenerativeAI(apiKey);
}

// The strict extraction prompt. Instructs the model to return ONLY JSON and never invent ranges.
const EXTRACTION_SYSTEM = `You are a medical data extraction assistant.
You extract lab test results from documents.
Return ONLY a valid JSON array — no prose, no markdown fences, no explanation.`;

const EXTRACTION_USER = `Extract every test result from this lab report.
Return a JSON array where each element has exactly these keys:
  test_name, value, unit,
  reference_range_low, reference_range_high,
  reference_range_raw_text, confidence

CRITICAL rules:
- reference_range_low, reference_range_high, and reference_range_raw_text
  MUST be null if the report does not explicitly print a reference range.
  NEVER invent or guess a normal range from general medical knowledge.
- value should be a number when possible, otherwise a string.
- confidence is a float 0–1 reflecting your certainty in the extraction.
- Return [] if no results are found.`;

async function callAIExtractor(base64Data, mimeType) {
  if (typeof customExtractor === 'function') {
    return await customExtractor(base64Data, mimeType);
  }

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    systemInstruction: EXTRACTION_SYSTEM,
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const filePart = {
    inlineData: {
      data: base64Data,
      mimeType: mimeType,
    },
  };

  const result = await model.generateContent([
    filePart,
    { text: EXTRACTION_USER },
  ]);

  const response = await result.response;
  return response.text().trim();
}

router.post('/:id/reports', upload.single('report'), async (req, res) => {
  const { id } = req.params;
  const file   = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const db      = readDB();
  const patient = db.patients.find(p => p.id === id);

  if (!patient) {
    if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(404).json({ error: 'Patient not found' });
  }

  try {
    // Read the file buffer directly (from memory or disk fallback) and base64-encode it for Gemini
    const fileBuffer = file.buffer || (file.path ? fs.readFileSync(file.path) : Buffer.from(''));
    const base64Data = fileBuffer.toString('base64');
    const mimeType   = file.mimetype || 'application/pdf';

    const rawText = await callAIExtractor(base64Data, mimeType);

    let parsedResults;
    if (typeof rawText === 'object' && rawText !== null) {
      parsedResults = rawText;
    } else {
      try {
        parsedResults = JSON.parse(rawText);
      } catch (_) {
        // Fallback: try to find a JSON array inside the response if there's any surrounding text
        const match = String(rawText).match(/\[[\s\S]*\]/);
        if (match) {
          parsedResults = JSON.parse(match[0]);
        } else {
          throw new Error('AI extractor did not return valid JSON. Raw response: ' + String(rawText).slice(0, 200));
        }
      }
    }

    // Validate the shape of the extracted JSON before storing
    const validation = validateExtractionResults(parsedResults);
    if (!validation.isValid && (!Array.isArray(parsedResults) || parsedResults.length > 0)) {
      return res.status(422).json({
        error: 'AI extraction returned malformed data schema',
        details: validation.errors,
      });
    }

    const validatedResults = validation.results;

    // Tag every field with source: "ai_extracted" and attach computed clinical flag
    const reportId = `rep-${Date.now()}`;
    const taggedResults = validatedResults.map((r, idx) => {
      const flag = computeReferenceFlag(r.value, r.reference_range_low, r.reference_range_high);
      return {
        id:                       `${reportId}-res-${idx + 1}`,
        test_name:                { value: r.test_name,                source: 'ai_extracted' },
        value:                    { value: r.value,                    source: 'ai_extracted' },
        unit:                     { value: r.unit,                     source: 'ai_extracted' },
        reference_range_low:      { value: r.reference_range_low,      source: 'ai_extracted' },
        reference_range_high:     { value: r.reference_range_high,     source: 'ai_extracted' },
        reference_range_raw_text: { value: r.reference_range_raw_text, source: 'ai_extracted' },
        confidence:               { value: typeof r.confidence === 'number' ? r.confidence : 0.85, source: 'ai_extracted' },
        flag,
        computed_flag:            flag,
        verified:                 false,
      };
    });

    patient.reports.push({
      id:          reportId,
      uploaded_at: new Date().toISOString(),
      filename:    file.originalname,
      results:     taggedResults,
    });

    logEvent(patient, {
      type: 'report_uploaded',
      description: `Lab report '${file.originalname}' uploaded with ${taggedResults.length} test result(s) extracted`,
      source: 'ai_extracted',
      details: {
        report_id: reportId,
        filename: file.originalname,
        count: taggedResults.length,
      },
    });

    // Automatic context-aware clarification scan (missing units, low confidence, ambiguous values)
    const { scanClarifications } = require('./clarifications');
    scanClarifications(patient, { id: reportId, results: taggedResults });

    // Automatic divergence and profile conflict scan
    const { checkCrossReportDivergence, checkProfileVsReport } = require('./conflicts');
    const divConflicts = checkCrossReportDivergence(patient);
    if (!patient.conflicts) patient.conflicts = [];
    divConflicts.forEach(c => {
      if (!patient.conflicts.some(ex => ex.title === c.title)) {
        patient.conflicts.unshift(c);
      }
    });

    try {
      const profConflicts = await checkProfileVsReport(patient, { filename: file.originalname, results: taggedResults });
      profConflicts.forEach(c => {
        if (!patient.conflicts.some(ex => ex.title === c.title)) {
          patient.conflicts.unshift(c);
        }
      });
    } catch (e) {
      console.warn('Profile conflict scan skipped or failed:', e.message);
    }

    writeDB(db);

    res.json({ message: 'Report processed', report_id: reportId, results_count: taggedResults.length });

  } catch (err) {
    console.error('Report extraction error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up temporary file if saved to disk
    if (file && file.path && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch (_) {}
    }
  }
});

module.exports = router;
module.exports.setExtractor = setExtractor;
