/**
 * public/js/dashboard.js
 * Multi-patient dashboard and search controller.
 */

let allPatients = [];

async function loadPatients(query = '') {
  const tbody = document.getElementById('patients-tbody');
  const searchCount = document.getElementById('search-count');

  try {
    const url = query ? `/api/patients?q=${encodeURIComponent(query)}` : '/api/patients';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load patient directory');

    const data = await res.json();
    const patients = data.patients || [];

    if (!query) {
      allPatients = patients;
      updateStats(patients);
    }

    if (query) {
      searchCount.textContent = `${patients.length} match${patients.length === 1 ? '' : 'es'}`;
    } else {
      searchCount.textContent = `${patients.length} total`;
    }

    if (patients.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 48px;">
            <div class="empty-icon" style="font-size: 2.2rem; margin-bottom: 8px;">📂</div>
            <p style="font-weight: 600; margin-bottom: 4px;">No patients found</p>
            <p class="text-muted" style="font-size: 0.9rem; margin-bottom: 16px;">
              ${query ? 'No patient matched your search query.' : 'Get started by creating your first patient record.'}
            </p>
            <a href="/index.html" class="btn btn-sm">+ Create New Patient</a>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = patients.map(p => {
      const updatedDate = new Date(p.updated_at || p.created_at);
      const formattedDate = updatedDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const formattedTime = updatedDate.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });

      const reportBadge = p.report_count > 0
        ? `<span class="provenance-badge prov-ai" style="font-size:0.75rem;">${p.report_count} report${p.report_count === 1 ? '' : 's'}</span>`
        : `<span class="text-muted" style="font-size:0.8rem;">None</span>`;

      return `
        <tr>
          <td>
            <div>
              <a href="/record.html?id=${p.id}" class="patient-title-link" style="font-family: var(--font-serif); font-size: 1.1rem; font-weight: 600; color: var(--ink-primary);">
                ${escapeHtml(p.name)}
              </a>
            </div>
            <div style="font-size: 0.78rem; color: var(--ink-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 2px;">
              ${escapeHtml(p.mrn)}
            </div>
          </td>
          <td>
            <div style="font-size: 0.88rem; color: var(--ink-secondary);">
              ${p.age !== '—' ? `${p.age} yrs` : 'Age —'} • ${p.sex}
            </div>
          </td>
          <td>
            ${reportBadge}
          </td>
          <td>
            <span style="font-size: 0.88rem; font-weight: 500; font-variant-numeric: tabular-nums;">
              ${p.test_count || 0} tests
            </span>
          </td>
          <td>
            <div style="font-size: 0.84rem; color: var(--ink-primary);">${formattedDate}</div>
            <div style="font-size: 0.76rem; color: var(--ink-muted);">${formattedTime}</div>
          </td>
          <td style="text-align: right;">
            <div style="display: inline-flex; gap: 8px;">
              <a href="/record.html?id=${p.id}" class="btn btn-sm" style="padding: 5px 12px; font-size: 0.8rem;">
                Open Record
              </a>
              <a href="/upload.html?id=${p.id}" class="btn btn-sm btn-outline" style="padding: 5px 10px; font-size: 0.8rem;" title="Upload new report for this patient">
                Upload Report
              </a>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--flag-high-txt); padding: 24px;">
          ${err.message}
        </td>
      </tr>
    `;
  }
}

function updateStats(patients) {
  const totalPatients = patients.length;
  const totalReports = patients.reduce((acc, p) => acc + (p.report_count || 0), 0);
  const totalTests = patients.reduce((acc, p) => acc + (p.test_count || 0), 0);

  const elPatients = document.getElementById('stat-patients');
  const elReports  = document.getElementById('stat-reports');
  const elTests    = document.getElementById('stat-tests');

  if (elPatients) elPatients.textContent = totalPatients;
  if (elReports)  elReports.textContent  = totalReports;
  if (elTests)    elTests.textContent    = totalTests;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Search debounce
let debounceTimer = null;
const searchInput = document.getElementById('search-input');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      loadPatients(e.target.value.trim());
    }, 250);
  });
}

// Initial load
loadPatients();
