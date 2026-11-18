# Path to CGL — Verification & Test Report

**Branch**: `repair/path-to-cgl`
**Verification Date**: 2026-11-17
**Scope**: Unit tests, TypeScript type checking, Firebase Security Rules ESLint, dual Vite production builds, and Playwright headless Chromium E2E checks against isolated local browser storage.

---

## 1. Automated Unit Tests (`npm test`)

Command:
```bash
npm test
```
Executes `tsx --test` across all **26** test files:
- `src/data/sscStarterBank.test.ts`
- `src/lib/aiClient.test.ts`
- `src/utils/adminCommandCenter.test.ts`
- `src/utils/appRoutes.test.ts`
- `src/utils/bulkParser.test.ts`
- `src/utils/cloudFirstSync.test.ts`
- `src/utils/destSimulator.test.ts`
- `src/utils/dreamPostCatalog.test.ts`
- `src/utils/examEngine.test.ts`
- `src/utils/examTimer.test.ts`
- `src/utils/firestoreQuota.test.ts`
- `src/utils/githubCodeEditor.test.ts`
- `src/utils/indexedDbStore.test.ts`
- `src/utils/localFallbackStore.test.ts`
- `src/utils/pdfIngestor.test.ts`
- `src/utils/pdfQuestionExtractor.test.ts`
- `src/utils/platformConfig.test.ts`
- `src/utils/pwaUpdateGuard.test.ts`
- `src/utils/revisionHistory.test.ts`
- `src/utils/sessionAndOverrides.test.ts`
- `src/utils/staticGkBank.test.ts`
- `src/utils/studentAnalyticsEngine.test.ts`
- `src/utils/studyCoach.test.ts`
- `src/utils/syllabusCatalog.test.ts`
- `src/utils/tier1Engine.test.ts`
- `src/utils/tier2Engine.test.ts`

**Result**: **135 / 135 passed** (`0 failed`, `0 cancelled`, `0 skipped`, `duration_ms: 2158.65`).

---

## 2. Static Analysis & Rules Linting

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run lint` (`tsc --noEmit`) | **0 errors** |
| Firebase Security Rules ESLint | `npx eslint firestore.rules DRAFT_firestore.rules` | **0 errors, 0 warnings** |

---

## 3. Production Build & Subpath Parity

| Build Target | Command | Build Time | Warnings | Precache Output |
| --- | --- | --- | --- | --- |
| Root preview (`/`) | `npm run build` | `986ms` | `0` | `37 entries (3749.04 KiB)` |
| GitHub Pages (`/SSC-CGL/`) | `BASE_PATH=/SSC-CGL/ npm run build` | `1.06s` | `0` | `36 entries (3749.21 KiB)` |

---

## 4. Playwright Headless Chromium E2E Verification (`playwright-cli`)

**Isolation Guarantee**: All outbound requests to `**/*googleapis.com/**` and `**/*firebaseio.com/**` were aborted via `page.route(...)`, and synthetic SHA-256 test credentials (`damini_888` -> `damini_01`, `demo@123` -> `demo_123`, `admin`) were seeded strictly into browser `localStorage` (`getcgl_local_db_v1`). Zero writes reached production Firestore or GitHub.

| Journey / Assertion | Result |
| --- | --- |
| Root `/` admin UI isolation (`#admin-login-id` count on root) | `0` (`PASS`) |
| Root `/` desktop horizontal overflow (`1440x900`) | `0 px` (`PASS`) |
| Student login (`damini_888`), maintenance banner render (`E2E Audit Banner Active`), dashboard tabs | `PASS` |
| Dashboard desktop overflow (`1440x900`) | `0 px` (`PASS`) |
| TCS iON mock launch, rules checkbox consent, live `EN` -> `हिं` language toggle (`bg-blue-700`) | `PASS` |
| Blocked-network offline exam submission latency to Performance Scorecard | `3131 ms` (`PASS`) |
| DEST Typing (`15m · 2000 Keys`) & Computer Knowledge (`Question 1 of 20`) desktop & mobile (`390x844`) overflow | `0 px` / `0 px` (`PASS`) |
| `/#/om` Admin login -> VIP roster shows `damini_888` (`damini_01`) & `demo@123` (`demo_123`), `0` plaintext leakage | `PASS` |
| Admin Settings (`Dynamic Platform Settings`) & Repo CMS (`main` branch protection banner visible) | `PASS` |
| Admin desktop (`1440x900`) & mobile (`390x844`) horizontal overflow | `0 px` / `0 px` (`PASS`) |
| Uncaught `pageerror` / non-Firebase `console.error` count | `0` / `0` (`PASS`) |
