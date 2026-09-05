/**
 * routes/export.js
 * Clinical Record PDF / Printable Export Engine.
 *
 * Generates a clean, print-ready clinical report formatted with:
 *  - Explicit text provenance badges (e.g. [User provided], [AI extracted], [User clarified])
 *  - Demographics & medical history
 *  - Test results with reference ranges and computed status flags
 *  - Inconsistency flags & audit review notes
 *  - AI plain-language summary with standard non-diagnostic disclaimer
 */
const express = require('express');
const router  = express.Router();
const { readDB } = require('../data/db');
const { requireAuth } = require('../middleware/auth');
const { computeReferenceFlag } = require('../lib/clinical');

router.use(requireAuth);

function flagChip(value, low, high) {
  return computeReferenceFlag(value, low, high);
}

function provenanceLabel(source) {
  if (source === 'user_provided' || source === 'user_edited') return '[User provided]';
  if (source === 'user_clarified') return '[User clarified]';
  if (source === 'ai_generated') return '[AI generated]';
  return '[AI extracted]';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

router.get('/:id/export', (req, res) => {
  const db = readDB();
  const patient = db.patients.find(p => p.id === req.params.id);

  if (!patient) {
    return res.status(404).send('Patient not found');
  }

  const f = patient.fields || {};
  const patientName = f.name?.value || `Patient #${patient.id.slice(-4)}`;
  const patientMrn  = f.mrn?.value  || `MRN-${patient.id.slice(-6)}`;
  const reports = patient.reports || [];
  const latestSummary = patient.latest_summary?.text || null;
  const conflicts = patient.conflicts || [];
  const clinicianName = req.user?.name || 'Attending Physician';
  const autoPrint = req.query.autoprint === '1';

  // Build Demographics HTML
  const demoFields = [
    ['Full Name', f.name?.value, f.name?.source],
    ['MRN / ID', f.mrn?.value, f.mrn?.source],
    ['Age', f.age?.value ? `${f.age.value} years` : '—', f.age?.source],
    ['Biological Sex', f.sex?.value, f.sex?.source],
    ['Current Symptoms', f.symptoms?.value, f.symptoms?.source],
    ['Existing Conditions', f.existing_conditions?.value, f.existing_conditions?.source],
    ['Allergies', f.allergies?.value, f.allergies?.source],
    ['Current Medications', f.current_medications?.value, f.current_medications?.source],
    ['Clinical Notes', f.notes?.value, f.notes?.source],
  ];

  const demoHtml = demoFields.map(([label, val, src]) => `
    <tr>
      <th style="width: 28%; text-align: left; padding: 6px 10px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 0.88rem;">${label}</th>
      <td style="padding: 6px 10px; border: 1px solid #e2e8f0; font-size: 0.9rem;">
        ${escapeHtml(val || '—')}
        <span style="font-size: 0.75rem; color: #475569; font-weight: 600; margin-left: 8px;">${provenanceLabel(src)}</span>
      </td>
    </tr>
  `).join('');

  // Build Reports HTML
  let reportsHtml = '';
  if (reports.length === 0) {
    reportsHtml = '<p style="color: #64748b; font-style: italic;">No lab reports recorded for this patient.</p>';
  } else {
    reportsHtml = reports.map((r, idx) => {
      const rows = (r.results || []).map(item => {
        const flag = flagChip(item.value?.value, item.reference_range_low?.value, item.reference_range_high?.value);
        let flagStyle = 'color: #15803d; font-weight: 600;';
        if (flag === 'LOW') flagStyle = 'color: #b45309; font-weight: bold; background: #fef3c7; padding: 2px 6px; border-radius: 3px;';
        if (flag === 'HIGH') flagStyle = 'color: #b91c1c; font-weight: bold; background: #fee2e2; padding: 2px 6px; border-radius: 3px;';

        const verStatus = item.verified
          ? `✓ Verified by ${escapeHtml(item.verified_by || 'Clinician')}`
          : 'Pending verification';

        return `
          <tr>
            <td style="padding: 6px 10px; border: 1px solid #cbd5e1; font-weight: 600;">
              ${escapeHtml(item.test_name?.value || '—')}
              <div style="font-size: 0.72rem; color: #64748b; font-weight: normal;">${provenanceLabel(item.test_name?.source)}</div>
            </td>
            <td style="padding: 6px 10px; border: 1px solid #cbd5e1;">
              <strong>${escapeHtml(String(item.value?.value ?? '—'))}</strong>
              <span style="font-size: 0.72rem; color: #64748b; margin-left: 4px;">${provenanceLabel(item.value?.source)}</span>
            </td>
            <td style="padding: 6px 10px; border: 1px solid #cbd5e1;">${escapeHtml(item.unit?.value || '—')}</td>
            <td style="padding: 6px 10px; border: 1px solid #cbd5e1; font-size: 0.85rem;">${escapeHtml(item.reference_range_raw_text?.value || '—')}</td>
            <td style="padding: 6px 10px; border: 1px solid #cbd5e1;"><span style="${flagStyle}">${flag}</span></td>
            <td style="padding: 6px 10px; border: 1px solid #cbd5e1; font-size: 0.78rem; color: #475569;">${verStatus}</td>
          </tr>
        `;
      }).join('');

      return `
        <div style="margin-bottom: 24px; page-break-inside: avoid;">
          <h4 style="margin: 0 0 8px 0; color: #1e293b; font-size: 1rem;">
            Report ${idx + 1}: ${escapeHtml(r.filename)}
            <span style="font-size: 0.8rem; font-weight: normal; color: #64748b;">(Uploaded: ${new Date(r.uploaded_at).toLocaleDateString()})</span>
          </h4>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
            <thead>
              <tr style="background: #f1f5f9; font-size: 0.8rem; text-transform: uppercase;">
                <th style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: left;">Analyte</th>
                <th style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: left;">Value</th>
                <th style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: left;">Unit</th>
                <th style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: left;">Reference Range</th>
                <th style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: left;">Status</th>
                <th style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: left;">Provenance / Review</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }).join('');
  }

  // Build Inconsistencies HTML
  let conflictsHtml = '';
  if (conflicts.length > 0) {
    const conflictItems = conflicts.map(c => `
      <li style="margin-bottom: 8px; font-size: 0.88rem;">
        <strong>[Possible Inconsistency — Needs Human Review] ${escapeHtml(c.title)}:</strong>
        ${escapeHtml(c.reason)}
        <span style="font-size: 0.75rem; color: #64748b;">(Status: ${c.status === 'acknowledged' ? `Acknowledged by ${escapeHtml(c.acknowledged_by || 'Clinician')}` : 'Pending review'})</span>
      </li>
    `).join('');

    conflictsHtml = `
      <div style="margin-bottom: 24px; padding: 12px 16px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; page-break-inside: avoid;">
        <h3 style="margin: 0 0 8px 0; color: #92400e; font-size: 0.95rem;">Audited Inconsistencies &amp; Review Flags</h3>
        <ul style="margin: 0; padding-left: 20px; color: #78350f;">
          ${conflictItems}
        </ul>
      </div>
    `;
  }

  // Build Summary HTML
  let summaryHtml = '';
  if (latestSummary) {
    summaryHtml = `
      <div style="margin-bottom: 24px; page-break-inside: avoid;">
        <h3 style="margin: 0 0 8px 0; font-size: 1.05rem; color: #1e293b;">
          Plain-Language Record Summary
          <span style="font-size: 0.78rem; font-weight: 600; color: #6d28d9; margin-left: 8px;">[AI generated]</span>
        </h3>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 18px; font-size: 0.92rem; line-height: 1.6; white-space: pre-wrap;">
          ${escapeHtml(latestSummary)}
        </div>
      </div>
    `;
  }

  const exportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MedLens Clinical Record — ${escapeHtml(patientName)} (${escapeHtml(patientMrn)})</title>
  <style>
    @page {
      margin: 15mm 12mm;
      size: A4 portrait;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.5;
      font-size: 10pt;
      margin: 0;
      padding: 24px;
      background: #fff;
    }
    .header-bar {
      border-bottom: 2px solid #2563eb;
      padding-bottom: 12px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .brand {
      font-size: 18pt;
      font-weight: 800;
      color: #2563eb;
      letter-spacing: -0.5px;
    }
    .subtitle {
      font-size: 8.5pt;
      color: #64748b;
      margin-top: 2px;
    }
    .export-meta {
      text-align: right;
      font-size: 8.5pt;
      color: #475569;
    }
    h2, h3 {
      color: #1e293b;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
      margin-top: 20px;
      margin-bottom: 12px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    .disclaimer-box {
      margin-top: 30px;
      padding: 12px 16px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      font-size: 8.5pt;
      color: #475569;
      text-align: center;
      page-break-inside: avoid;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

  <div class="no-print" style="margin-bottom: 20px; background: #eff6ff; border: 1px solid #bfdbfe; padding: 12px 18px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
    <div>
      <strong style="color: #1d4ed8;">Clinical Record Ready for PDF Export</strong>
      <div style="font-size: 0.85rem; color: #3b82f6;">Use your browser's Print dialog and choose "Save as PDF". Provenance text tags [AI extracted], [User provided], and [User clarified] are preserved.</div>
    </div>
    <button onclick="window.print()" style="background: #2563eb; color: #fff; border: none; padding: 8px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.9rem;">
      🖨️ Print / Save as PDF
    </button>
  </div>

  <div class="header-bar">
    <div>
      <div class="brand">⚕ MedLens Clinical Record</div>
      <div class="subtitle">Structured Patient Record &amp; Provenance-Preserved Lab Report</div>
    </div>
    <div class="export-meta">
      <div><strong>Record Date:</strong> ${new Date().toLocaleDateString()}</div>
      <div><strong>Generated by:</strong> ${escapeHtml(clinicianName)}</div>
      <div><strong>Patient MRN:</strong> ${escapeHtml(patientMrn)}</div>
    </div>
  </div>

  <h3 style="margin-top: 0;">Patient Demographics &amp; History</h3>
  <table style="margin-bottom: 24px;">
    <tbody>${demoHtml}</tbody>
  </table>

  ${conflictsHtml}

  <h3>Laboratory Test Results (${reports.length} report${reports.length === 1 ? '' : 's'})</h3>
  ${reportsHtml}

  ${summaryHtml}

  <div class="disclaimer-box">
    <strong>CLINICAL AUDIT &amp; LEGAL DISCLAIMER:</strong><br>
    This is not a medical diagnosis — talk to a healthcare professional about these results.<br>
    All laboratory values reflect extracted data with provenance indicated ([User provided], [AI extracted], [User clarified]). Status classifications (LOW/NORMAL/HIGH) are computed strictly from document reference ranges.
  </div>

  ${autoPrint ? '<script>window.addEventListener("load", () => setTimeout(() => window.print(), 500));</script>' : ''}
</body>
</html>`;

  res.send(exportHtml);
});

module.exports = router;
