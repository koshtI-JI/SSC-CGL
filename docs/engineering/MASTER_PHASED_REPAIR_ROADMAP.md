# Master Phased Repair Roadmap — Reconciled Path to CGL Baseline (Option C)

> **Current Status**: **Option C (Reconciled Development Baseline) approved as strategy only.** **Phase 2 is NOT authorized yet.**  
> **Active Gate / Blocker**: **STOPPED at Archive Availability Check (`docs/engineering/ORIGINAL_ZIP_VERIFICATION.md`)**. `path-to-cgl.zip` is **not** mounted in `/app/applet`, uploaded assets, `/tmp`, or Git history. Phase A direct source comparison cannot run until the original ZIP is supplied (or the owner explicitly approves reconstructing missing boundaries from verified workspace code + specs).  
> **Strict Constraints**: Zero edits to `src/`, `package.json`, `firestore.rules`, Firebase config/database, `reports/`, or backups (`pre-repair-baseline.tar.gz`) during read-only phases.

---

## 1. Revised Phased Repair Sequence (Aligned to Option C)

| Phase | Name & Objective | Exact Modules Covered | Gate / Risk Control |
| :---: | :--- | :--- | :--- |
| **0–1** *(Done)* | **Baseline Backup, Parity & Archive Availability Check** | `/tmp/path-to-cgl-backups/pre-repair-baseline.tar.gz`, `repair/path-to-cgl`, `docs/engineering/*` | Read-only baseline verified (`114/114` tests, `tsc`, `eslint firestore.rules`, `vite build`). Archive unavailability documented honestly in `ORIGINAL_ZIP_VERIFICATION.md`. |
| **A** *(BLOCKED — Needs ZIP)* | **Original ZIP Integrity, Isolated Extraction & 22-Module Direct Source Comparison** | Owner-supplied `path-to-cgl.zip` extracted into `/tmp/path-to-cgl-original/` | Verify SHA-256, file inventory, `package.json`/`prismjs`, `vite.config.ts`, `firestore.rules`, and diff all 22 modules directly without modifying `/app/applet`. |
| **1.5** *(Pre-Phase 2 Opt-In)* | **Option C Baseline Module Reconciliation** | Missing/extracted boundaries (`AdminUserManagementTab.tsx`, `ConfigContext.tsx`, `LiveDataContext.tsx`, `useLiveDataSync.ts`, `cloudFirstSync.ts`, `platformConfig.ts`) onto `/app/applet` | Preserve `/app/applet` Firebase target (`total-reflector-plkqp`), `reports/`, `bun.lock`, `gh-pages`, and `114/114` passing tests while setting clean modular targets. |
| **2** *(Awaiting Approval)* | **Stable Account Identity, Roster Precedence & Credential Containment** | `sessionAndOverrides.ts` (+ `.test.ts`), `adminCommandCenter.ts` (+ `.test.ts`), `AdminControlCenter.tsx` / `AdminUserManagementTab.tsx`, `AdminCohortProgressSection.tsx`, `AdminLiveProctorPanel.tsx`, `firestoreService.ts`, `localFallbackStore.ts` | Unblock `damini_01` (`loginId: damini_888`) & `demo_123` (`loginId: demo@123`); single canonical row; preserve `502`/`530` historical snapshots; distinguish loading vs empty cohort; strip Admin UI/DTO/write/export `currentPassword` while keeping `passwordHash` login intact. **Stop for owner review.** |
| **3** | **Security Architecture Design & Auth Migration (Hard Approval Gate)** | `firebase.ts`, `firestoreService.ts`, `AuthGateway.tsx`, `App.tsx`, `firestore.rules`, `security_spec.md` | **Design document first**: Firebase Auth + `request.auth.uid -> canonicalStudentUid` mapping (keeping `damini_01`, `demo_123`), username recovery workflow for non-email logins (`damini_888`, `demo@123`), least-privilege rules + Firebase Emulator tests, pre-migration backup + legacy password purge. **Never deploy auth/rules without explicit owner approval.** |
| **4** | **Cloud-First Sync, Durable Outbox & Safe Snapshot Import** | `cloudFirstSync.ts`, `useLiveDataSync.ts`, `localFallbackStore.ts`, `indexedDbStore.ts`, `firestoreService.ts`, `AdminControlCenter.tsx` | Eliminate `.catch(() => {})` on multi-doc writes; remove `500`-item outbox truncation; add explicit sync failure states (`local_only`, `pending`, `confirmed`, `failed_retryable`, `permanent_error`); soft-archive instead of hard-delete; dry-run diff + secret-stripped `importLocalCohortSnapshot()`; offline-gated IDB hydration check. |
| **5** | **Exam Engine Correctness & Simulator Route Integrity** | `TcsIonTestEngine.tsx`, `examEngine.ts`, `tier1Engine.ts`, `tier2Engine.ts`, `DestComputerSimulator.tsx`, `App.tsx` | Synchronous `useRef` submit mutex + persistent idempotency key; wall-clock deadline timers (prevent throttling drift); verify `/dest-simulator` routes & Computer Knowledge / DEST persistence expectations; verify EN+HI bilingual layout accuracy. |
| **6** | **Question Banks, PDF Import, Mock Builder & Restored CMS/Settings** | `AdminPdfIngestor.tsx`, `PdfQuestionExtractor.tsx`, `bulkParser.ts`, `questionSchema.ts`, `DynamicSettingsManagerPanel.tsx`, `platformConfig.ts`, `LiveCodeEditorPanel.tsx`, `githubCodeEditor.ts` | Zero silent mutation of `src/data/*` (120 starter Qs, 22 tests, 26 GK, 20 Computer Qs); dry-run bulk preview; test-version snapshots; restore Dynamic Settings & GitHub CMS with **session/memory-only PAT** (zero `localStorage` PAT persistence). |
| **7** | **Privacy (`reports/`), PWA Service Worker Safety & GitHub Pages Base Path** | `.gitignore`, `reports/`, `vite.config.ts`, `package.json`, `README.md`, `SYSTEM_BLUEPRINT.md`, `App.tsx` | Protect student PII in `reports/`; prevent PWA `autoUpdate` from reloading mid-exam; fix missing `.jpg` precache; verify `/` & `BASE_PATH=/SSC-CGL/` routes; include `studyCoach.test.ts` in `npm test`; align stale docs. |
| **8** | **Performance Optimization & Bundle Splitting** | `App.tsx`, `AdminControlCenter.tsx`, `FloatingSupportChatWidget.tsx`, `AuthGateway.tsx`, `RulesGuideModal.tsx`, `vite.config.ts` | Fix `[INEFFECTIVE_DYNAMIC_IMPORT]` on `RulesGuideModal.tsx`; lazy-load `FloatingSupportChatWidget` (`aiClient`); split 1.34 MB entry & 737 KB admin chunks; measure Lighthouse metrics. |
| **9** | **Isolated Staging Preview & Final Owner QA** | Dedicated staging Firebase project + staging preview URL | Execute full Student (`damini_888`, `demo@123`) & Admin `/om` staging checklist online + offline across viewports; deliver `TEST_REPORT.md`, `SECURITY_MIGRATION_PLAN.md`, `PERFORMANCE_REPORT.md`, `PREVIEW_DEPLOYMENT.md`, `ROLLBACK.md`. **Stop for final approval.** |

---

## 2. Active P0 Security Matrix (Phase D Tracking)

| P0 Defect | Current Baseline Status | Phase 2 Containment | Phase 3 Full Remediation |
| :--- | :--- | :--- | :--- |
| **Missing `firebase/auth` (`BUG-P0-01`) & Client SHA-256 Auth** | **Active** (`AuthGateway.tsx`, `firestoreService.ts`) | Unchanged `passwordHash` login preserved cleanly (`verifyStudentLogin` reads `invite.passwordHash` only) | Firebase Auth + `authUid -> canonicalStudentUid` mapping + non-email username recovery (`damini_888`, `demo@123`) |
| **Open `firestore.rules` (`BUG-P0-02`)** | **Active** (`firestore.rules` checks shape only, zero `request.auth`) | Keep rules untouched (do **not** deploy) | Least-privilege auth/UID/admin rules + Firebase Emulator test suite (`security_spec.md`) |
| **Plaintext `currentPassword` (`BUG-P0-03`)** | **Active** (stored, synced locally, displayed in Admin UI) | Remove UI reveal/copy/inputs, strip DTO fields, stop new `currentPassword` writes | Remove `currentPassword` schema allowance + backup-verified purge of legacy fields |
| **Credential Export & Blind Import (`BUG-P0-04`)** | **Active** (`exportLocalCohortSnapshot`, `buildScopedDataExport`) | Strip `adminCredentials`, `passwordHash`, `currentPassword` from all exports | Add dry-run diff preview, secret rejection, and pre-import rollback snapshot |

---

## 3. Verification Gates Required on All Future Execution Phases

1. `npm test` (`tsx --test` across all unit test files, including `studyCoach.test.ts` and new Phase 2/3/4/5 regression suites).
2. `npm run lint` (`tsc --noEmit` = `0` errors) and `npx eslint firestore.rules` (`0` errors).
3. `npm run build` (`vite build` at `/` and `BASE_PATH=/SSC-CGL/`).
4. Real browser UI & offline/online checks (`http://localhost:3000` and isolated staging preview) with zero console/runtime errors.
5. `git diff reports/` = empty (unless explicitly approved in Phase 7) and pre-migration JSON backups verified prior to any DB mutation.
