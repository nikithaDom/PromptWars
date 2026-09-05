/**
 * lib/validation.js
 * Input validation and sanitization for patient intake and AI extraction payloads.
 * Pure functions with zero side effects.
 */

/**
 * Validates patient intake form submissions.
 * Required fields: age, sex.
 *
 * @param {Object} data - Form body submitted to POST /api/patients
 * @returns {{ isValid: boolean, errors: string[], sanitized: Object }}
 */
function validatePatientIntake(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { isValid: false, errors: ['Request body must be a valid JSON object'], sanitized: {} };
  }

  const rawAge = data.age;
  const rawSex = data.sex;

  // Validate Age
  if (rawAge === undefined || rawAge === null || String(rawAge).trim() === '') {
    errors.push('Age is required');
  } else {
    const parsedAge = Number(rawAge);
    if (!Number.isFinite(parsedAge) || parsedAge < 0 || parsedAge > 130) {
      errors.push('Age must be a valid number between 0 and 130');
    }
  }

  // Validate Sex
  if (rawSex === undefined || rawSex === null || String(rawSex).trim() === '') {
    errors.push('Sex is required');
  } else {
    const validSexes = ['male', 'female', 'other', 'intersex'];
    const normSex = String(rawSex).trim().toLowerCase();
    if (!validSexes.includes(normSex)) {
      errors.push('Sex must be one of: Male, Female, Other, Intersex');
    }
  }

  // Sanitize fields
  const sanitized = {
    name:                String(data.name || '').trim().slice(0, 150),
    mrn:                 String(data.mrn || '').trim().slice(0, 50),
    age:                 data.age !== undefined && data.age !== null && String(data.age).trim() !== '' ? Number(data.age) : null,
    sex:                 String(data.sex || '').trim(),
    symptoms:            String(data.symptoms || '').trim().slice(0, 2000),
    existing_conditions: String(data.existing_conditions || '').trim().slice(0, 2000),
    allergies:           String(data.allergies || '').trim().slice(0, 1000),
    current_medications: String(data.current_medications || '').trim().slice(0, 2000),
    notes:               String(data.notes || '').trim().slice(0, 5000),
  };

  return {
    isValid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Validates and sanitizes the shape of an AI test extraction array before storing.
 * Protects the database from hallucinated or malformed objects.
 *
 * Expected element schema:
 * {
 *   test_name: string (required),
 *   value: number | string (required),
 *   unit: string | null,
 *   reference_range_low: number | string | null,
 *   reference_range_high: number | string | null,
 *   reference_range_raw_text: string | null,
 *   confidence: number (0.0 to 1.0)
 * }
 *
 * @param {any} rawResults - Raw parsed output from the AI extraction model
 * @returns {{ isValid: boolean, errors: string[], results: Array<Object> }}
 */
function validateExtractionResults(rawResults) {
  const errors = [];

  let candidate = rawResults;
  if (!Array.isArray(candidate)) {
    if (candidate && typeof candidate === 'object') {
      if (Array.isArray(candidate.results)) candidate = candidate.results;
      else if (Array.isArray(candidate.test_results)) candidate = candidate.test_results;
      else candidate = null;
    } else {
      candidate = null;
    }
  }

  if (!Array.isArray(candidate)) {
    return {
      isValid: false,
      errors: ['Extraction payload must be a JSON array of test results'],
      results: [],
    };
  }

  const validResults = [];

  candidate.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`Item at index ${index} is not an object`);
      return;
    }

    // 1. test_name must be a non-empty string
    if (typeof item.test_name !== 'string' || item.test_name.trim() === '') {
      errors.push(`Item at index ${index}: test_name must be a non-empty string`);
      return;
    }

    // 2. value must be defined (can be number or non-empty string)
    if (item.value === undefined || item.value === null || (typeof item.value === 'string' && item.value.trim() === '')) {
      errors.push(`Item at index ${index} (${item.test_name}): value is missing or empty`);
      return;
    }

    // Sanitize value
    let val = item.value;
    if (typeof val === 'number') {
      // keep number
    } else if (typeof val === 'string') {
      val = val.trim();
      const asNum = Number(val);
      if (!isNaN(asNum) && val !== '') {
        val = asNum;
      }
    } else {
      errors.push(`Item at index ${index} (${item.test_name}): value must be a number or string`);
      return;
    }

    // 3. unit should be string or null
    let unit = null;
    if (item.unit !== undefined && item.unit !== null) {
      unit = String(item.unit).trim();
      if (unit === '') unit = null;
    }

    // 4. reference boundaries: numeric or null
    let refLow = null;
    if (item.reference_range_low !== undefined && item.reference_range_low !== null && item.reference_range_low !== '') {
      const num = Number(item.reference_range_low);
      refLow = !isNaN(num) ? num : String(item.reference_range_low).trim();
    }

    let refHigh = null;
    if (item.reference_range_high !== undefined && item.reference_range_high !== null && item.reference_range_high !== '') {
      const num = Number(item.reference_range_high);
      refHigh = !isNaN(num) ? num : String(item.reference_range_high).trim();
    }

    let refRawText = null;
    if (item.reference_range_raw_text !== undefined && item.reference_range_raw_text !== null) {
      refRawText = String(item.reference_range_raw_text).trim() || null;
    }

    // 5. confidence: number 0 to 1
    let confidence = 0.85;
    if (typeof item.confidence === 'number' && !isNaN(item.confidence)) {
      confidence = Math.min(1, Math.max(0, item.confidence));
    }

    validResults.push({
      test_name: item.test_name.trim(),
      value: val,
      unit,
      reference_range_low: refLow,
      reference_range_high: refHigh,
      reference_range_raw_text: refRawText,
      confidence,
    });
  });

  return {
    isValid: validResults.length > 0 || candidate.length === 0,
    errors,
    results: validResults,
  };
}

module.exports = {
  validatePatientIntake,
  validateExtractionResults,
};
