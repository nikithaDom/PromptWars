/**
 * data/db.js
 * Synchronous read/write helpers for db.json with atomic persistence and audit logging.
 */
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');

function initDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ patients: [] }, null, 2));
  }
}

function readDB() {
  initDB();
  try {
    const content = fs.readFileSync(DB_PATH, 'utf8');
    const data = JSON.parse(content);
    if (!Array.isArray(data.patients)) data.patients = [];
    return data;
  } catch (err) {
    console.error('Error reading db.json, returning empty structure:', err.message);
    return { patients: [] };
  }
}

function writeDB(data) {
  // Atomic write via temp file
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, DB_PATH);
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
