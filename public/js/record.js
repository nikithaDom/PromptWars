/**
 * record.js — Structured patient record page (Page 3)
 *
 * Implements:
 *  - Structured patient info with provenance badges & inline editing
 *  - Extracted lab reports with computed status flags (Low / Normal / High)
 *  - Visible confidence score indicators (dot + %) on all AI-extracted fields
 *  - Inline clinical verification button
 *  - Live filtering: test name search, status filter, and "Show only items needing review"
 *  - Clinical PDF Export trigger
 *  - Inconsistencies & context-aware clarification displays
 *
 * FLAG RULE: Computed purely with JavaScript arithmetic against reference ranges.
 * The LLM is NEVER asked whether a test is normal.
 */

const params    = new URLSearchParams(window.location.search);
const patientId = params.get('id');

if (!patientId) {
  document.querySelector('main').innerHTML =
    '<div class="alert alert-error">No patient ID in URL. <a href="/dashboard.html">Back to Dashboard</a></div>';
}

// Current filter state for the lab reports table
let filterState = {
  searchQuery: '',
  statusFilter: 'all',
  onlyNeedingReview: false,
};

// ---- Badge helper (Visually distinct in B&W: Solid Dark for Clinician, Outlined Muted Teal for AI) ----
function badge(source) {
  if (source === 'user_provided' || source === 'user_edited') {
    return '<span class="provenance-badge prov-user">Clinician entered</span>';
  }
  if (source === 'user_clarified') {
    return '<span class="provenance-badge prov-user">Clarified</span>';
  }
  if (source === 'ai_generated') {
    return '<span class="provenance-badge prov-ai">AI generated</span>';
  }
  return '<span class="provenance-badge prov-ai">AI extracted</span>';
}

// ---- Confidence score indicator ----
function confidenceBadge(conf) {
  if (typeof conf !== 'number' || isNaN(conf)) return '';
  const pct = Math.round(conf <= 1 ? conf * 100 : conf);
  if (pct >= 85) {
    return `<span class="conf-pill conf-high" title="AI Extraction Confidence: ${pct}%">${pct}%</span>`;
  }
  if (pct >= 70) {
    return `<span class="conf-pill conf-med" title="AI Extraction Confidence: ${pct}%">${pct}%</span>`;
  }
  return `<span class="conf-pill conf-low" title="Low Extraction Confidence: ${pct}% (Review recommended)">${pct}% Review</span>`;
}

// ---- Flag helper: Horizontal Bar Reference-Range Gauge (Pure arithmetic, no LLM) ----
function flagChip(value, low, high) {
  if (low === null || low === undefined || high === null || high === undefined) {
    return {
      html: `
        <div class="range-cell-wrapper">
          <div class="range-header-line">
            <span class="flag-label flag-none">No reference range</span>
          </div>
        </div>
      `,
      flag: 'none'
    };
  }

  const num = parseFloat(value);
  const lowNum = parseFloat(low);
  const highNum = parseFloat(high);

  if (isNaN(num) || isNaN(lowNum) || isNaN(highNum)) {
    return {
      html: `
        <div class="range-cell-wrapper">
          <div class="range-header-line">
            <span class="flag-label flag-none">Non-numeric</span>
          </div>
        </div>
      `,
      flag: 'none'
    };
  }

  let flag = 'Normal';
  let flagClass = 'flag-normal';
  let markerClass = 'range-marker-normal';

  if (num < lowNum) {
    flag = 'Low';
    flagClass = 'flag-low';
    markerClass = 'range-marker-low';
  } else if (num > highNum) {
    flag = 'High';
    flagClass = 'flag-high';
    markerClass = 'range-marker-high';
  }

  const rangeSpan = Math.max(0.001, highNum - lowNum);
  const minDisplay = lowNum - (rangeSpan * 0.45);
  const maxDisplay = highNum + (rangeSpan * 0.45);
  const totalSpan = maxDisplay - minDisplay;

  const startPct = Math.max(5, Math.min(45, ((lowNum - minDisplay) / totalSpan) * 100));
  const widthPct = Math.max(10, Math.min(80, (rangeSpan / totalSpan) * 100));

  let valPct = ((num - minDisplay) / totalSpan) * 100;
  valPct = Math.max(3, Math.min(97, valPct));

  return {
    html: `
      <div class="range-cell-wrapper">
        <div class="range-header-line">
          <span class="flag-label ${flagClass}">${flag}</span>
          <span style="font-size: 0.72rem; color: var(--ink-muted); font-variant-numeric: tabular-nums;">
            ${lowNum}–${highNum}
          </span>
        </div>
        <div class="range-track" aria-hidden="true" title="Value: ${num} | Reference: ${lowNum} to ${highNum}">
          <div class="range-normal-zone" style="left: ${startPct}%; width: ${widthPct}%;"></div>
          <div class="range-marker ${markerClass}" style="left: ${valPct}%;"></div>
        </div>
      </div>
    `,
    flag: flag
  };
}

// ---- Tab Controller ----
function initTabs() {
  const tabsBar = document.getElementById('record-tabs');
  if (tabsBar) tabsBar.style.display = 'flex';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.style.display = 'none';
      });

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.add('active');
        targetContent.style.display = 'block';
      }

      if (targetId === 'tab-comparison' && typeof window.loadComparison === 'function') {
        window.loadComparison(patientId);
      } else if (targetId === 'tab-timeline' && typeof window.loadTimeline === 'function') {
        window.loadTimeline(patientId);
      }
    });
  });
}

// ---- Filter Logic ----
function applyFilters() {
  const query = filterState.searchQuery.toLowerCase();
  const statusFilter = filterState.statusFilter;
  const reviewOnly = filterState.onlyNeedingReview;

  let totalVisible = 0;
  let totalRows = 0;

  document.querySelectorAll('.test-result-row').forEach(row => {
    totalRows++;
    const testName = (row.getAttribute('data-test-name') || '').toLowerCase();
    const flag = row.getAttribute('data-flag') || 'none';
    const verified = row.getAttribute('data-verified') === 'true';
    const conf = parseFloat(row.getAttribute('data-conf') || '1');

    // Matching checks
    const matchesSearch = !query || testName.includes(query);
    const matchesStatus = statusFilter === 'all' || flag === statusFilter;

    // Items needing review: unverified OR low confidence < 0.75 OR abnormal flag
    const isNeedingReview = !verified || conf < 0.75 || flag === 'Low' || flag === 'High';
    const matchesReviewToggle = !reviewOnly || isNeedingReview;

    if (matchesSearch && matchesStatus && matchesReviewToggle) {
      row.style.display = '';
      totalVisible++;
    } else {
      row.style.display = 'none';
    }
  });

  const countLabel = document.getElementById('filter-results-count');
  if (countLabel) {
    countLabel.textContent = `Showing ${totalVisible} of ${totalRows} tests`;
  }
}

// ---- Main Render ----
async function loadRecord() {
  const area = document.getElementById('record-area');
  const headerArea = document.getElementById('patient-header-area');

  try {
    const res     = await fetch(`/api/patients/${patientId}/record`);
    const patient = await res.json();

    if (!res.ok) throw new Error(patient.error || 'Record not found');

    const f = patient.fields || {};
    const patientName = f.name?.value || `Patient #${patient.id.slice(-4)}`;
    const patientMrn  = f.mrn?.value  || `MRN-${patient.id.slice(-6)}`;

    // Populate nav
    document.getElementById('nav-links').innerHTML = `
      <a href="/upload.html?id=${patientId}">Upload Report</a>
      <a href="/summary.html?id=${patientId}">Summary</a>
    `;

    // Render patient title banner with PDF Export button
    headerArea.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--hairline); flex-wrap: wrap; gap: 14px;">
        <div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <h1 style="margin: 0; font-size: 2rem;">${escapeHtml(patientName)}</h1>
            <span class="mrn-badge">${escapeHtml(patientMrn)}</span>
          </div>
          <p class="page-sub">
            Demographics: ${f.age?.value || '—'} yrs, ${f.sex?.value || '—'} • Created ${new Date(patient.created_at).toLocaleDateString()}
          </p>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button type="button" class="btn btn-sm btn-outline" onclick="window.exportRecordAsPdf('${patientId}')" title="Download printable clinical PDF with provenance badges">
            Export Record (PDF)
          </button>
          <a href="/upload.html?id=${patientId}" class="btn btn-sm">Upload Lab Report</a>
          <a href="/summary.html?id=${patientId}" class="btn btn-sm btn-outline">Generate Summary</a>
        </div>
      </div>
    `;

    // ---- Patient info rows ----
    const infoFields = [
      ['Name',                 'name',                 f.name?.value,                 f.name?.source],
      ['MRN',                  'mrn',                  f.mrn?.value,                  f.mrn?.source],
      ['Age',                  'age',                  f.age?.value,                  f.age?.source],
      ['Sex',                  'sex',                  f.sex?.value,                  f.sex?.source],
      ['Symptoms',             'symptoms',             f.symptoms?.value,             f.symptoms?.source],
      ['Existing conditions',  'existing_conditions',  f.existing_conditions?.value,  f.existing_conditions?.source],
      ['Allergies',            'allergies',            f.allergies?.value,            f.allergies?.source],
      ['Current medications',  'current_medications',  f.current_medications?.value,  f.current_medications?.source],
      ['Clinical notes',       'notes',                f.notes?.value,                f.notes?.source],
    ];

    const infoHtml = infoFields.map(([label, key, val, src]) => `
      <div class="info-row">
        <span class="info-label">${label}</span>
        <span class="info-value">
          <span style="font-weight: 500;">${escapeHtml(val || '—')}</span>
          <span style="display: inline-flex; align-items: center; gap: 8px;">
            ${badge(src || 'user_provided')}
            <button
              type="button"
              class="btn-edit-inline"
              title="Edit ${label}"
              onclick="window.editPatientField('${patientId}', 'patient_field', '${key}', '${escapeAttr(val || '')}', { label: '${label}' })"
            >Edit</button>
          </span>
        </span>
      </div>
    `).join('');

    // ---- Reports section with filter bar ----
    let reportsHtml;
    const hasReports = patient.reports && patient.reports.length > 0;

    if (!hasReports) {
      reportsHtml = `
        <div class="card empty-state" style="padding: 36px; text-align: center;">
          <div class="empty-icon">🧪</div>
          <p style="font-weight: 600; margin-bottom: 4px;">No lab reports uploaded yet.</p>
          <p class="text-muted" style="font-size: 0.88rem; margin-bottom: 16px;">
            Upload PDF or image lab results to automatically extract structured clinical values.
          </p>
          <a href="/upload.html?id=${patientId}" class="btn">Upload a Report</a>
        </div>
      `;
    } else {
      reportsHtml = patient.reports.map((report, idx) => {
        const reportDate = new Date(report.uploaded_at).toLocaleString();

        const tableRows = (report.results || []).map(r => {
          const testVal = r.value?.value !== null && r.value?.value !== undefined ? r.value.value : '—';
          const testName = r.test_name?.value || '—';
          const rangeText = r.reference_range_raw_text?.value || '—';
          const confScore = typeof r.confidence?.value === 'number' ? r.confidence.value : 0.85;
          const flagObj = flagChip(r.value?.value, r.reference_range_low?.value, r.reference_range_high?.value);

          // Verification badge / button
          let verificationHtml = '';
          if (r.verified) {
            verificationHtml = `
              <span class="badge-verified" title="Verified by ${escapeAttr(r.verified_by || 'Clinician')}">
                ✓ Verified
              </span>
            `;
          } else {
            verificationHtml = `
              <button
                type="button"
                class="btn-verify"
                onclick="window.verifyTestResult('${patientId}', '${report.id}', '${r.id}', '${escapeAttr(testName)}')"
                title="Mark this extracted value as verified by clinician"
              >
                Verify
              </button>
            `;
          }

          return `
            <tr
              class="test-result-row"
              data-test-name="${escapeAttr(testName)}"
              data-flag="${escapeAttr(flagObj.flag)}"
              data-verified="${r.verified ? 'true' : 'false'}"
              data-conf="${confScore}"
            >
              <td>
                <div style="font-weight: 600;">${escapeHtml(testName)}</div>
                <div style="display: flex; gap: 6px; align-items: center; margin-top: 2px;">
                  ${badge(r.test_name?.source)}
                  ${confidenceBadge(confScore)}
                </div>
              </td>
              <td class="col-numeric">
                <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                  <span class="data-value-text">${escapeHtml(String(testVal))}</span>
                  <button
                    type="button"
                    class="btn-edit-inline"
                    title="Edit test value"
                    onclick="window.editPatientField('${patientId}', 'test_result', 'value', '${escapeAttr(String(testVal))}', { reportId: '${report.id}', testId: '${r.id}', label: '${escapeAttr(testName)} value' })"
                  >Edit</button>
                </div>
                <div style="text-align: right; margin-top: 2px;">${badge(r.value?.source)}</div>
              </td>
              <td>
                <span style="font-weight: 500;">${escapeHtml(r.unit?.value || '—')}</span>
                <div style="margin-top: 2px;">${badge(r.unit?.source)}</div>
              </td>
              <td>
                <span style="font-variant-numeric: tabular-nums;">${escapeHtml(rangeText)}</span>
                <div style="margin-top: 2px;">${badge(r.reference_range_raw_text?.source)}</div>
              </td>
              <td>
                ${flagObj.html}
              </td>
              <td style="text-align: right;">
                ${verificationHtml}
              </td>
            </tr>
          `;
        }).join('');

        const tableOrEmpty = (!report.results || report.results.length === 0)
          ? '<p class="text-muted" style="margin-top:8px">No results were extracted from this file.</p>'
          : `<div class="table-wrap">
               <table>
                 <thead>
                   <tr>
                     <th>Test Name &amp; Extraction</th>
                     <th class="col-numeric">Value</th>
                     <th>Unit</th>
                     <th>Reference Range</th>
                     <th style="min-width: 160px;">Clinical Status</th>
                     <th style="text-align: right;">Clinician Review</th>
                   </tr>
                 </thead>
                 <tbody>${tableRows}</tbody>
               </table>
             </div>`;

        return `
          <div class="doc-panel" style="margin-bottom: 24px;">
            <div class="doc-section-header">
              <h3 class="doc-section-title">
                Report ${idx + 1} — ${escapeHtml(report.filename)}
              </h3>
              <span class="doc-meta-note">
                Uploaded ${reportDate}
              </span>
            </div>
            ${tableOrEmpty}
          </div>
        `;
      }).join('');
    }

    // Filter controls UI (rendered above reports if reports exist)
    const filterControlsHtml = hasReports ? `
      <div class="filter-bar-card" style="margin-bottom: 18px;">
        <div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 220px; position: relative;">
            <input
              type="text"
              id="test-filter-search"
              placeholder="Filter tests by name (e.g. glucose, bun)…"
              style="width: 100%; border: 1px solid var(--hairline-dark); border-radius: var(--radius-sm); padding: 7px 12px; font-size: 0.88rem;"
            >
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <label for="test-filter-status" style="font-size: 0.82rem; color: var(--ink-secondary); margin: 0;">Status:</label>
            <select id="test-filter-status" style="border: 1px solid var(--hairline-dark); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 0.85rem; width: auto;">
              <option value="all">All Statuses</option>
              <option value="Low">Low</option>
              <option value="Normal">Normal</option>
              <option value="High">High</option>
              <option value="none">Range not provided</option>
            </select>
          </div>

          <div style="display: flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--bg-paper);">
            <input type="checkbox" id="test-filter-review" style="cursor: pointer;">
            <label for="test-filter-review" style="font-size: 0.82rem; font-weight: 500; color: var(--ink-primary); cursor: pointer; margin: 0;">
              Show only items needing review
            </label>
          </div>

          <span id="filter-results-count" class="text-muted" style="font-size: 0.8rem; margin-left: auto;"></span>
        </div>
      </div>
    ` : '';

    // ---- Assemble the Clinical Record Tab ----
    area.innerHTML = `
      <div class="doc-panel" style="margin-bottom: 24px;">
        <div class="doc-section-header">
          <h3 class="doc-section-title">Patient Demographics &amp; Clinical Profile</h3>
          <span class="doc-meta-note">Baseline records</span>
        </div>
        ${infoHtml}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:baseline; margin: 32px 0 16px 0; border-bottom: 1px solid var(--hairline); padding-bottom: 10px;">
        <h2 style="margin:0; font-size: 1.45rem;">Diagnostic Lab Reports (${(patient.reports || []).length})</h2>
        <a href="/upload.html?id=${patientId}" class="btn btn-sm btn-outline">Upload Lab Report</a>
      </div>

      ${filterControlsHtml}
      <div id="reports-list-container">
        ${reportsHtml}
      </div>

      <div class="flex-gap mt-24" style="border-top: 1px solid var(--hairline); padding-top: 24px;">
        <button type="button" class="btn btn-outline" onclick="window.exportRecordAsPdf('${patientId}')">
          Export Record (PDF)
        </button>
        <a href="/upload.html?id=${patientId}" class="btn">Upload Lab Report</a>
        <a href="/summary.html?id=${patientId}" class="btn btn-outline">Generate Summary</a>
        <a href="/dashboard.html" class="btn btn-outline">Back to Patient Directory</a>
      </div>
    `;

    // Hook up filter listeners
    if (hasReports) {
      const searchEl = document.getElementById('test-filter-search');
      const statusEl = document.getElementById('test-filter-status');
      const reviewEl = document.getElementById('test-filter-review');

      if (searchEl) {
        searchEl.value = filterState.searchQuery;
        searchEl.addEventListener('input', e => {
          filterState.searchQuery = e.target.value;
          applyFilters();
        });
      }

      if (statusEl) {
        statusEl.value = filterState.statusFilter;
        statusEl.addEventListener('change', e => {
          filterState.statusFilter = e.target.value;
          applyFilters();
        });
      }

      if (reviewEl) {
        reviewEl.checked = filterState.onlyNeedingReview;
        reviewEl.addEventListener('change', e => {
          filterState.onlyNeedingReview = e.target.checked;
          applyFilters();
        });
      }

      applyFilters();
    }

    // Initialize tabs and load inconsistencies + clarifications
    initTabs();

    if (typeof window.renderConflicts === 'function') {
      window.renderConflicts(patientId);
    }
    if (typeof window.renderClarifications === 'function') {
      window.renderClarifications(patientId);
    }

  } catch (err) {
    area.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
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

function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.loadRecord = loadRecord;

// Load record on start
loadRecord();
