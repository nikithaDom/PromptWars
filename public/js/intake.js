/**
 * intake.js — Patient intake form logic (Page 1)
 *
 * On submit: POST the form data to /api/patients.
 * On success: redirect to upload.html?id=<patient_id>
 */

document.getElementById('intake-form').addEventListener('submit', async function (e) {
  e.preventDefault();

  const btn       = document.getElementById('submit-btn');
  const alertArea = document.getElementById('alert-area');

  // Clear any previous alerts
  alertArea.innerHTML = '';

  // Basic client-side check (server also validates)
  const age = document.getElementById('age').value.trim();
  const sex = document.getElementById('sex').value;
  if (!age || !sex) {
    alertArea.innerHTML = '<div class="alert alert-error">Age and Sex are required.</div>';
    return;
  }

  // Show loading state
  btn.disabled    = true;
  btn.innerHTML   = '<span class="spinner"></span> Saving…';

  // Build the request body — matches the server's expected field names
  const body = {
    name:                document.getElementById('name').value.trim(),
    mrn:                 document.getElementById('mrn').value.trim(),
    age,
    sex,
    symptoms:            document.getElementById('symptoms').value.trim(),
    existing_conditions: document.getElementById('existing_conditions').value.trim(),
    allergies:           document.getElementById('allergies').value.trim(),
    current_medications: document.getElementById('current_medications').value.trim(),
    notes:               document.getElementById('notes').value.trim(),
  };

  try {
    const response = await fetch('/api/patients', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to save patient record.');
    }

    // Navigate to upload page, passing the new patient ID in the URL
    window.location.href = `/upload.html?id=${data.id}`;

  } catch (err) {
    alertArea.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    btn.disabled  = false;
    btn.innerHTML = 'Save &amp; Continue to Report Upload →';
  }
});
