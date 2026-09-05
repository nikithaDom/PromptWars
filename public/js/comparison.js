/**
 * public/js/comparison.js
 * Longitudinal lab test comparison over time.
 * Calculates progression purely in client/server JavaScript arithmetic.
 */

async function loadComparison(patientId, containerId = 'comparison-container') {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const res = await fetch(`/api/patients/${patientId}/comparison`);
    if (!res.ok) throw new Error('Failed to load comparison trends');
    const data = await res.json();

    const comparisons = data.comparisons || [];
    const multiReadings = comparisons.filter(c => c.hasMultiReports);

    if (data.reportCount < 2) {
      container.innerHTML = `
        <div class="doc-panel empty-state" style="padding: 36px; text-align: center;">
          <p style="font-family: var(--font-serif); font-size: 1.25rem; font-weight: 500; margin-bottom: 6px; color: var(--ink-primary);">Multiple Reports Required for Longitudinal Analysis</p>
          <p class="text-muted" style="font-size: 0.9rem; max-width: 500px; margin: 0 auto 18px auto;">
            This patient currently has ${data.reportCount} report uploaded.
            Upload another report containing the same analyte (such as Glucose, Hemoglobin, or Lipid panels) to compare values across clinical encounters.
          </p>
          <a href="/upload.html?id=${patientId}" class="btn btn-sm">Upload Lab Report</a>
        </div>
      `;
      return;
    }

    if (multiReadings.length === 0) {
      container.innerHTML = `
        <div class="doc-panel empty-state" style="padding: 36px; text-align: center;">
          <p style="font-family: var(--font-serif); font-size: 1.25rem; font-weight: 500; margin-bottom: 6px; color: var(--ink-primary);">No Overlapping Analytes Identified</p>
          <p class="text-muted" style="font-size: 0.9rem; max-width: 500px; margin: 0 auto 18px auto;">
            The ${data.reportCount} uploaded reports do not share any identical test names.
            Longitudinal comparison is computed automatically when multiple reports contain the same lab analyte.
          </p>
          <a href="/upload.html?id=${patientId}" class="btn btn-sm">Upload Lab Report</a>
        </div>
      `;
      return;
    }

    // Render multi-report comparisons
    const comparisonCardsHtml = multiReadings.map(comp => {
      const { testName, unit, readings, baselineReading, latestReading } = comp;

      // Determine delta from baseline to latest
      let totalDeltaBadge = '';
      if (latestReading.numericValue !== null && baselineReading.numericValue !== null) {
        const netDiff = Number((latestReading.numericValue - baselineReading.numericValue).toFixed(2));
        const sign = netDiff > 0 ? '+' : '';
        const pct = baselineReading.numericValue !== 0
          ? ((netDiff / Math.abs(baselineReading.numericValue)) * 100).toFixed(1)
          : null;

        if (netDiff > 0.001) {
          totalDeltaBadge = `
            <span class="trend-badge trend-up">
              +${netDiff} ${unit} (${pct ? `+${pct}%` : ''})
            </span>
          `;
        } else if (netDiff < -0.001) {
          totalDeltaBadge = `
            <span class="trend-badge trend-down">
              ${netDiff} ${unit} (${pct ? `${pct}%` : ''})
            </span>
          `;
        } else {
          totalDeltaBadge = `<span class="trend-badge trend-flat">Unchanged (0.00)</span>`;
        }
      }

      // Progression rows across all reports
      const readingRows = readings.map((r, i) => {
        const rDate = new Date(r.date).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });

        let stepIndicator = '<span class="text-muted" style="font-size:0.8rem;">Baseline</span>';
        if (i > 0) {
          if (r.direction === 'up') {
            stepIndicator = `<span class="trend-pill trend-up">+${r.delta} (${r.percentChange > 0 ? '+' : ''}${r.percentChange}%)</span>`;
          } else if (r.direction === 'down') {
            stepIndicator = `<span class="trend-pill trend-down">${r.delta} (${r.percentChange}%)</span>`;
          } else if (r.direction === 'flat') {
            stepIndicator = `<span class="trend-pill trend-flat">0.0</span>`;
          }
        }

        return `
          <tr>
            <td style="font-weight: 500;">
              ${escapeHtml(r.filename)}
              <div style="font-size: 0.75rem; color: var(--ink-muted);">${rDate}</div>
            </td>
            <td class="col-numeric" style="font-size: 1rem; font-weight: 600; font-variant-numeric: tabular-nums;">
              ${r.rawValue !== null && r.rawValue !== undefined ? r.rawValue : '—'} ${escapeHtml(r.unit || '')}
            </td>
            <td style="font-size: 0.85rem; color: var(--ink-secondary); font-variant-numeric: tabular-nums;">
              ${escapeHtml(r.rangeText || '—')}
            </td>
            <td>
              ${stepIndicator}
            </td>
          </tr>
        `;
      }).join('');

      return `
        <div class="doc-panel" style="margin-bottom: 24px;">
          <div class="doc-section-header">
            <div>
              <h3 class="doc-section-title" style="display: inline-flex; align-items: baseline; gap: 8px;">
                ${escapeHtml(testName)}
                <span class="text-muted" style="font-family: var(--font-sans); font-size: 0.85rem; font-weight: normal;">(${escapeHtml(unit || 'unit not specified')})</span>
              </h3>
              <div class="doc-meta-note">
                Tracked across ${readings.length} sequential reports
              </div>
            </div>
            <div>
              ${totalDeltaBadge}
            </div>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Report and Date</th>
                  <th class="col-numeric">Value</th>
                  <th>Reference Range</th>
                  <th>Trend vs Previous</th>
                </tr>
              </thead>
              <tbody>${readingRows}</tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--hairline); padding-bottom: 12px;">
        <div>
          <h2 style="font-size: 1.45rem; margin: 0;">Longitudinal Lab Trends</h2>
          <p class="page-sub">
            Tracking ${multiReadings.length} test analytes across ${data.reportCount} reports with deterministic calculation.
          </p>
        </div>
        <a href="/upload.html?id=${patientId}" class="btn btn-sm btn-outline">Upload Lab Report</a>
      </div>
      ${comparisonCardsHtml}
    `;

  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
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

window.loadComparison = loadComparison;
