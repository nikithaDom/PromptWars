# MedLens 🩺

> Turn patient medical info and lab reports into structured records with explicit provenance, automatic clinical range flagging, and inconsistency detection.

MedLens is a clinical assistance tool that processes patient profiles, extracts lab test results from uploaded PDF or image reports via Google Gemini AI, validates medical data schemas, computes reference range flags, and identifies cross-report divergences.

---

## Features

- **Field-Level Clinical Provenance**: Tracks data sources (`[User provided]`, `[AI extracted]`, `[User clarified]`) with full audit timelines and manual verification flags.
- **Reference-Range Gauge & Flagging**: Pure arithmetic evaluation of test results against published reference intervals (`LOW`, `NORMAL`, `HIGH`, or `Range not provided`).
- **Cross-Report Inconsistency Detection**: Identifies severe, acute shifts (>200% change within 14 days) across sequential lab reports for clinician review.
- **Strict Clinical Validation**: Validates patient intake and sanitizes AI extraction payloads before database storage.
- **Zero-Dependency Native Test Suite**: Comprehensive unit and integration test suite powered by `node:test`.
- **Serverless & Local Ready**: Configured for local development (`node server.js`) and deployment on Vercel (`api/index.js` + `vercel.json`).

---

## Getting Started

### 1. Prerequisites

- **Node.js**: v18.0.0 or higher (v22+ recommended; uses native `node:test` and `fetch`).
- **npm**: v9.0.0 or higher.
- A **Google Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/)).

### 2. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/nikithaDom/PromptWars.git
cd PromptWars
npm install
```

### 3. Environment Configuration (`.env`)

Copy `.env.example` to create your local `.env` file:

```bash
# Windows PowerShell
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

Open `.env` and fill in your configuration:

```env
# Your Google Gemini API key (required for report extraction & plain-language summary)
GEMINI_API_KEY=your_gemini_api_key_here

# Gemini model identifier (default: gemini-3.6-flash)
GEMINI_MODEL=gemini-3.6-flash

# Port for local server (default: 3000)
PORT=3000

# Optional: Custom secret for HMAC session signing
SESSION_SECRET=your_custom_session_secret_here
```

---

## Running the Application

### Start Development Server

```bash
npm start
```

Once started, open your browser and navigate to:
```
http://localhost:3000
```

### Demo Login Credentials

The application uses lightweight session-based authentication:
- **Email**: `clinician@medlens.local` *(or shorthand `demo`)*
- **Password**: `demo123`
- **Role**: Attending Physician

---

## Running Automated Tests

MedLens uses Node's built-in, fast, zero-dependency test runner (`node:test`).

Run all unit and integration tests:

```bash
npm test
```

### Test Coverage

The test suite includes:
1. **Clinical Range Flagging Unit Tests (`test/clinical.test.js`)**:
   - Value below range (`LOW`)
   - Value above range (`HIGH`)
   - Value in range (`NORMAL` and boundary inclusiveness)
   - Missing reference ranges (`Range not provided`)
   - Malformed / non-numeric values (`Range not provided`)
   - Cross-report divergence detection algorithms
2. **Input Validation Unit Tests (`test/validation.test.js`)**:
   - Patient intake validation (missing required fields, negative age, invalid sex)
   - Extraction payload schema validation (required fields, type coercions, range limits)
3. **Report Extraction Integration Tests (`test/reports-integration.test.js`)**:
   - Mocks AI extraction to verify `POST /api/patients/:id/reports`
   - Validates that results are stored with `source: "ai_extracted"` and the computed flag (`HIGH`)

---

## Architecture & Code Structure

```
PromptWars/
├── api/
│   └── index.js              # Vercel serverless entry point exporting Express app
├── data/
│   ├── db.js                 # Data persistence with serverless /tmp support & audit logging
│   └── db.json               # Seed database containing demo clinical records
├── lib/
│   ├── clinical.js           # Pure functions: computeReferenceFlag & checkCrossReportDivergence
│   └── validation.js         # Pure functions: validatePatientIntake & validateExtractionResults
├── middleware/
│   └── auth.js               # Stateless HMAC session authentication
├── public/                   # Static frontend pages, CSS design system, and vanilla JS
│   ├── dashboard.html        # Patient list and clinical triage overview
│   ├── intake.html           # New patient admission form
│   ├── record.html           # Full patient record, lab reports & reference range gauge
│   ├── summary.html          # Plain-language summary with clinical disclaimers
│   └── upload.html           # Lab report upload and extraction interface
├── routes/                   # Express modular route handlers
│   ├── audit.js              # Audit timeline and field verification endpoints
│   ├── auth.js               # Clinician authentication routes
│   ├── clarifications.js     # Ambiguity and clarification resolution
│   ├── conflicts.js          # Inconsistency detection endpoints
│   ├── export.js             # Print & clinical PDF generation
│   ├── patients.js           # Patient listing and validated intake creation
│   ├── record.js             # Patient record retrieval
│   ├── reports.js            # Lab report file upload & validated AI extraction
│   └── summary.js            # Gemini AI plain-language summary generation
├── test/                     # Automated unit and integration test suites
│   ├── clinical.test.js      # Reference-range & divergence unit tests
│   ├── validation.test.js    # Intake & AI schema validation unit tests
│   └── reports-integration.test.js # Report upload & AI extraction integration test
├── server.js                 # Express server configuration & route mounts
├── vercel.json               # Vercel deployment and URL rewrite rules
└── package.json
```

---

## Deployment to Vercel

1. Push your repository to GitHub.
2. Import the project in the [Vercel Dashboard](https://vercel.com).
3. Under **Settings → Environment Variables**, configure:
   - `GEMINI_API_KEY`: Your Google Gemini API Key.
   - `GEMINI_MODEL`: `gemini-3.6-flash` (optional, defaults to `gemini-3.6-flash`).
4. Deploy! Vercel automatically uses `vercel.json` and `api/index.js` to route all endpoints.

---

## License

MIT
