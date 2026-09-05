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

// ---- Badge helper ----
function badge(source) {
  if (source === 'user_provided' || source === 'user_edited') {
    return '<span class="badge badge-user">You entered this</span>';
  }
  if (source === 'user_clarified') {
    return '<span class="badge badge-user" style="background:#dcfce7; color:#15803d; border-color:#86efac;">User clarified</span>';
  }
  if (source === 'ai_generated') {
    return '<span class="badge badge-ai" style="background:#f3e8ff; color:#7e22ce;">AI generated</span>';
  }
  return '<span class="badge badge-ai">AI extracted this</span>';
}

// ---- Confidence score indicator ----
function confidenceBadge(conf) {
  if (typeof conf !== 'number' || isNaN(conf)) return '';
  const pct = Math.round(conf <= 1 ? conf * 100 : conf);
  if (pct >= 85) {
    return `<span class="conf-pill conf-high" title="AI Extraction Confidence: ${pct}%">● ${pct}%</span>`;
  }
  if (pct >= 70) {
    return `<span class="conf-pill conf-med" title="AI Extraction Confidence: ${pct}%">● ${pct}%</span>`;
  }
  return `<span class="conf-pill conf-low" title="Low Extraction Confidence: ${pct}% (Review recommended)">● ${pct}% Review</span>`;
}

// ---- Flag helper (pure JavaScript, no LLM) ----
function flagChip(value, low, high) {
  if (low === null || low === undefined || high === null || high === undefined) {
    return { html: '<span class="flag flag-none">Range not provided</span>', flag: 'none' };
  }

  const num = parseFloat(value);
  if (isNaN(num)) {
    return { html: '<span class="flag flag-none">Range not provided</span>', flag: 'none' };
  }

  if (num < parseFloat(low))  return { html: '<span class="flag flag-low">Low</span>', flag: 'Low' };
  if (num > parseFloat(high)) return { html: '<span class="flag flag-high">High</span>', flag: 'High' };
  return { html: '<span class="flag flag-normal">Normal</span>', flag: 'Normal' };
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
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <h1 style="margin: 0; font-size: 1.65rem;">${escapeHtml(patientName)}</h1>
            <span class="mrn-badge">${escapeHtml(patientMrn)}</span>
          </div>
          <p class="page-sub" style="margin-top: 4px;">
            Demographics: ${f.age?.value || '—'} yrs, ${f.sex?.value || '—'} • Created ${new Date(patient.created_at).toLocaleDateString()}
          </p>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button type="button" class="btn btn-sm btn-outline" onclick="window.exportRecordAsPdf('${patientId}')" title="Download printable clinical PDF with provenance badges">
            📄 Export Record as PDF
          </button>
          <a href="/upload.html?id=${patientId}" class="btn btn-sm">+ Upload Lab Report</a>
          <a href="/summary.html?id=${patientId}" class="btn btn-sm btn-purple">Generate Summary</a>
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
      ['Existing Conditions',  'existing_conditions',  f.existing_conditions?.value,  f.existing_conditions?.source],
      ['Allergies',            'allergies',            f.allergies?.value,            f.allergies?.source],
      ['Current Medications',  'current_medications',  f.current_medications?.value,  f.current_medications?.source],
      ['Notes',                'notes',                f.notes?.value,                f.notes?.source],
    ];

    const infoHtml = infoFields.map(([label, key, val, src]) => `
      <div class="info-row">
        <span class="info-label">${label}</span>
        <span class="info-value">
          <span>${escapeHtml(val || '—')}</span>
          <span style="display: inline-flex; align-items: center; gap: 6px;">
            ${badge(src || 'user_provided')}
            <button
              type="button"
              class="btn-edit-inline"
              title="Edit ${label}"
              onclick="window.editPatientField('${patientId}', 'patient_field', '${key}', '${escapeAttr(val || '')}', { label: '${label}' })"
            >✎ Edit</button>
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
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 1.05rem; font-weight: 600;">${escapeHtml(String(testVal))}</span>
                  <button
                    type="button"
                    class="btn-edit-inline"
                    title="Edit test value"
                    onclick="window.editPatientField('${patientId}', 'test_result', 'value', '${escapeAttr(String(testVal))}', { reportId: '${report.id}', testId: '${r.id}', label: '${escapeAttr(testName)} value' })"
                  >✎</button>
                </div>
                <div>${badge(r.value?.source)}</div>
              </td>
              <td>
                ${escapeHtml(r.unit?.value || '—')}
                <div>${badge(r.unit?.source)}</div>
              </td>
              <td>
                ${escapeHtml(rangeText)}
                <div>${badge(r.reference_range_raw_text?.source)}</div>
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
                     <th>Test Name &amp; Confidence</th>
                     <th>Value</th>
                     <th>Unit</th>
                     <th>Reference Range</th>
                     <th>Status</th>
                     <th style="text-align: right;">Clinician Review</th>
                   </tr>
                 </thead>
                 <tbody>${tableRows}</tbody>
               </table>
             </div>`;

        return `
          <div class="card" style="margin-bottom: 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; flex-wrap:wrap; gap:8px;">
              <h3 style="margin:0;">
                Report ${idx + 1} — ${escapeHtml(report.filename)}
              </h3>
              <span class="text-muted" style="font-size:0.8rem;">
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
      <div class="card filter-bar-card" style="margin-bottom: 16px; padding: 14px 18px;">
        <div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 220px; position: relative;">
            <input
              type="text"
              id="test-filter-search"
              placeholder="🔍 Filter tests by name (e.g. glucose, bun)…"
              style="width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 7px 12px; font-size: 0.88rem;"
            >
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <label for="test-filter-status" style="font-size: 0.82rem; color: var(--text-muted);">Status:</label>
            <select id="test-filter-status" style="border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 0.85rem;">
              <option value="all">All Statuses</option>
              <option value="Low">Low</option>
              <option value="Normal">Normal</option>
              <option value="High">High</option>
              <option value="none">Range not provided</option>
            </select>
          </div>

          <div style="display: flex; align-items: center; gap: 6px; background: #fef2f2; border: 1px solid #fee2e2; padding: 6px 12px; border-radius: 6px;">
            <input type="checkbox" id="test-filter-review" style="cursor: pointer;">
            <label for="test-filter-review" style="font-size: 0.82rem; font-weight: 600; color: #b91c1c; cursor: pointer;">
              Show only items needing review
            </label>
          </div>

          <span id="filter-results-count" class="text-muted" style="font-size: 0.8rem; margin-left: auto;"></span>
        </div>
      </div>
    ` : '';

    // ---- Assemble the Clinical Record Tab ----
    area.innerHTML = `
      <div class="card" style="margin-bottom: 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="margin:0;">Patient Information</h3>
          <span class="text-muted" style="font-size:0.8rem;">Click ✎ to edit any field</span>
        </div>
        ${infoHtml}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin: 24px 0 12px 0;">
        <h3 style="margin:0;">Lab Reports (${(patient.reports || []).length})</h3>
        <a href="/upload.html?id=${patientId}" class="btn btn-sm btn-outline">+ Add Another Report</a>
      </div>

      ${filterControlsHtml}
      <div id="reports-list-container">
        ${reportsHtml}
      </div>

      <div class="flex-gap mt-24" style="border-top: 1px solid var(--border); padding-top: 20px;">
        <button type="button" class="btn btn-outline" onclick="window.exportRecordAsPdf('${patientId}')">
          📄 Export Record as PDF
        </button>
        <a href="/upload.html?id=${patientId}" class="btn">Upload Another Report</a>
        <a href="/summary.html?id=${patientId}" class="btn btn-purple">Generate Summary</a>
        <a href="/dashboard.html" class="btn btn-outline">← Back to Patient Directory</a>
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
