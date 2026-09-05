/**
 * public/js/timeline.js
 * Chronological audit trail & human-in-the-loop editing/verification module.
 *
 * Implements:
 *  - Vertical chronological timeline of all patient events
 *  - Explicit source tagging on every event (user_provided, ai_extracted, ai_generated)
 *  - Old-to-new value diff chips for edited fields
 *  - Inline field editing and clinical verification handlers
 */

async function loadTimeline(patientId, containerId = 'timeline-container') {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const res = await fetch(`/api/patients/${patientId}/timeline`);
    if (!res.ok) throw new Error('Failed to load audit history');
    const data = await res.json();
    const events = data.timeline || [];

    if (events.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 24px; text-align: center;">
          <p class="text-muted">No timeline events recorded yet.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="timeline-wrapper">
        ${events.map((evt, idx) => renderTimelineItem(evt, idx === 0)).join('')}
      </div>
    `;

  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

function renderTimelineItem(evt, isLatest) {
  const date = new Date(evt.timestamp);
  const formattedDate = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const formattedTime = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Determine event type styling
  let typeLabel = 'Audit Event';
  let typeClass = 'type-default';

  switch (evt.type) {
    case 'patient_created':
      typeLabel = 'Profile Created';
      typeClass = 'type-patient';
      break;
    case 'report_uploaded':
      typeLabel = 'Lab Report Uploaded';
      typeClass = 'type-report';
      break;
    case 'field_edited':
      typeLabel = 'Field Edited';
      typeClass = 'type-edit';
      break;
    case 'field_verified':
      typeLabel = 'Clinician Verified';
      typeClass = 'type-verify';
      break;
    case 'summary_generated':
      typeLabel = 'AI Summary Generated';
      typeClass = 'type-ai';
      break;
  }

  // Provenance badge
  let sourceBadge = '';
  if (evt.source === 'user_provided') {
    sourceBadge = '<span class="provenance-badge prov-user">Clinician action</span>';
  } else if (evt.source === 'ai_extracted') {
    sourceBadge = '<span class="provenance-badge prov-ai">AI extracted</span>';
  } else if (evt.source === 'ai_generated') {
    sourceBadge = '<span class="provenance-badge prov-ai">AI generated</span>';
  }

  // Details rendering (diff chip for edits)
  let detailsHtml = '';
  if (evt.type === 'field_edited' && evt.details) {
    const { oldValue, newValue, fieldName } = evt.details;
    detailsHtml = `
      <div class="diff-box">
        <span class="diff-field">${escapeHtml(fieldName || 'value')}:</span>
        <span class="diff-old"><del>${escapeHtml(oldValue !== null && oldValue !== undefined ? String(oldValue) : '(empty)')}</del></span>
        <span style="font-size: 0.78rem; color: var(--ink-muted);">to</span>
        <span class="diff-new"><ins>${escapeHtml(newValue !== null && newValue !== undefined ? String(newValue) : '(empty)')}</ins></span>
      </div>
    `;
  } else if (evt.type === 'summary_generated' && evt.details?.summary_snippet) {
    detailsHtml = `
      <div class="diff-box" style="font-style: italic; color: var(--ink-muted);">
        "${escapeHtml(evt.details.summary_snippet)}"
      </div>
    `;
  }

  return `
    <div class="timeline-item ${isLatest ? 'timeline-latest' : ''}">
      <div class="timeline-node"></div>
      <div class="doc-panel" style="margin-bottom: 16px; padding: 16px 20px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="timeline-type-badge ${typeClass}">${typeLabel}</span>
            ${sourceBadge}
          </div>
          <span class="timeline-time text-muted" style="font-size: 0.78rem; font-variant-numeric: tabular-nums;">
            ${formattedDate} at ${formattedTime}
          </span>
        </div>
        <p style="margin: 8px 0 4px 0; font-size: 0.92rem; color: var(--ink-primary);">
          ${escapeHtml(evt.description)}
        </p>
        ${detailsHtml}
      </div>
    </div>
  `;
}

// Field Editing Action
async function editPatientField(patientId, targetType, fieldName, currentValue, options = {}) {
  const label = options.label || fieldName;
  const promptVal = prompt(`Edit ${label}:\n(Changes are logged to the audit history)`, currentValue || '');

  if (promptVal === null) return; // User cancelled
  if (promptVal === currentValue) return; // No change

  try {
    const res = await fetch(`/api/patients/${patientId}/fields/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType,
        fieldName,
        reportId: options.reportId,
        testId: options.testId,
        newValue: promptVal.trim(),
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update field');

    // Reload record & timeline
    if (typeof loadRecord === 'function') await loadRecord();
    if (typeof loadTimeline === 'function') await loadTimeline(patientId);

  } catch (err) {
    alert('Error updating field: ' + err.message);
  }
}

// Test Verification Action
async function verifyTestResult(patientId, reportId, testId, testName) {
  if (!confirm(`Mark "${testName}" as verified by clinician?\nThis verification will be logged in the permanent audit trail.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/patients/${patientId}/fields/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType: 'test_result',
        reportId,
        testId,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to verify test result');

    if (typeof loadRecord === 'function') await loadRecord();
    if (typeof loadTimeline === 'function') await loadTimeline(patientId);

  } catch (err) {
    alert('Error verifying result: ' + err.message);
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.loadTimeline = loadTimeline;
window.editPatientField = editPatientField;
window.verifyTestResult = verifyTestResult;
