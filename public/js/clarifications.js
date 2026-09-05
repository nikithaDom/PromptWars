/**
 * public/js/clarifications.js
 * Context-aware clarification prompts module.
 *
 * Prompts the user when units are missing, confidence is low, or values are ambiguous.
 * Submits the user's resolution and stamps the field with source: "user_clarified".
 */

async function renderClarifications(patientId, containerId = 'clarifications-area') {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const res = await fetch(`/api/patients/${patientId}/clarifications`);
    if (!res.ok) return;
    const data = await res.json();
    const clarifications = data.clarifications || [];

    const pending = clarifications.filter(c => c.status === 'pending');

    if (pending.length === 0) {
      container.innerHTML = '';
      return;
    }

    const cardsHtml = pending.map(c => {
      const optionsHtml = (c.suggestedOptions || []).map(opt => `
        <button
          type="button"
          class="option-chip"
          onclick="document.getElementById('input-clar-${c.id}').value = '${escapeAttr(opt)}'"
        >
          ${escapeHtml(opt)}
        </button>
      `).join('');

      return `
        <div class="clarification-card" id="card-${c.id}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span class="badge badge-user" style="background:#fef3c7; color:#b45309; border-color:#fde68a;">
                  Needs your input
                </span>
                <strong>${escapeHtml(c.testName)}</strong>
              </div>
              <p style="margin: 0 0 10px 0; font-size: 0.92rem; color: #1e293b;">
                ${escapeHtml(c.question)}
              </p>
            </div>
          </div>

          ${optionsHtml ? `<div style="display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;"><span style="font-size: 0.78rem; color: var(--text-muted);">Suggestions:</span>${optionsHtml}</div>` : ''}

          <div style="display: flex; gap: 8px; align-items: center; max-width: 440px;">
            <input
              type="text"
              id="input-clar-${c.id}"
              placeholder="Enter confirmed ${escapeAttr(c.field)}…"
              style="flex: 1; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 0.88rem;"
            >
            <button
              type="button"
              class="btn btn-sm"
              style="padding: 6px 14px; font-size: 0.85rem;"
              onclick="window.resolveClarification('${patientId}', '${c.id}')"
            >
              Save Clarification
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="card" style="border-left: 4px solid #3b82f6; background: #f0f9ff; margin-bottom: 20px; padding: 18px 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <h3 style="margin: 0; color: #0369a1; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
            <span>💬</span> Context-Aware Clarifications Needed (${pending.length})
          </h3>
          <span class="text-muted" style="font-size: 0.8rem;">
            Answers are saved with provenance [User clarified]
          </span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${cardsHtml}
        </div>
      </div>
    `;

  } catch (err) {
    console.warn('Could not load clarifications:', err);
  }
}

async function resolveClarification(patientId, clarificationId) {
  const input = document.getElementById(`input-clar-${clarificationId}`);
  if (!input) return;
  const answer = input.value.trim();

  if (!answer) {
    alert('Please enter or select an answer to resolve this clarification.');
    return;
  }

  try {
    const res = await fetch(`/api/patients/${patientId}/clarifications/${clarificationId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to resolve clarification');

    // Re-render
    await renderClarifications(patientId);
    if (typeof window.loadRecord === 'function') await window.loadRecord();
    if (typeof window.loadTimeline === 'function') await window.loadTimeline(patientId);

  } catch (err) {
    alert('Error resolving clarification: ' + err.message);
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

function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.renderClarifications = renderClarifications;
window.resolveClarification = resolveClarification;
