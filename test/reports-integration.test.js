/**
 * test/reports-integration.test.js
 * Integration test for the report extraction endpoint (POST /api/patients/:id/reports).
 * Mocks the AI extraction model response (no real API or network calls).
 * Verifies that results are stored with source: "ai_extracted" and the correct computed flag.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');
const { readDB, writeDB } = require('../data/db');
const { createSession } = require('../middleware/auth');
const reportsRouter = require('../routes/reports');

describe('Report Extraction Integration Test (POST /api/patients/:id/reports)', () => {
  let server;
  let baseUrl;
  let sessionToken;
  let testPatientId;

  before(async () => {
    // Start server on an ephemeral port
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });

    // Create an authenticated test session
    sessionToken = createSession({
      email: 'test-clinician@medlens.local',
      name: 'Dr. Test Clinician',
      role: 'Attending Physician',
    });

    // Seed a dedicated test patient into the DB
    const db = readDB();
    testPatientId = `test-patient-${Date.now()}`;
    db.patients.push({
      id: testPatientId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      fields: {
        name: { value: 'Integration Test Patient', source: 'user_provided' },
        age: { value: 50, source: 'user_provided' },
        sex: { value: 'Female', source: 'user_provided' },
      },
      reports: [],
      timeline: [],
      conflicts: [],
      clarifications: [],
    });
    writeDB(db);
  });

  after(async () => {
    // Reset custom mock extractor
    reportsRouter.setExtractor(null);

    // Clean up test patient
    const db = readDB();
    db.patients = db.patients.filter((p) => p.id !== testPatientId);
    writeDB(db);

    // Close server
    await new Promise((resolve) => server.close(resolve));
  });

  test('successfully processes report with mocked AI extraction, storing source: ai_extracted and computed flag: HIGH', async () => {
    // 1. Mock the AI response to return a test result with known range (A1c: 7.8, Range: 4.0 - 5.6 -> HIGH)
    const mockedAIResponse = JSON.stringify([
      {
        test_name: 'Hemoglobin A1c',
        value: 7.8,
        unit: '%',
        reference_range_low: 4.0,
        reference_range_high: 5.6,
        reference_range_raw_text: '4.0 - 5.6 %',
        confidence: 0.95,
      },
    ]);

    reportsRouter.setExtractor(async () => mockedAIResponse);

    // 2. Prepare multipart form data with a sample report file
    const formData = new FormData();
    const fakeFileContent = '%PDF-1.4 Mock Lab Report Content';
    const fakeFileBlob = new Blob([fakeFileContent], { type: 'application/pdf' });
    formData.append('report', fakeFileBlob, 'test_lab_report.pdf');

    // 3. Send POST request to /api/patients/:id/reports with authorization cookie
    const response = await fetch(`${baseUrl}/api/patients/${testPatientId}/reports`, {
      method: 'POST',
      headers: {
        Cookie: `medlens_session=${sessionToken}`,
      },
      body: formData,
    });

    assert.equal(response.status, 200, `Expected HTTP 200, received ${response.status}`);
    const json = await response.json();
    assert.equal(json.message, 'Report processed');
    assert.equal(json.results_count, 1);
    assert.ok(json.report_id, 'Expected report_id in response');

    // 4. Verify patient record in database
    const db = readDB();
    const updatedPatient = db.patients.find((p) => p.id === testPatientId);
    assert.ok(updatedPatient, 'Patient record must exist in DB');
    assert.equal(updatedPatient.reports.length, 1, 'Patient should have 1 report attached');

    const savedReport = updatedPatient.reports[0];
    assert.equal(savedReport.filename, 'test_lab_report.pdf');
    assert.equal(savedReport.results.length, 1);

    const resultItem = savedReport.results[0];

    // Assert provenance: all extracted fields must have source: "ai_extracted"
    assert.equal(resultItem.test_name.source, 'ai_extracted');
    assert.equal(resultItem.test_name.value, 'Hemoglobin A1c');

    assert.equal(resultItem.value.source, 'ai_extracted');
    assert.equal(resultItem.value.value, 7.8);

    assert.equal(resultItem.unit.source, 'ai_extracted');
    assert.equal(resultItem.unit.value, '%');

    assert.equal(resultItem.reference_range_low.source, 'ai_extracted');
    assert.equal(resultItem.reference_range_low.value, 4.0);

    assert.equal(resultItem.reference_range_high.source, 'ai_extracted');
    assert.equal(resultItem.reference_range_high.value, 5.6);

    // Assert computed reference flag
    assert.equal(resultItem.flag, 'HIGH', 'Computed flag must be HIGH since 7.8 > 5.6');
    assert.equal(resultItem.computed_flag, 'HIGH');
  });
});
