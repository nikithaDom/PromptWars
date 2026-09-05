/**
 * public/js/export.js
 * Client-side trigger for clinical PDF export.
 */

function exportRecordAsPdf(patientId) {
  if (!patientId) return;
  const exportUrl = `/api/patients/${patientId}/export?autoprint=1`;
  window.open(exportUrl, '_blank');
}

window.exportRecordAsPdf = exportRecordAsPdf;
