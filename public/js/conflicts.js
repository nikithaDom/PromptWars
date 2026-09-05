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
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.1rem;">⚠️</span>
              <strong style="color: #92400e; font-size: 0.95rem;">${escapeHtml(c.title)}</strong>
              <span class="badge badge-ai" style="background: #fef3c7; color: #b45309; border: 1px solid #fde68a;">
                AI suggested
              </span>
            </div>
            <div>
              ${isAcknowledged
                ? `<span class="badge-verified" style="font-size: 0.78rem;">✓ Acknowledged by ${escapeHtml(c.acknowledged_by || 'Clinician')}</span>`
                : `<button type="button" class="btn btn-xs" style="background:#d97706; color:#fff;" onclick="window.acknowledgeConflict('${patientId}', '${c.id}')">Acknowledge</button>`
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
      <div class="card" style="border-left: 4px solid #f59e0b; background: #fffbeb; margin-bottom: 20px; padding: 16px 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <h3 style="margin: 0; color: #b45309; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
            <span>⚠️</span> Possible Inconsistencies — Needs Human Review
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
