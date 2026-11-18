# Complete Feature Parity Report (22-Module Phase A Inventory) — Current Workspace vs. Pending Original ZIP

> **Investigation Mode**: Strictly read-only audit on branch `repair/path-to-cgl` (base commit `3f4b0c7`). Zero changes to `src/`, `package.json`, `firestore.rules`, Firebase configuration, student data, `reports/`, or `/tmp/path-to-cgl-backups/pre-repair-baseline.tar.gz`.  
> **Critical Evidence Boundary (`path-to-cgl.zip` Unavailable)**:
> - **Current Workspace (`/app/applet` — `koshtI-JI/SSC-CGL`)**: **DIRECTLY VERIFIED** in actual TypeScript/React/Vite/Firestore source files (`103` `src/` files).
> - **Original Uploaded ZIP (`path-to-cgl.zip`)**: **PENDING ORIGINAL ZIP INSPECTION**. As documented in `docs/engineering/ORIGINAL_ZIP_VERIFICATION.md`, `path-to-cgl.zip` is **not** present anywhere in `/app/applet`, uploaded assets, `/tmp`, or Git history. References to absent ZIP files below reflect *only* unverified pointers from `public/assets/aistudio/PathToCGL_Master_Repair_Plan_b41b4299.txt` (an AI repair specification, not original source code) and **must not be treated as direct source inspection**. No comparison result has been fabricated.

---

## 1. 22-Module Parity & Evidence Matrix

| # | Feature / Module | Original ZIP Source Status | Current Workspace Implementation (`koshtI-JI/SSC-CGL`, Directly Verified) | Classification Pending ZIP Diff |
| :-: | :--- | :--- | :--- | :--- |
| 1 | **Admin User Management** | **Pending ZIP** *(Master Plan cites `AdminUserManagementTab.tsx` + `buildAdminUserManagementRows()`)* | Inline tab inside `src/components/AdminControlCenter.tsx` (`activeTab === 'cohort'`, L1096–1463) + `firestoreService.ts` (`createNewVipUser`, `updateVipUser`, `upsertVipInvite`, `deleteVipUser` L1130–1353). Iterates `realInvites` only (blocks `damini_01` & `demo_123` via `BLOCKED_DUMMY_UIDS`); displays plaintext `currentPassword`. | **Absent as standalone file**; functional UI inlined (`AdminControlCenter.tsx`) with parity/identity bugs. |
| 2 | **`ConfigContext`** | **Pending ZIP** *(Master Plan cites `src/context/ConfigContext.tsx`)* | **No `src/context/` folder**. `scoringConfig` lives in `App.tsx` state (L134, L332); AI config lives in `aiClient.ts` module state / `localStorage`. | **Absent**; replaced by root props + module singletons. |
| 3 | **`LiveDataContext`** | **Pending ZIP** *(Master Plan cites `src/context/LiveDataContext.tsx`)* | **No `src/context/` folder**. All 17 live state slices (`invites`, `students`, `leaderboard`, `questions`, `tests`, `attempts`, `tasks`, `sessionLogs`, `supportTickets`, `reportedQueries`, etc.) live in `src/App.tsx` (L134–150) via prop drilling. | **Absent as context**; logic inlined into `App.tsx`. |
| 4 | **`useLiveDataSync`** | **Pending ZIP** *(Master Plan cites `src/hooks/useLiveDataSync.ts`)* | **No `useLiveDataSync.ts` hook**. Subscription lifecycle (`13` Firestore listeners, quota banner, `online` event replay, pending sync counter) is inlined in `src/App.tsx` (L181–198, L326–360) + `firestoreService.ts`. | **Absent as hook**; core listeners inlined in `App.tsx` without per-stream status telemetry. |
| 5 | **`cloudFirstSync`** | **Pending ZIP** *(Master Plan cites `src/utils/cloudFirstSync.ts`)* | **No `src/utils/cloudFirstSync.ts`**. Embedded in `src/lib/firestoreService.ts` (`executeWriteWithLocalFallback` L158–188, `syncPendingLocalOpsToCloud`), `localFallbackStore.ts` (`mergeByIdWithTombstones` L375–406, `queuePendingSyncOp` L331–343), and `firestoreQuota.ts`. | **Absent as pure module**; inlined across `firestoreService.ts` + `localFallbackStore.ts` (capped at `500` ops, silent `.catch(() => {})` on secondary writes). |
| 6 | **`platformConfig`** | **Pending ZIP** *(Master Plan cites `src/utils/platformConfig.ts`)* | **No `src/utils/platformConfig.ts`**. Defaults scattered across `src/types/exam.ts` (`DEFAULT_SCORING_CONFIG`), `src/lib/firebase.ts` (`ADMIN_PREVIEW_UID`), `sessionAndOverrides.ts` (`OFFLINE_AUTO_LOGOUT_MS`, `POPUP_QUIZ_ACTIVE_INTERVAL_MS`), and `vite.config.ts`. | **Absent**; split across scattered constants. |
| 7 | **`LiveCodeEditorPanel`** | **Pending ZIP** *(Master Plan cites `src/components/LiveCodeEditorPanel.tsx`)* | **Not present anywhere in `src/`**. Super Admin `/om` has no in-app code browser or live repository file editor. | **Completely absent** in current workspace. |
| 8 | **`githubCodeEditor`** | **Pending ZIP** *(Master Plan cites `src/utils/githubCodeEditor.ts` + `prismjs@^1.30.0` + `getcgl_github_cms_v1`)* | **Not present anywhere in `src/` or `package.json`** (`prismjs` not installed; `getcgl_github_cms_v1` absent). `GitReportsSyncCard.tsx` only exports local downloads. | **Completely absent** in current workspace. |
| 9 | **`DynamicSettingsManagerPanel`** | **Pending ZIP** *(Master Plan cites `src/components/DynamicSettingsManagerPanel.tsx`)* | **Not present anywhere in `src/`**. Only 6 `ScoringConfig` inputs (`AdminControlCenter.tsx` L1584–1714) and AI endpoint settings (`AiKeySettingsModal.tsx`) are editable in UI. | **Absent as panel**; only scoring & AI settings exist. |
| 10 | **Authentication** | **Pending ZIP** *(Exact diff of `AuthGateway.tsx` / `firestoreService.ts` unverified)* | Verified in `AuthGateway.tsx` (509 lines), `firestoreService.ts` (`verifyAdminLogin`, `verifyStudentLogin` L304–525), `App.tsx` (L268–316): **zero `firebase/auth`**, client-side SHA-256 (`sankalp_admin_v1:`, `sankalp_vip_v1:`), `sessionStorage` key `getcgl_session_v1`. `verifyStudentLogin` checks `invite.passwordHash` only. | **Verified functional** in workspace; **P0 security defects active** (exact diff vs ZIP pending). |
| 11 | **Student Dashboard** | **Pending ZIP** *(Exact component parity unverified)* | Verified in `StudentDashboard.tsx` (2,547 lines) + `StudentProfilePanel`, `EditProfileModal`, `RevisionVault` (1,525 lines), `AspirantCoachCard`, `LeaderboardPanel`, `ProgressChartPanel`, `PendingTestsPanel`, `CompletedTestsPanel`, `PopupRewardQuizModal`, `ScratchRewardModal`, `StudyFormulaBoosterModal`, `FloatingSupportChatWidget`, `AdminCohortProgressSection`, `AdminLiveProctorPanel`. | **Verified present & comprehensive** (exact diff vs ZIP pending). |
| 12 | **Examination Engine** | **Pending ZIP** *(Exact bilingual/timer/submit diff unverified)* | Verified in `TcsIonTestEngine.tsx` (2,527 lines), `tier1Engine.ts` (100 Qs / 60m / +2,-0.5), `tier2Engine.ts` (100 Qs / 80m / +3,-1), `examEngine.ts`, `ExamCalculator`, `ExamRoughPadModal`, `QuestionTimeGraph`, `ReportQuestionModal`, `CameraRulesModal`, `RulesGuideModal`. Uses EN+HI stacked display, `setInterval` timer, and async `submitting` guard. | **Verified present** (exact diff vs ZIP pending; submit mutex & drift hardening planned in Phase 5). |
| 13 | **Question Banks** | **Pending ZIP** *(Exact question/test count parity unverified)* | Verified in `src/data/`: `sscQuantBank.ts`, `sscReasoningBank.ts`, `sscEnglishBank.ts`, `sscGaBank.ts`, `sscStarterBank.ts` (**120** starter questions, **22** starter tests), `gkBank.json` (**26** items), `bulkParser.ts`, `questionSchema.ts`, `corrected_questions_bank`, `WipeQuestionsModal.tsx`. | **Verified present** (exact counts verified in `/app/applet`; ZIP comparison pending). |
| 14 | **PDF Import** | **Pending ZIP** *(Exact parser/extractor diff unverified)* | Verified in `AdminPdfIngestor.tsx` (1,105 lines), `PdfQuestionExtractor.tsx` (795 lines), `pdfIngestor.ts`, `pdfQuestionExtractor.ts` (`pdfjs-dist@6.5.438` + `aiClient.ts` chunked extraction + Firestore batch import). | **Verified present** (ZIP diff pending). |
| 15 | **AI Integration** | **Pending ZIP** *(Exact prompt/provider/cache diff unverified)* | Verified in `src/lib/aiClient.ts` (1,746 lines), `AiKeySettingsModal.tsx` (377 lines), `FloatingSupportChatWidget.tsx` (406 lines), `StudyFormulaBoosterModal.tsx`. Supports 5 presets (Groq, OpenAI, OpenRouter, Together, Custom), multi-model fallback, translation, PDF extraction, explanations, formula lookup, chat mentor, SSC feed, `getcgl_ai_cache_v1`. | **Verified present** (ZIP diff pending). |
| 16 | **IndexedDB** | **Pending ZIP** *(Exact offline gating & stores diff unverified)* | Verified in `src/utils/indexedDbStore.ts` (335 lines): DB `path_to_cgl_idb_v1` (v1) with 4 stores (`kv_db`, `offline_test_packs`, `exam_drafts`, `ai_cache`), in-memory test mirror, `saveOfflineMockPack`, `cacheMockCatalogForOffline`, `saveOfflineExamDraft`. Called unconditionally on mount in `App.tsx` L178 (`bootstrapLocalDbFromIndexedDb()`). | **Verified present** (`App.tsx` L178 calls IDB hydration unconditionally on mount; ZIP gating diff pending). |
| 17 | **LocalStorage** | **Pending ZIP** *(Exact storage keys & outbox diff unverified)* | Verified in `src/utils/localFallbackStore.ts` (529 lines): key `getcgl_local_db_v1` storing full `LocalFallbackDatabase` (18 slices + `deletedIds` + `pendingSyncOps` capped at `500`), sessionLog quota pruning (25 most recent), mirrors writes to IndexedDB `kv_db`. Plus `sessionStorage` `getcgl_session_v1` & AI/cache keys. | **Verified present** (ZIP diff pending). |
| 18 | **PWA** | **Pending ZIP** *(Exact `vite.config.ts` / manifest / asset-hook diff unverified)* | Verified in `vite.config.ts` (`VitePWA` `registerType: 'autoUpdate'`, Workbox `generateSW`, `globPatterns` missing `.jpg`), `OfflineIndicator.tsx`, `PWAInstallButton.tsx`, `useOnlineStatus.ts`, `usePWAInstall.ts`, icons in `public/`. | **Verified present** (note missing `.jpg` precache & mid-exam `autoUpdate` risk; ZIP diff pending). |
| 19 | **Git Reports** | **Pending ZIP** *(Exact coupling with `githubCodeEditor.ts` unverified)* | Verified in `GitReportsSyncCard.tsx` (226 lines), `examEngine.ts` (`buildStudentGitReportPayloads`), `PrintableReportModal.tsx`, tracked `reports/cohort_summary.*`, `reports/students/*`, `reports/backups/*`. Local Blob download & print only (no direct GitHub commit). | **Verified present** (commit-to-GitHub missing along with #7/#8). |
| 20 | **Backup and Restoration** | **Pending ZIP** *(Exact secret stripping / conflict diff unverified)* | Verified in `AdminControlCenter.tsx` (L1465–1580), `adminCommandCenter.ts` (`buildScopedDataExport`, `parseAndValidateScopedImport` L474–554), `localFallbackStore.ts` (`exportLocalCohortSnapshot` L457–467, `importLocalCohortSnapshot` L469–528), `firestoreService.ts` (`syncProgressBackupSnapshot`). | **Verified present** (exports raw `adminCredentials` & `currentPassword`; blind overwrites — P0/P1 risks active). |
| 21 | **DEST Simulator** | **Pending ZIP** *(Exact typing metrics / passage diff unverified)* | Verified in `DestComputerSimulator.tsx` (Module A, `activeTab === 'typing'`, L37–93, L250–450) + `destSimulator.ts`: **2** typing passages, `2000` target keystrokes, `15m` countdown, gross/net WPM, accuracy, `<=5%` pass rule, paste block, unit-tested in `destSimulator.test.ts`. | **Verified present** (ZIP diff pending). |
| 22 | **Computer Knowledge Simulator** | **Pending ZIP** *(Exact persistence/score behavior diff unverified)* | Verified in `DestComputerSimulator.tsx` (Module B, `activeTab === 'computer'`, L95–149, L450–728) + `destSimulator.ts`: `COMPUTER_KNOWLEDGE_QUESTIONS` (**20** SSC-tier MCQs, `15m` timer, question palette, review mark, `scoreComputerQuiz()`), unit-tested in `destSimulator.test.ts`. Results remain local to simulator component state. | **Verified present** (ZIP diff pending). |

---

## 2. Detailed Breakdown Across All 22 Modules

### Group A — Files Confirmed Absent in `/app/applet` (ZIP Source Required for Exact Behavior)

For items **1–9** below, direct source comparison with the original ZIP is **blocked until `path-to-cgl.zip` is provided**. Secondary pointers from `PathToCGL_Master_Repair_Plan_b41b4299.txt` are recorded only as items requiring verification, never as inspected source code.

1. **Admin User Management (`AdminUserManagementTab.tsx` vs. `AdminControlCenter.tsx` L1096–1463)**
   - *Original ZIP Implementation*: **Pending original ZIP inspection** *(Master Plan references `src/components/AdminUserManagementTab.tsx` + `buildAdminUserManagementRows()`)*.
   - *Current Workspace Implementation*: Verified inline inside `AdminControlCenter.tsx` (`activeTab === 'cohort'`) backed by `firestoreService.ts` (`createNewVipUser`, `updateVipUser`, `upsertVipInvite`, `deleteVipUser`). Table renders `realInvites` only (without merged student profile/XP/last-active columns or `createdAt`), blocks `damini_01` and `demo_123` via `BLOCKED_DUMMY_UIDS`, and renders `currentPassword` plaintext reveal/copy UI.
   - *Preserved / Missing / Partial*: Create/edit/toggle/delete/grant-tests/revoke-sessions are preserved inline; standalone component & `buildAdminUserManagementRows()` helper are absent.
   - *Dependencies & Security*: Depends on `vipInvites`, `students`, `attempts`, `sessionLogs`, `localFallbackStore`. **P0 active**: exposes `currentPassword` in UI/state/writes.
   - *Reconciliation (Option C)*: Inspect ZIP file if provided, extract clean `AdminUserManagementTab.tsx` + pure `buildAdminUserManagementRows()` in Phase 1.5/2 with Phase C (`damini_01` / `demo_123` unblocked) and Phase D (`currentPassword` removed from UI/DTO/writes while keeping `passwordHash` login functional).

2. **`ConfigContext` (`src/context/ConfigContext.tsx`)**
   - *Original ZIP Implementation*: **Pending original ZIP inspection**.
   - *Current Workspace Implementation*: No `src/context/` directory exists. `scoringConfig` is held in `App.tsx` state (`L134`, `L332`), and AI client config lives inside `aiClient.ts`.
   - *Preserved / Missing / Partial*: `ScoringConfig` and AI settings values work via top-down props and module singletons; centralized `ConfigContext` React provider is absent.
   - *Dependencies & Security*: Depends on Firestore `/settings/scoring` & local config; must never expose `/settings/adminCredentials` into public client config context.
   - *Reconciliation (Option C)*: Reconcile cleanly into `src/context/ConfigContext.tsx` once ZIP contract is checked (or reconstruct in Phase 1.5 if ZIP unavailable).

3. **`LiveDataContext` (`src/context/LiveDataContext.tsx`)**
   - *Original ZIP Implementation*: **Pending original ZIP inspection**.
   - *Current Workspace Implementation*: Inlined as `17` top-level `useState` hooks inside `src/App.tsx` (L134–150) passed through props to `StudentDashboard`, `AdminControlCenter`, and `TcsIonTestEngine`.
   - *Preserved / Missing / Partial*: All 17 data streams function; Context isolation is absent, forcing broad root re-renders and prop drilling.
   - *Dependencies & Security*: Core state layer; must gate authenticated collection listeners cleanly once Phase 3 Firebase Auth lands.
   - *Reconciliation (Option C)*: Extract/reconcile `LiveDataContext.tsx` after Phase A ZIP diff so Phase 2/4 changes do not deepen `App.tsx` monolith coupling.

4. **`useLiveDataSync` (`src/hooks/useLiveDataSync.ts`)**
   - *Original ZIP Implementation*: **Pending original ZIP inspection**.
   - *Current Workspace Implementation*: Subscription orchestration (`13` `onSnapshot` listeners, quota status listener, `online` queue replay trigger, pending sync count polling) runs directly inside `src/App.tsx` (L181–198, L326–360) and `src/lib/firestoreService.ts`.
   - *Preserved / Missing / Partial*: Live sync & `online` replay work; extracted hook contract and per-collection error/stale telemetry are absent.
   - *Dependencies & Security*: Depends on `firebase/firestore`, `firestoreService.ts`, `firestoreQuota.ts`, `useOnlineStatus`.
   - *Reconciliation (Option C)*: Extract/reconcile `useLiveDataSync.ts` with explicit per-stream loaded/loading/error state (solving empty-vs-loading cohort confusion in Phase 2).

5. **`cloudFirstSync` (`src/utils/cloudFirstSync.ts`)**
   - *Original ZIP Implementation*: **Pending original ZIP inspection**.
   - *Current Workspace Implementation*: Inlined inside `src/lib/firestoreService.ts` (`executeWriteWithLocalFallback` L158–188, `syncPendingLocalOpsToCloud`) + `localFallbackStore.ts` (`mergeByIdWithTombstones` L375–406, `queuePendingSyncOp` L331–343 capped at `500` ops, silent `.catch(() => {})` on secondary writes).
   - *Preserved / Missing / Partial*: Cloud-first fallback and tombstone merge work; standalone pure policy module, explicit failure states (`permanent_error`), and untruncated durability are absent.
   - *Dependencies & Security*: Bridges `firestoreService.ts`, `localFallbackStore.ts`, `indexedDbStore.ts`, and `firestoreQuota.ts`.
   - *Reconciliation (Option C)*: Reconcile standalone pure `cloudFirstSync.ts` behind `tsx --test` unit coverage in Phase 1.5/4.

6. **`platformConfig` (`src/utils/platformConfig.ts`)**
   - *Original ZIP Implementation*: **Pending original ZIP inspection**.
   - *Current Workspace Implementation*: Distributed across `src/types/exam.ts` (`DEFAULT_SCORING_CONFIG`), `src/lib/firebase.ts` (`ADMIN_PREVIEW_UID`), `sessionAndOverrides.ts` (`OFFLINE_AUTO_LOGOUT_MS`, `POPUP_QUIZ_ACTIVE_INTERVAL_MS`), and `vite.config.ts`.
   - *Preserved / Missing / Partial*: Defaults work individually; centralized validated platform configuration schema is absent.
   - *Dependencies & Security*: Must strictly isolate non-secret UI/exam config from secrets/PATs/credentials.
   - *Reconciliation (Option C)*: Reconcile `platformConfig.ts` once ZIP definition is inspected (or define safe typed defaults in Phase 1.5).

7. **`LiveCodeEditorPanel` (`src/components/LiveCodeEditorPanel.tsx`)**
   - *Original ZIP Implementation*: **Pending original ZIP inspection**.
   - *Current Workspace Implementation*: **Completely absent** from `src/` (only `GitReportsSyncCard.tsx` exists for report downloads).
   - *Preserved / Missing / Partial*: Missing user-facing module in `/app/applet`.
   - *Dependencies & Security*: Depends on `githubCodeEditor.ts` & optional syntax highlighting (`prismjs`). Restoring must **never** persist GitHub PATs in `localStorage`.
   - *Reconciliation (Option C)*: Inspect original ZIP implementation first (Phase A), then restore cleanly as a lazy-loaded Admin `/om` tool in Phase 6 with **session/memory-only PAT** handling.

8. **`githubCodeEditor` (`src/utils/githubCodeEditor.ts`)**
   - *Original ZIP Implementation*: **Pending original ZIP inspection** *(Master Plan notes `prismjs@^1.30.0`, `getcgl_github_cms_v1`, GitHub Contents API)*.
   - *Current Workspace Implementation*: **Completely absent** from `src/` and `package.json` (`prismjs` absent).
   - *Preserved / Missing / Partial*: Missing GitHub REST Contents API client & commit helpers.
   - *Dependencies & Security*: GitHub REST API (`fetch`, Base64 UTF-8 encode/decode). **Security gate**: zero `localStorage` PAT storage; explicit repo/branch validation before commits.
   - *Reconciliation (Option C)*: Inspect original ZIP file + tests in Phase A; restore in Phase 6 using memory/session-scoped PAT only.

9. **`DynamicSettingsManagerPanel` (`src/components/DynamicSettingsManagerPanel.tsx`)**
   - *Original ZIP Implementation*: **Pending original ZIP inspection**.
   - *Current Workspace Implementation*: **Completely absent**; `AdminControlCenter.tsx` (L1584–1714) exposes only the 6 numeric `ScoringConfig` fields, and `AiKeySettingsModal.tsx` edits AI client settings.
   - *Preserved / Missing / Partial*: Missing centralized dynamic settings UI.
   - *Dependencies & Security*: Depends on `platformConfig.ts`, `ConfigContext.tsx`, and `firestore.rules` `/settings/{settingId}` schema constraints (currently rule-validated for `scoring` and `adminCredentials`).
   - *Reconciliation (Option C)*: Inspect original ZIP panel in Phase A; restore cleanly after ensuring `/settings/*` Firestore rules schema compatibility (Phase 3/6).

---

### Group B — Modules Present & Directly Verified in `/app/applet` (Exact ZIP Diff Still Pending)

10. **Authentication (`AuthGateway.tsx`, `firestoreService.ts`, `App.tsx`)**: Verified client-side SHA-256 against `adminCredentials` and `vipInvites.passwordHash` (`verifyStudentLogin` L410–413), persisted in `sessionStorage` (`getcgl_session_v1`). **P0 security gaps active**: no `firebase/auth`, open `firestore.rules`, plaintext `currentPassword` stored/displayed alongside hashes. Preserved in Phase 2 via `passwordHash`; full Firebase Auth migration gated on Phase 3.
11. **Student Dashboard (`StudentDashboard.tsx` & 12+ subcomponents)**: Verified complete 7-tab student portal, streak multiplier (`0.85x–1.40x`), Revision Vault (`1,525` lines), Aspirant Coach, Leaderboard, Progress Charts, Live Proctor publisher, Popup/Scratch rewards, Support chat. `BLOCKED_DUMMY_UIDS` affects dashboard visibility for `damini_01` / `demo_123`.
12. **Examination Engine (`TcsIonTestEngine.tsx`, `tier1Engine.ts`, `tier2Engine.ts`, `examEngine.ts`)**: Verified Tier 1 (`100` Qs / `60m` / `+2,-0.5`), Tier 2 (`100` Qs: Q25/R25/E30/GA20 / `80m` / `+3,-1`), Calculator, RoughPad, QuestionTimeGraph, ReportQuestionModal. Needs Phase 5 synchronous `useRef` submit mutex & wall-clock deadline timers; ZIP comparison pending.
13. **Question Banks (`src/data/*`, `bulkParser.ts`, `questionSchema.ts`, `corrected_questions_bank`)**: Verified `120` starter questions, `22` starter tests, `26` GK entries, bulk CSV/JSON parser, question overrides, and wipe modal. ZIP comparison pending.
14. **PDF Import (`AdminPdfIngestor.tsx`, `PdfQuestionExtractor.tsx`, `pdfIngestor.ts`, `pdfQuestionExtractor.ts`)**: Verified `pdfjs-dist@6.5.438` chunked extraction + AI MCQ structuring + Firestore batch push. ZIP comparison pending.
15. **AI Integration (`aiClient.ts`, `AiKeySettingsModal.tsx`, `FloatingSupportChatWidget.tsx`, `StudyFormulaBoosterModal.tsx`)**: Verified 5 provider presets (Groq, OpenAI, OpenRouter, Together, Custom), multi-model fallback, `getcgl_ai_cache_v1`, translation, post-mortem, chat mentor. Note client-stored API keys security review in Phase 3/6; ZIP comparison pending.
16. **IndexedDB (`src/utils/indexedDbStore.ts`)**: Verified `path_to_cgl_idb_v1` (stores: `kv_db`, `offline_test_packs`, `exam_drafts`, `ai_cache`) + Node test memory fallback. Currently hydrated unconditionally on mount in `App.tsx` L178 (`bootstrapLocalDbFromIndexedDb()`); exact gating difference vs ZIP pending.
17. **LocalStorage (`src/utils/localFallbackStore.ts`)**: Verified key `getcgl_local_db_v1` mirroring `18` entities, tombstones, and `pendingSyncOps` (max `500`), plus `sessionLogs` quota pruning (`25`) and `exportLocalCohortSnapshot` / `importLocalCohortSnapshot` (which currently include `adminCredentials` & `currentPassword`). ZIP comparison pending.
18. **PWA (`vite.config.ts`, `OfflineIndicator.tsx`, `PWAInstallButton.tsx`, `useOnlineStatus.ts`, `usePWAInstall.ts`)**: Verified `vite-plugin-pwa` `generateSW` (`registerType: 'autoUpdate'`), `globPatterns` excluding `.jpg` hero image, and offline status/install hooks. Mid-exam reload hazard (`autoUpdate`) tracked for Phase 7; ZIP comparison pending (`copy-unbundled-src-assets` check).
19. **Git Reports (`GitReportsSyncCard.tsx`, `PrintableReportModal.tsx`, `examEngine.ts`, `reports/*`)**: Verified `.json`/`.md`/bundle download & print views plus tracked `reports/cohort_summary.*`, `reports/students/*`, `reports/backups/*`. Notice PII exposure in tracked `reports/` (Phase 7) and lack of direct GitHub commit until `githubCodeEditor.ts` is reconciled.
20. **Backup and Restoration (`AdminControlCenter.tsx` L1465–1580, `adminCommandCenter.ts`, `localFallbackStore.ts`, `firestoreService.ts`)**: Verified 3-scope export (`full_cohort`, `students_attempts`, `questions_mocks`), JSON import, and `progressBackups` collection sync. **P0/P1 risks active**: exports include credentials/hashes (`BUG-P0-04`), imports overwrite local records without dry-run diff.
21. **DEST Simulator (`DestComputerSimulator.tsx` Module A, `destSimulator.ts`)**: Verified `2` passages, `2000` keystrokes, `15m` countdown, gross/net WPM, `<=5%` error pass threshold, paste prevention, covered by `destSimulator.test.ts`. ZIP comparison pending.
22. **Computer Knowledge Simulator (`DestComputerSimulator.tsx` Module B, `destSimulator.ts`)**: Verified `20` SSC-tier MCQs, `15m` countdown, question palette, mark-for-review, `scoreComputerQuiz()`, covered by `destSimulator.test.ts` (results stay local to `/dest-simulator` session). ZIP comparison pending.
