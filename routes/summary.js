/**
 * routes/summary.js
 * POST /api/patients/:id/summary
 *
 * Sends the structured patient record (NOT the raw file) to Google Gemini
 * and returns a plain-language summary.
 *
 * The system prompt enforces hard rules:
 *  - No diagnosis
 *  - No treatment suggestions
 *  - No "suggests / indicates / consistent with [disease]" language
 *  - Must end with the exact disclaimer sentence
 */
const express               = require('express');
const router                = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { readDB, writeDB, logEvent } = require('../data/db');
const { requireAuth }        = require('../middleware/auth');

router.use(requireAuth);

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is not configured in your .env file.');
  }
  return new GoogleGenerativeAI(apiKey);
}

const SUMMARY_SYSTEM = `You are a plain-language medical record assistant.
Your job is to summarize a patient's information and lab results in simple terms a patient can understand.

Rules you must follow without exception:
- Never diagnose any condition.
- Never suggest a treatment or medication change.
- Never say a result "suggests", "indicates", or "is consistent with" any disease or condition.
- Do not interpret abnormal values as pointing to any specific cause or illness.
- Write in plain, friendly language — avoid medical jargon where possible.
- Always end your response with exactly this sentence on its own line:
  "This is not a medical diagnosis — talk to a healthcare professional about these results."`;

router.post('/:id/summary', async (req, res) => {
  const db      = readDB();
  const patient = db.patients.find(p => p.id === req.params.id);

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      systemInstruction: SUMMARY_SYSTEM,
    });

    const prompt = `Write a short, plain-language summary of this patient's information and lab results.\n\n${JSON.stringify(patient, null, 2)}`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summaryText = response.text();

    // Log the summary generation in audit timeline
    logEvent(patient, {
      type: 'summary_generated',
      description: 'AI plain-language clinical summary generated',
      source: 'ai_generated',
      details: {
        summary_snippet: summaryText.slice(0, 120) + (summaryText.length > 120 ? '...' : ''),
      },
    });

    // Also store the latest summary on patient record
    patient.latest_summary = {
      text: summaryText,
      generated_at: new Date().toISOString(),
    };

    writeDB(db);

    res.json({ summary: summaryText });

  } catch (err) {
    console.error('Summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
