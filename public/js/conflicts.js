/**
 * public/js/conflicts.js
 * Frontend rendering and actions for clinical inconsistencies and conflicts.
 *
 * Rules:
 *  - Labeled "Possible inconsistency — needs human review"
 *  - Always shown as AI-suggested with a reason, never phrased as a fact
 *  - Allows clinician to acknowledge review
 */

async function renderConflicts(patientId, containerId = 'conflicts-banner-area') {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const res = await fetch(`/api/patients/${patientId}/conflicts`);
    if (!res.ok) return;
    const data = await res.json();
    const conflicts = data.conflicts || [];

    if (conflicts.length === 0) {
      container.innerHTML = '';
      return;
    }

    const pendingCount = conflicts.filter(c => c.status === 'pending').length;

    const cardsHtml = conflicts.map(c => {
      const isAcknowledged = c.status === 'acknowledged';

      return `
        <div class="conflict-card ${isAcknowledged ? 'conflict-acknowledged' : 'conflict-pending'}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
            <div style="display: flex; align-items: baseline; gap: 8px;">
              <strong style="color: var(--flag-low-ink); font-size: 0.95rem;">${escapeHtml(c.title)}</strong>
              <span class="provenance-badge prov-ai">
                AI suggested
              </span>
            </div>
            <div>
              ${isAcknowledged
                ? `<span class="badge-verified" style="font-size: 0.78rem;">Verified by ${escapeHtml(c.acknowledged_by || 'Clinician')}</span>`
                : `<button type="button" class="btn btn-sm btn-outline" style="font-size: 0.75rem;" onclick="window.acknowledgeConflict('${patientId}', '${c.id}')">Acknowledge Review</button>`
              }
            </div>
          </div>
          <p class="conflict-reason">
            ${escapeHtml(c.reason)}
          </p>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="doc-panel" style="border-left: 3px solid var(--flag-low-bar); background: #FFFDF9; margin-bottom: 24px; padding: 18px 22px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <h3 style="margin: 0; color: var(--flag-low-ink); font-size: 1.15rem; display: flex; align-items: baseline; gap: 8px;">
            Possible Inconsistencies — Clinical Review Required
            ${pendingCount > 0 ? `<span class="count-pill">${pendingCount} pending</span>` : ''}
          </h3>
          <button type="button" class="btn btn-sm btn-outline" style="font-size: 0.75rem;" onclick="window.scanForConflicts('${patientId}')">
            Re-scan Inconsistencies
          </button>
        </div>
        <div class="conflicts-list">
          ${cardsHtml}
        </div>
      </div>
    `;

  } catch (err) {
    console.warn('Could not load conflicts:', err);
  }
}

async function acknowledgeConflict(patientId, conflictId) {
  try {
    const res = await fetch(`/api/patients/${patientId}/conflicts/${conflictId}/acknowledge`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to acknowledge conflict');
    await renderConflicts(patientId);
    if (typeof window.loadTimeline === 'function') await window.loadTimeline(patientId);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function scanForConflicts(patientId) {
  try {
    const res = await fetch(`/api/patients/${patientId}/conflicts/scan`, { method: 'POST' });
    if (!res.ok) throw new Error('Scan failed');
    await renderConflicts(patientId);
    if (typeof window.loadTimeline === 'function') await window.loadTimeline(patientId);
  } catch (err) {
    alert('Scan error: ' + err.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.renderConflicts = renderConflicts;
window.acknowledgeConflict = acknowledgeConflict;
window.scanForConflicts = scanForConflicts;
