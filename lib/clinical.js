/**
 * lib/clinical.js
 * Standalone pure clinical calculation and inconsistency comparison helpers.
 * Contains no database or network API calls.
 */

/**
 * Computes a clinical reference status flag based on a test result value and range boundaries.
 *
 * Rules:
 *  - Returns 'LOW' if numeric value < low boundary
 *  - Returns 'HIGH' if numeric value > high boundary
 *  - Returns 'NORMAL' if numeric value >= low and <= high boundary
 *  - Returns 'Range not provided' if low or high is missing/null/empty or if value is non-numeric/empty
 *
 * @param {number|string|null|undefined} value - Extracted test result value
 * @param {number|string|null|undefined} low - Reference range lower boundary
 * @param {number|string|null|undefined} high - Reference range upper boundary
 * @returns {'LOW' | 'NORMAL' | 'HIGH' | 'Range not provided'}
 */
function computeReferenceFlag(value, low, high) {
  if (low === null || low === undefined || high === null || high === undefined) {
    return 'Range not provided';
  }

  // Treat empty strings as missing
  if (typeof low === 'string' && low.trim() === '') return 'Range not provided';
  if (typeof high === 'string' && high.trim() === '') return 'Range not provided';
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return 'Range not provided';
  }

  const numValue = typeof value === 'number' ? value : parseFloat(String(value).trim());
  const numLow   = typeof low === 'number'   ? low   : parseFloat(String(low).trim());
  const numHigh  = typeof high === 'number'  ? high  : parseFloat(String(high).trim());

  if (isNaN(numValue) || isNaN(numLow) || isNaN(numHigh)) {
    return 'Range not provided';
  }

  if (numValue < numLow) return 'LOW';
  if (numValue > numHigh) return 'HIGH';
  return 'NORMAL';
}

/**
 * Pure algorithmic detection of severe, implausible test value jumps across chronological reports.
 * No database or network access.
 *
 * Criteria for warning flag:
 *  - Same test appearing across 2+ reports
 *  - Within a 14-day window
 *  - Shift is >= 200% change or >= 3x fold increase/decrease
 *
 * @param {Object|Array} patientOrReports - Patient record with .reports or an array of reports
 * @returns {Array<Object>} List of detected divergence conflict objects
 */
function checkCrossReportDivergence(patientOrReports) {
  const detected = [];
  const rawReports = Array.isArray(patientOrReports)
    ? patientOrReports
    : (patientOrReports?.reports || []);

  const reports = rawReports.slice().sort(
    (a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at)
  );

  if (reports.length < 2) return detected;

  // Map readings by normalized test name
  const testMap = new Map();
  reports.forEach(report => {
    (report.results || []).forEach(r => {
      const rawName = r.test_name?.value ?? r.test_name ?? '';
      const name = String(rawName).trim().toLowerCase();
      const rawVal = r.value?.value ?? r.value;
      const num = parseFloat(rawVal);
      if (!name || isNaN(num)) return;

      if (!testMap.has(name)) testMap.set(name, []);
      testMap.get(name).push({
        reportId: report.id,
        filename: report.filename,
        date: new Date(report.uploaded_at),
        value: num,
        unit: r.unit?.value ?? r.unit ?? '',
        testName: rawName,
      });
    });
  });

  testMap.forEach((readings) => {
    if (readings.length < 2) return;

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];
      const daysDiff = Math.abs((curr.date - prev.date) / (1000 * 60 * 60 * 24));

      if (prev.value > 0) {
        const foldChange = curr.value / prev.value;
        const percentChange = Math.abs((curr.value - prev.value) / prev.value) * 100;

        // Severe divergence: > 200% shift or > 3x change within 14 days
        if ((percentChange >= 200 || foldChange >= 3 || foldChange <= 0.33) && daysDiff <= 14) {
          detected.push({
            id: `conf-div-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            created_at: new Date().toISOString(),
            type: 'test_divergence',
            title: `Substantial variation in ${curr.testName}`,
            reason: `Possible inconsistency — needs human review: ${curr.testName} shifted from ${prev.value} ${prev.unit} (${prev.filename}) to ${curr.value} ${curr.unit} (${curr.filename}) across a ${Math.round(daysDiff)}-day interval. This may represent an acute change, different assay methodology, or transcription discrepancy.`,
            status: 'pending',
            severity: 'warning',
            details: {
              testName: curr.testName,
              prevValue: prev.value,
              currValue: curr.value,
              unit: curr.unit,
            },
          });
        }
      }
    }
  });

  return detected;
}

module.exports = {
  computeReferenceFlag,
  checkCrossReportDivergence,
};
