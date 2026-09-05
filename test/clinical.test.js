/**
 * test/clinical.test.js
 * Unit tests for clinical reference-range evaluation and conflict detection logic.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeReferenceFlag, checkCrossReportDivergence } = require('../lib/clinical');

describe('Reference Range Flagging Logic (computeReferenceFlag)', () => {

  // 1. Value below range
  test('returns "LOW" when numeric value is strictly below lower bound', () => {
    assert.equal(computeReferenceFlag(65, 70, 99), 'LOW');
    assert.equal(computeReferenceFlag('69.9', 70, 99), 'LOW');
    assert.equal(computeReferenceFlag(0.5, 1.0, 5.0), 'LOW');
  });

  // 2. Value above range
  test('returns "HIGH" when numeric value is strictly above upper bound', () => {
    assert.equal(computeReferenceFlag(140, 70, 99), 'HIGH');
    assert.equal(computeReferenceFlag('100.1', 70, 99), 'HIGH');
    assert.equal(computeReferenceFlag(7.8, 4.0, 5.6), 'HIGH');
  });

  // 3. Value in range
  test('returns "NORMAL" when numeric value is within bounds (inclusive)', () => {
    assert.equal(computeReferenceFlag(85, 70, 99), 'NORMAL');
    assert.equal(computeReferenceFlag('85.5', 70, 99), 'NORMAL');
    // Boundary conditions
    assert.equal(computeReferenceFlag(70, 70, 99), 'NORMAL', 'Exact lower bound should be NORMAL');
    assert.equal(computeReferenceFlag(99, 70, 99), 'NORMAL', 'Exact upper bound should be NORMAL');
  });

  // 4. Missing reference range
  test('returns "Range not provided" when reference range is missing or incomplete', () => {
    assert.equal(computeReferenceFlag(85, null, 99), 'Range not provided', 'Missing low bound');
    assert.equal(computeReferenceFlag(85, 70, null), 'Range not provided', 'Missing high bound');
    assert.equal(computeReferenceFlag(85, null, null), 'Range not provided', 'Missing both bounds');
    assert.equal(computeReferenceFlag(85, undefined, 99), 'Range not provided', 'Undefined low bound');
    assert.equal(computeReferenceFlag(85, '', ''), 'Range not provided', 'Empty string bounds');
  });

  // 5. Malformed or non-numeric value
  test('returns "Range not provided" when value is malformed, non-numeric, or empty', () => {
    assert.equal(computeReferenceFlag('POSITIVE', 70, 99), 'Range not provided');
    assert.equal(computeReferenceFlag('NORMAL', 0, 1), 'Range not provided');
    assert.equal(computeReferenceFlag('N/A', 70, 99), 'Range not provided');
    assert.equal(computeReferenceFlag('', 70, 99), 'Range not provided');
    assert.equal(computeReferenceFlag(null, 70, 99), 'Range not provided');
    assert.equal(computeReferenceFlag(undefined, 70, 99), 'Range not provided');
    assert.equal(computeReferenceFlag(NaN, 70, 99), 'Range not provided');
  });

  // Additional edge cases: string trimming and numeric conversions
  test('handles string values with whitespace cleanly', () => {
    assert.equal(computeReferenceFlag('  55  ', ' 70 ', ' 99 '), 'LOW');
    assert.equal(computeReferenceFlag(' 120 ', ' 70 ', ' 99 '), 'HIGH');
    assert.equal(computeReferenceFlag(' 80 ', ' 70 ', ' 99 '), 'NORMAL');
  });
});

describe('Cross-Report Inconsistency Detection (checkCrossReportDivergence)', () => {
  test('returns empty array when patient has fewer than 2 reports', () => {
    const patient = {
      reports: [
        {
          id: 'rep-1',
          uploaded_at: '2026-01-01T00:00:00.000Z',
          results: [{ test_name: { value: 'Hemoglobin' }, value: { value: 14 } }],
        },
      ],
    };
    const conflicts = checkCrossReportDivergence(patient);
    assert.deepEqual(conflicts, []);
  });

  test('detects severe divergence (>200% shift within 14 days)', () => {
    const patient = {
      reports: [
        {
          id: 'rep-1',
          filename: 'report_jan01.pdf',
          uploaded_at: '2026-01-01T00:00:00.000Z',
          results: [{ test_name: { value: 'Potassium' }, value: { value: 3.5 }, unit: { value: 'mEq/L' } }],
        },
        {
          id: 'rep-2',
          filename: 'report_jan05.pdf',
          uploaded_at: '2026-01-05T00:00:00.000Z',
          results: [{ test_name: { value: 'Potassium' }, value: { value: 11.0 }, unit: { value: 'mEq/L' } }],
        },
      ],
    };

    const conflicts = checkCrossReportDivergence(patient);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'test_divergence');
    assert.equal(conflicts[0].details.testName, 'Potassium');
    assert.equal(conflicts[0].details.prevValue, 3.5);
    assert.equal(conflicts[0].details.currValue, 11.0);
  });

  test('does not flag normal fluctuations or shifts outside the 14-day window', () => {
    const patient = {
      reports: [
        {
          id: 'rep-1',
          filename: 'report_jan01.pdf',
          uploaded_at: '2026-01-01T00:00:00.000Z',
          results: [{ test_name: { value: 'Potassium' }, value: { value: 4.0 }, unit: { value: 'mEq/L' } }],
        },
        {
          id: 'rep-2',
          filename: 'report_mar01.pdf',
          uploaded_at: '2026-03-01T00:00:00.000Z', // 60 days later
          results: [{ test_name: { value: 'Potassium' }, value: { value: 15.0 }, unit: { value: 'mEq/L' } }],
        },
      ],
    };

    const conflicts = checkCrossReportDivergence(patient);
    assert.equal(conflicts.length, 0, 'Should not flag divergence over long time intervals');
  });
});
