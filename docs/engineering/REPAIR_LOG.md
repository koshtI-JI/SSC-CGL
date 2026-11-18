# Path to CGL — Engineering Repair Log

- **Branch**: `repair/path-to-cgl`
- **Baseline Commit**: `3f4b0c7` (`main` untouched)
- **Rollback Backup**: `/tmp/path-to-cgl-backups/pre-repair-baseline.tar.gz`
- **Production Target**: `https://koshti-ji.github.io/SSC-CGL/` (not overwritten)
- **Firestore Target**: `total-reflector-plkqp` / `ai-studio-b4ce5a3e-d757-414c-a8c3-2f1ce12c647c` (zero production writes during repair)

---

## Milestone Chronology

### Phase 0 & Phase 1 — Audit, Parity & Strategy Gate (`3f4b0c7` .. `908e77b`)
- Created isolated repair branch `repair/path-to-cgl` and verified rollback archive outside the repository.
- Completed architecture, dependency, data-flow, bug, workspace parity, and Option C baseline reconciliation reports in `docs/engineering/`.
- Preserved canonical cohort UID mapping: Damini (`UID: damini_01`, historical `damini_01` -> active `damini_888`) and Demo (`UID: demo_123`, login `demo@123`), with zero automatic XP/attempt merging.

### M1 & M2 — Account Identity, VIP User Management & Security Hardening (`a137f7c`)
- Restored `src/components/AdminUserManagementTab.tsx` backed by canonical `UID` merge logic and dry-run legacy password containment.
- Hardened `src/utils/localFallbackStore.ts`, `src/utils/adminCommandCenter.ts`, and `src/lib/firestoreService.ts` so `vipInvites` never persist, display, copy, or export `currentPassword` plaintext strings (marking `legacyPlaintextDetected` safely for admin reset).
- Authored `DRAFT_firestore.rules` with Firebase Auth RBAC checks (`isSignedIn()`, `isAdmin()`, `isOwner()`), fail-closed default deny, and strict schema validation without touching live production `firestore.rules`.

### M3 — Restored Contexts & Cloud-First Sync Engine (`2809067`)
- Added `src/context/ConfigContext.tsx`, `src/context/LiveDataContext.tsx`, and `src/hooks/useLiveDataSync.ts`.
- Implemented `src/utils/cloudFirstSync.ts` with exponential backoff, transient vs permission-denied classification, and `requeueFailedOpsForRetry`.
- Upgraded `src/utils/indexedDbStore.ts` and `src/components/OfflineIndicator.tsx` for durable pending/failed sync queue mirroring and retry visibility.

### M4 — Exam Integrity, Wall-Clock Timer & Bilingual Mode (`9770eab`)
- Added `src/utils/examTimer.ts` with wall-clock `deadlineAtMs` & `sectionDeadlineAtMs` timer computation, deterministic `examSessionId` attempt/XP ledger ID resolution, and question-order preservation across resumes.
- Updated `src/components/TcsIonTestEngine.tsx` with `submitLockRef` idempotent submit guard, live `EN` / `हिं` translation toggle propagation across question & options, and persisted deadline resume.

### M5 — Dynamic Settings Manager & GitHub Repo CMS (`a83d0e0`)
- Restored `src/utils/platformConfig.ts` and `src/components/DynamicSettingsManagerPanel.tsx` for runtime feature flags and SSC scoring configuration.
- Restored `src/utils/githubCodeEditor.ts` and `src/components/LiveCodeEditorPanel.tsx` with strict **memory-only** GitHub PAT handling (`sessionStorage`/`localStorage` storage explicitly blocked) and protected branch guards (`main`/`master` commits refused cleanly).

### M6 — Scanned PDF Guard, Provider-Agnostic AI Copy & Config Wiring (`3f93d5f`)
- Short-circuited `aiIngestPdfChunk` in `src/lib/aiClient.ts` when extracted PDF pages contain zero selectable text, returning an explicit scanned-PDF error before issuing network `fetch`.
- Updated `src/components/AdminPdfIngestor.tsx` and `src/components/PdfQuestionExtractor.tsx` copy from stale `Gemini AI` labels to provider-agnostic `AI` guidance.
- Wired `platformConfig.maintenanceBanner`, `platformConfig.aiTutorEnabled`, and `platformConfig.githubReportsEnabled` into `FloatingSupportChatWidget.tsx`, `StudentDashboard.tsx`, `GitReportsSyncCard.tsx`, `AdminCohortProgressSection.tsx`, `AdminControlCenter.tsx`, and `App.tsx`.

### M7 — Exam-Safe PWA Updates, Hero Precache & DEST Wall-Clock Timers (`012f42a`)
- Added `src/utils/pwaUpdateGuard.ts` and `src/components/PwaUpdateBanner.tsx`; switched `vite.config.ts` from `registerType: 'autoUpdate'` to `'prompt'` and suppressed SW reload prompts whenever an exam (`activeExamTest`) or `#/dest-simulator` is active.
- Added `jpg` to `workbox.globPatterns` (`**/*.{js,css,html,ico,png,jpg,svg,woff,woff2}`) so the hero banner image is offline-precached.
- Upgraded `src/components/DestComputerSimulator.tsx` typing and 20-Q Computer Knowledge timers to `Date.now()` deadline refs and added responsive tab wrapping (`flex-wrap max-w-full`).

### M8 — Bundle Splitting & Lazy Loading (`b323d57`)
- Lazy-loaded `RulesGuideModal` in `src/components/AuthGateway.tsx` and `FloatingSupportChatWidget` in `src/App.tsx`.
- Configured `build.rollupOptions.output.manualChunks` in `vite.config.ts` (`vendor-firebase`, `vendor-react`, `vendor-icons`, `vendor-motion`, `vendor-pdf`), eliminating both Rollup `[INEFFECTIVE_DYNAMIC_IMPORT]` and `>500 kB` chunk warnings.

### M9 — Offline Resilience Hardening, Unified Test Suite, E2E Verification & Documentation (`HEAD`)
- Updated `package.json` `"test"` script to execute all 26 unit test suites (135 tests total).
- Hardened `src/lib/firestoreService.ts` (`fetchTestDraft`, `submitTestAttempt`, `getAdminCredentialsStatus`, `verifyAdminLogin`, `restoreAdminSession`, `verifyStudentLogin`) with `navigator.onLine` / quota checks and bounded `raceWithWriteTimeout` / `Promise.race` guards so blocked or flaky networks fall back locally in ~1.5–3.1s instead of stalling on 30–45s WebChannel retries.
- Completed Playwright CLI (`playwright-cli`) end-to-end verification across desktop (`1440x900`) and mobile (`390x844`) viewports and authored the M9 engineering documentation suite.
