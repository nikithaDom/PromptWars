/**
 * data/db.js
 * Synchronous read/write helpers for db.json with atomic persistence and audit logging.
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const SEED_PATH = path.join(__dirname, 'db.json');
// On Vercel / serverless, root directory is read-only, so use writable /tmp
const DB_PATH = process.env.VERCEL
  ? path.join(os.tmpdir(), 'medlens_db.json')
  : SEED_PATH;

function initDB() {
  if (!fs.existsSync(DB_PATH)) {
    let initialContent = JSON.stringify({ patients: [] }, null, 2);
    if (fs.existsSync(SEED_PATH)) {
      try {
        initialContent = fs.readFileSync(SEED_PATH, 'utf8');
      } catch (_) {}
    }
    try {
      fs.writeFileSync(DB_PATH, initialContent, 'utf8');
    } catch (err) {
      console.warn('Warning: Unable to write initial db.json to disk:', err.message);
    }
  }
}

function readDB() {
  initDB();
  try {
    const target = fs.existsSync(DB_PATH) ? DB_PATH : (fs.existsSync(SEED_PATH) ? SEED_PATH : null);
    if (!target) return { patients: [] };
    const content = fs.readFileSync(target, 'utf8');
    const data = JSON.parse(content);
    if (!Array.isArray(data.patients)) data.patients = [];
    return data;
  } catch (err) {
    console.error('Error reading db.json, returning empty structure:', err.message);
    return { patients: [] };
  }
}

function writeDB(data) {
  try {
    // Atomic write via temp file
    const tempPath = `${DB_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, DB_PATH);
  } catch (err) {
    console.error('Error writing to db.json:', err.message);
  }
}

/**
 * Appends an audit log event to a patient record.
 * @param {Object} patient - The patient record
 * @param {Object} event - Event data
 * @param {string} event.type - e.g. 'patient_created', 'report_uploaded', 'field_edited', 'field_verified', 'summary_generated'
 * @param {string} event.description - Human-readable summary
 * @param {string} event.source - 'user_provided' | 'ai_extracted' | 'ai_generated'
 * @param {Object} [event.details] - { field, oldValue, newValue, etc. }
 */
function logEvent(patient, { type, description, source, details = {} }) {
  if (!patient.timeline) patient.timeline = [];

  const entry = {
    id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    type,
    description,
    source: source || 'user_provided',
    details,
  };

  patient.timeline.unshift(entry); // newest first
  patient.updated_at = entry.timestamp;
  return entry;
}

module.exports = {
  readDB,
  writeDB,
  logEvent,
};
