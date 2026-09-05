/**
 * upload.js — Lab report upload logic (Page 2)
 *
 * - Reads ?id= from the URL to know which patient this upload is for.
 * - Loads the patient's summary and existing reports.
 * - Handles file selection (click + drag-and-drop).
 * - POSTs the file to /api/patients/:id/reports as multipart form data.
 * - Shows how many results were extracted, links to the record page.
 */

// ---- Get patient ID from URL ----
const params    = new URLSearchParams(window.location.search);
const patientId = params.get('id');

if (!patientId) {
  document.querySelector('main').innerHTML =
    '<div class="alert alert-error">No patient ID found in URL. <a href="/">Start over</a></div>';
}

// ---- Load patient data and populate the page header ----
async function loadPatient() {
  try {
    const res     = await fetch(`/api/patients/${patientId}/record`);
    const patient = await res.json();

    if (!res.ok) throw new Error(patient.error || 'Patient not found');

    const f = patient.fields;

    // Show a one-line summary of who this patient is
    document.getElementById('patient-summary').innerHTML = `
      <strong>${f.sex.value}, ${f.age.value} yrs</strong>
      <span class="text-muted"> &mdash; ID: ${patient.id} &mdash; Created ${new Date(patient.created_at).toLocaleDateString()}</span>
    `;

    // Populate nav links for this patient
    document.getElementById('nav-patient-links').innerHTML = `
      <a href="/record.html?id=${patientId}">View Record</a>
      <a href="/summary.html?id=${patientId}">Summary</a>
    `;

    // Show a list of previously uploaded reports (if any)
    const reportsDiv = document.getElementById('existing-reports');
    if (patient.reports.length === 0) {
      reportsDiv.innerHTML = '';
    } else {
      reportsDiv.innerHTML = `
        <div class="card">
          <h3>Previously Uploaded Reports (${patient.reports.length})</h3>
          ${patient.reports.map((r, i) => `
            <div class="info-row">
              <span class="info-label">Report ${i + 1}</span>
              <span class="info-value">
                ${r.filename}
                &mdash; <strong>${r.results.length}</strong> result(s) extracted
                <span class="text-muted">(${new Date(r.uploaded_at).toLocaleString()})</span>
              </span>
            </div>
          `).join('')}
          <div class="mt-16">
            <a href="/record.html?id=${patientId}" class="btn">View Full Record →</a>
          </div>
        </div>
      `;
    }

  } catch (err) {
    document.getElementById('patient-summary').innerHTML =
      `<span class="text-muted">Could not load patient: ${err.message}</span>`;
  }
}

loadPatient();

// ---- File selection via click ----
const zone      = document.getElementById('upload-zone');
const fileInput = document.getElementById('report-file');
const fileLabel = document.getElementById('file-name');

// Clicking the zone opens the OS file picker
zone.addEventListener('click', () => fileInput.click());

// Space/Enter also opens picker (accessibility)
zone.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fileInput.click(); }
});

// Show the chosen file name inside the zone
fileInput.addEventListener('change', () => {
  fileLabel.textContent = fileInput.files[0] ? fileInput.files[0].name : '';
});

// ---- Drag-and-drop ----
zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('dragging'); });
zone.addEventListener('dragleave', ()  => zone.classList.remove('dragging'));
zone.addEventListener('drop', (e) => {
  e.preventDefault();
  zone.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (file) {
    // Assign dropped file to the input so FormData picks it up
    const dt  = new DataTransfer();
    dt.items.add(file);
    fileInput.files   = dt.files;
    fileLabel.textContent = file.name;
  }
});

// ---- Form submission ----
document.getElementById('upload-form').addEventListener('submit', async function (e) {
  e.preventDefault();

  const btn       = document.getElementById('upload-btn');
  const alertArea = document.getElementById('alert-area');
  alertArea.innerHTML = '';

  if (!fileInput.files[0]) {
    alertArea.innerHTML = '<div class="alert alert-error">Please select a file first.</div>';
    return;
  }

  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Extracting — this may take 15–30 seconds…';

  // Use FormData so multer on the server receives the file correctly
  const formData = new FormData();
  formData.append('report', fileInput.files[0]);

  try {
    const res  = await fetch(`/api/patients/${patientId}/reports`, {
      method: 'POST',
      body:   formData,   // No Content-Type header — browser sets multipart boundary automatically
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Upload failed');

    alertArea.innerHTML = `
      <div class="alert alert-success">
        ✓ Extracted <strong>${data.results_count}</strong> result(s).
        <a href="/record.html?id=${patientId}">View Record →</a>
      </div>
    `;

    // Reset the file input and refresh the report list
    fileInput.value       = '';
    fileLabel.textContent = '';
    loadPatient();

  } catch (err) {
    alertArea.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    btn.disabled  = false;
    btn.innerHTML = 'Extract Results';
  }
});
