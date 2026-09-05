/**
 * test/validation.test.js
 * Unit tests for input validation (patient intake and AI extraction schema).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validatePatientIntake, validateExtractionResults } = require('../lib/validation');

describe('Patient Intake Validation (validatePatientIntake)', () => {

  test('fails when required fields (age, sex) are missing', () => {
    // Missing both
    const resultEmpty = validatePatientIntake({});
    assert.equal(resultEmpty.isValid, false);
    assert.ok(resultEmpty.errors.some(e => e.toLowerCase().includes('age')));
    assert.ok(resultEmpty.errors.some(e => e.toLowerCase().includes('sex')));

    // Missing age only
    const resultNoAge = validatePatientIntake({ sex: 'Female' });
    assert.equal(resultNoAge.isValid, false);
    assert.ok(resultNoAge.errors.some(e => e.toLowerCase().includes('age')));

    // Missing sex only
    const resultNoSex = validatePatientIntake({ age: 45 });
    assert.equal(resultNoSex.isValid, false);
    assert.ok(resultNoSex.errors.some(e => e.toLowerCase().includes('sex')));
  });

  test('fails when age is invalid (negative or non-numeric)', () => {
    const resultNegative = validatePatientIntake({ age: -5, sex: 'Male' });
    assert.equal(resultNegative.isValid, false);

    const resultNotNum = validatePatientIntake({ age: 'forty', sex: 'Male' });
    assert.equal(resultNotNum.isValid, false);

    const resultTooOld = validatePatientIntake({ age: 250, sex: 'Male' });
    assert.equal(resultTooOld.isValid, false);
  });

  test('fails when sex is invalid value', () => {
    const resultInvalidSex = validatePatientIntake({ age: 30, sex: 'InvalidOption' });
    assert.equal(resultInvalidSex.isValid, false);
    assert.ok(resultInvalidSex.errors.some(e => e.includes('Sex must be one of')));
  });

  test('passes and sanitizes valid patient intake payload', () => {
    const payload = {
      name: ' Jane Doe ',
      mrn: ' MRN-998811 ',
      age: '42',
      sex: 'Female',
      symptoms: 'Mild headache',
      existing_conditions: 'Asthma',
      allergies: 'Penicillin',
      current_medications: 'Albuterol',
      notes: 'Initial consultation',
    };

    const result = validatePatientIntake(payload);
    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.sanitized.name, 'Jane Doe');
    assert.equal(result.sanitized.age, 42);
    assert.equal(result.sanitized.sex, 'Female');
    assert.equal(result.sanitized.allergies, 'Penicillin');
  });
});

describe('AI Extraction Schema Validation (validateExtractionResults)', () => {

  test('fails if payload is not an array or valid result container', () => {
    assert.equal(validateExtractionResults(null).isValid, false);
    assert.equal(validateExtractionResults('string').isValid, false);
    assert.equal(validateExtractionResults({ random: 'object' }).isValid, false);
  });

  test('validates and cleans a well-formed extraction result array', () => {
    const rawResults = [
      {
        test_name: 'Glucose, Fasting',
        value: 105,
        unit: 'mg/dL',
        reference_range_low: 70,
        reference_range_high: 99,
        reference_range_raw_text: '70-99 mg/dL',
        confidence: 0.95,
      },
      {
        test_name: 'Blood Pressure Systolic',
        value: '120',
        unit: 'mmHg',
        reference_range_low: null,
        reference_range_high: 120,
        reference_range_raw_text: null,
        confidence: 0.88,
      },
    ];

    const result = validateExtractionResults(rawResults);
    assert.equal(result.isValid, true);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].test_name, 'Glucose, Fasting');
    assert.equal(result.results[0].value, 105);
    assert.equal(result.results[1].value, 120, 'String numeric values should be converted to numbers');
  });

  test('flags or discards items missing required fields (test_name or value)', () => {
    const rawResults = [
      {
        // missing test_name
        value: 12,
        unit: 'g/dL',
      },
      {
        test_name: 'Hemoglobin',
        // missing value
        unit: 'g/dL',
      },
      {
        test_name: 'Valid Test',
        value: 5.2,
        unit: 'mmol/L',
      },
    ];

    const result = validateExtractionResults(rawResults);
    // The valid item should survive
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].test_name, 'Valid Test');
    // Errors should record the discarded invalid items
    assert.ok(result.errors.length >= 2);
  });

  test('normalizes confidence and bounds', () => {
    const rawResults = [
      {
        test_name: 'WBC',
        value: 6.8,
        unit: 'K/uL',
        reference_range_low: '4.5',
        reference_range_high: '11.0',
        confidence: 1.5, // exceeds 1.0, should clamp to 1.0
      },
    ];

    const result = validateExtractionResults(rawResults);
    assert.equal(result.isValid, true);
    assert.equal(result.results[0].reference_range_low, 4.5);
    assert.equal(result.results[0].reference_range_high, 11.0);
    assert.equal(result.results[0].confidence, 1.0);
  });
});
