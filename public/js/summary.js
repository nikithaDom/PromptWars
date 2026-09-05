/**
 * summary.js — AI summary page logic (Page 4)
 *
 * Sends the patient's structured record (not the raw file) to the backend,
 * which calls Google Gemini and returns a plain-language summary.
 *
 * The backend's system prompt ensures the model:
 *  - Never diagnoses.
 *  - Never suggests treatment.
 *  - Always ends with the disclaimer sentence.
 *
 * This file just displays what the backend returns.
 */

// ---- Get patient ID from URL ----
const params    = new URLSearchParams(window.location.search);
const patientId = params.get('id');

if (!patientId) {
  document.querySelector('main').innerHTML =
    '<div class="alert alert-error">No patient ID in URL. <a href="/">Start over</a></div>';
}

// Populate nav links
document.getElementById('nav-links').innerHTML = `
  <a href="/upload.html?id=${patientId}">Upload Report</a>
  <a href="/record.html?id=${patientId}">Record</a>
`;

// ---- Generate button ----
document.getElementById('generate-btn').addEventListener('click', async () => {
  const btn         = document.getElementById('generate-btn');
  const alertArea   = document.getElementById('alert-area');
  const summaryArea = document.getElementById('summary-area');
  const summaryText = document.getElementById('summary-text');

  alertArea.innerHTML    = '';
  summaryArea.style.display = 'none';

  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Generating — this may take 15–30 seconds…';

  try {
    // POST to backend — sends the structured JSON record to Gemini, not the raw file
    const res  = await fetch(`/api/patients/${patientId}/summary`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to generate summary');

    // Display — the CSS .summary-box uses white-space: pre-wrap to respect line breaks
    summaryText.textContent  = data.summary;
    summaryArea.style.display = 'block';

    // Scroll summary into view
    summaryArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    alertArea.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    btn.disabled  = false;
    btn.innerHTML = 'Generate Summary';
  }
});
