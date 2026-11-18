# Architecture Audit — Path to CGL (`koshtI-JI/SSC-CGL`)

> **Audit Scope**: Phase 1 read-only architectural verification against `public/assets/aistudio/PathToCGL_Master_Repair_Plan_b41b4299.txt`.  
> **Git Baseline**: Branch `repair/path-to-cgl` (branched from `main` at commit `3f4b0c7`).  
> **Source Modifications**: None (Phase 0 & Phase 1 audit only).

---

## 1. Platform & Stack Inventory

| Layer | Technology | Version / Configuration |
| :--- | :--- | :--- |
| Runtime | Node.js / npm | Node `v22.23.2`, npm `10.9.8` |
| UI Framework | React + TypeScript | `react@19.3.1`, `react-dom@19.3.1`, `typescript@7.0.2` (`@types/react@19.3.0`) |
| Build Tool | Vite + Rolldown | `vite@8.3.8`, `@vitejs/plugin-react@6.3.0` |
| Styling | Tailwind CSS v4 | `tailwindcss@4.3.5`, `@tailwindcss/vite@4.3.5`, `src/index.css` |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`) | `vite-plugin-pwa@2.0.0`, `registerType: 'autoUpdate'` |
| Backend / DB | Firebase Cloud Firestore (Client SDK only) | `firebase@13.4.0` (`total-reflector-plkqp`, database `ai-studio-b4ce5a3e-d757-414c-a8c3-2f1ce12c647c`) |
| Client Auth | Custom SHA-256 client-side gate (No Firebase Auth) | `src/lib/firestoreService.ts` + `sessionStorage` (`getcgl_session_v1`) |
| PDF Parsing | `pdfjs-dist` + `Tesseract` / client heuristics | `pdfjs-dist@6.5.438` (`pdf.worker.min` bundled as `1,271.91 kB` asset) |
| Icons / Motion | `lucide-react`, `motion` | `lucide-react@0.546.0`, `motion@12.43.0` |
| AI Integration | Client-side OpenAI-compatible HTTP calls (Groq default) | `src/lib/aiClient.ts` (`VITE_GROQ_API_KEY` / `VITE_AI_API_KEY` or browser `localStorage`) |
| Test Runner | `tsx --test` (`node:test`) | `tsx@4.23.15`, `21` test files (`20` in `package.json` + `studyCoach.test.ts`) |
| Hosting Target | GitHub Pages (`koshti-ji.github.io/SSC-CGL/`) + AI Studio preview | `gh-pages@6.3.0`, `vite.config.ts` `BASE_PATH || '/'` |

---

## 2. Actual Codebase Inventory (`src/` — 103 Files, ~51,689 Lines incl. assets)

### 2.1 Entry, Routing & Shell
- `src/main.tsx`: Mounts `<App />` inside `<StrictMode>` and registers global error handlers.
- `src/App.tsx` (**1,250 lines**): Single monolithic application controller managing:
  - Client routing (`resolveAppRoute()` from `src/utils/appRoutes.ts`): `/`, `/om`, `/dest-simulator` (`window.history.pushState` / `popstate`).
  - Session persistence (`sessionStorage` key `getcgl_session_v1`, cleanup of legacy `localStorage` session keys).
  - Unconditional IndexedDB bootstrap (`bootstrapLocalDbFromIndexedDb()` on mount).
  - Real-time Firestore + local-fallback subscriptions (`scoring`, `vipInvites`, `students`, `leaderboard`, `questions`, `tests`, `attempts`, `tasks`, `xpLedger`, `presence`, `sessionLogs`, `supportTickets`, `reportedQueries`, `correctedOverrides`).
  - Pending local sync outbox flush on mount and `window` `online` events (`syncPendingLocalOpsToCloud()`).
  - Lazy loading of `StudentDashboard`, `AdminControlCenter`, `TcsIonTestEngine`, `DestComputerSimulator`, `AiKeySettingsModal`, `CameraRulesModal`, `RulesGuideModal`, `StudyFormulaBoosterModal`.
  - Static loading of `AuthGateway`, `TopNav`, `FloatingSupportChatWidget`, `OfflineIndicator`.
- `src/types/exam.ts`: Core TypeScript domain interfaces (`ScoringConfig`, `VipInvite`, `StudentProfile`, `QuestionDoc`, `MockTestDoc`, `TestAttemptDoc`, `TestDraftDoc`, `ProgressBackupDoc`, `StudentPresenceDoc`, `ProctorRoomDoc`, `StudentSessionLogDoc`, `SupportTicketDoc`, `ReportedQueryDoc`, `CorrectedQuestionOverrideDoc`, etc.).

### 2.2 Components (`src/components/` — 41 files)
- **Auth & Navigation**: `AuthGateway.tsx`, `TopNav.tsx`, `NotificationBell.tsx`, `OfflineIndicator.tsx`, `PWAInstallButton.tsx`, `ThemeToggleButton.tsx`, `GlobalSearchModal.tsx`, `RulesGuideModal.tsx`, `CameraRulesModal.tsx`, `AppErrorBoundary.tsx`.
- **Student Workspace**: `StudentDashboard.tsx` (2,546 lines), `StudentProfilePanel.tsx`, `LeaderboardPanel.tsx`, `CompletedTestsPanel.tsx`, `PendingTestsPanel.tsx`, `RevisionVault.tsx` (1,525 lines), `ProgressChartPanel.tsx`, `QuestionTimeGraph.tsx`, `AspirantCoachCard.tsx`, `RankBadge.tsx`, `CustomMockBuilderModal.tsx`, `SyllabusTopicDropdown.tsx`, `EditProfileModal.tsx`, `PrintableReportModal.tsx`, `PopupRewardQuizModal.tsx`, `ScratchRewardModal.tsx`, `StudyFormulaBoosterModal.tsx`, `FloatingSupportChatWidget.tsx`, `DestComputerSimulator.tsx`.
- **Exam Engine**: `TcsIonTestEngine.tsx` (2,526 lines), `ExamCalculator.tsx`, `ExamRoughPadModal.tsx`, `ReportQuestionModal.tsx`.
- **Admin Workspace**: `AdminControlCenter.tsx` (3,668 lines), `AdminCohortProgressSection.tsx` (599 lines), `AdminLiveProctorPanel.tsx` (350+ lines), `AdminPdfIngestor.tsx` (1,104 lines), `PdfQuestionExtractor.tsx` (794 lines), `GitReportsSyncCard.tsx`, `AiKeySettingsModal.tsx`, `WipeQuestionsModal.tsx`.

### 2.3 Services, Hooks, Data & Utilities
- **Firebase & AI (`src/lib/`)**: `firebase.ts`, `firestoreService.ts` (**5,658 lines**), `aiClient.ts` (1,745 lines), `aiClient.test.ts`.
- **Hooks (`src/hooks/`)**: `useOnlineStatus.ts`, `usePWAInstall.ts`, `useStudentActivityTracker.ts`, `useStudentProctorPublisher.ts`, `useTheme.ts`.
- **Data (`src/data/`)**: `sscQuantBank.ts`, `sscReasoningBank.ts`, `sscEnglishBank.ts`, `sscGaBank.ts`, `sscStarterBank.ts`, `sscStarterBank.test.ts`, `gkBank.json`.
- **Utilities (`src/utils/` — 22 modules + 19 test files)**:
  - `examEngine.ts` (1,986 lines), `sessionAndOverrides.ts`, `adminCommandCenter.ts`, `localFallbackStore.ts`, `indexedDbStore.ts`, `firestoreQuota.ts`, `appRoutes.ts`, `avatarUpload.ts`, `bulkParser.ts`, `calculatorEngine.ts`, `destSimulator.ts`, `dreamPostCatalog.ts`, `pdfIngestor.ts`, `pdfQuestionExtractor.ts`, `questionSchema.ts`, `revisionHistory.ts`, `staticGkBank.ts`, `studentAnalyticsEngine.ts`, `studyCoach.ts`, `syllabusCatalog.ts`, `tier1Engine.ts`, `tier2Engine.ts`.

---

## 3. Master Repair Plan vs. Actual Workspace Reconciliation

The Master Repair Plan was authored against an earlier/alternate archive (`path-to-cgl.zip`). Direct source inspection proved the following concrete differences in this imported `koshtI-JI/SSC-CGL` workspace:

| Area | Master Repair Plan Assumption | Verified Reality in This Workspace |
| :--- | :--- | :--- |
| **`src/context/` directory** | Assumed `src/context/` with `useLiveDataSync.ts` | **Does not exist.** All state & Firestore subscriptions live directly in `src/App.tsx`. |
| **Admin User Management module** | Named `AdminUserManagementTab.tsx` + `buildAdminUserManagementRows()` | **Neither exists.** VIP Cohort User Management (add/edit/password reveal/activate/delete) is implemented inline in `src/components/AdminControlCenter.tsx` (lines 1096–1463). |
| **GitHub PAT CMS (`getcgl_github_cms_v1`)** | Listed as P1 bug #10 (`githubCodeEditor.ts`, `LiveCodeEditorPanel.tsx`, `DynamicSettingsManagerPanel.tsx`) | **Absent from codebase.** `GitReportsSyncCard.tsx` only exports local `.json`/`.md` downloads via `Blob` + print modal. |
| **`cloudFirstSync.ts` / `platformConfig.ts`** | Referenced in plan inventory & Phase 4 | **Absent from `src/utils/`.** Offline/cloud merging & fallback live in `src/lib/firestoreService.ts` and `src/utils/localFallbackStore.ts`. |
| **GitHub Pages `gh-pages` script** | Plan §10.2 & §15 claimed `gh-pages` and `deploy` script were missing | **Already present** in `package.json`: `"homepage": "https://koshti-ji.github.io/SSC-CGL/"`, `"predeploy": "npm run build"`, `"deploy": "gh-pages -d dist"`, `gh-pages@^6.3.0`. However, `vite.config.ts` defaults `base` to `process.env.BASE_PATH || '/'`, so `npm run deploy` without `BASE_PATH=/SSC-CGL/` would build `/` paths. |
| **Test suite count** | Plan claimed 24 test files / 145 tests (`README.md` claimed 15 suites / 80 tests) | **21 test files exist**: `package.json` `"test"` runs **20** files (`107` tests) and omits `src/utils/studyCoach.test.ts` (`7` tests) -> **`114` total tests**. |
| **`indexedDbStore.ts` schema** | `SYSTEM_BLUEPRINT.md` claims stores `kv_snapshots`, `mock_packs`, `test_drafts` | Actual DB `path_to_cgl_idb_v1` (v1) has stores `kv_db`, `offline_test_packs`, `exam_drafts`, `ai_cache`. |
| **IndexedDB bootstrap gating** | Plan §6.3 claimed App calls `bootstrapLocalDbFromIndexedDb()` only when offline | `src/App.tsx` lines 177–179 call `void bootstrapLocalDbFromIndexedDb()` unconditionally on mount. |
| **Exam `EN / हिंदी` toggle** | `README.md` & `SYSTEM_BLUEPRINT.md` claim an instant `EN / हिंदी` toggle inside TCS iON engine | `TcsIonTestEngine.tsx` (lines 2051–2110) renders English and Hindi stacked simultaneously with **no language toggle control**; `saveTestDraft()` hardcodes `lang: 'en'` (lines 270, 291). |
| **`vite.config.ts` asset copy plugin** | Plan §10.1 referenced a `copy-unbundled-src-assets` plugin hook | **No such plugin exists** in `vite.config.ts`. Notice instead that `public/assets/aistudio/` is copied into `dist/` automatically by Vite's `publicDir`. |

---

## 4. Architectural Risks Summary

1. **No Real Authentication (`P0`)**: `firebase/auth` is never imported; both `firestoreService.ts` and `firestore.rules` treat the Firestore database as unauthenticated client-validated storage (`allow read/list/create/update` gated only by schema helpers, exposing `settings/adminCredentials`, `vipInvites`, `students`, `attempts`, etc.).
2. **God-Module Coupling (`P1`/`P2`)**: `src/lib/firestoreService.ts` (5,658 lines), `src/components/AdminControlCenter.tsx` (3,668 lines), `src/components/StudentDashboard.tsx` (2,546 lines), `src/components/TcsIonTestEngine.tsx` (2,526 lines), and `src/App.tsx` (1,250 lines) mix persistence, merge heuristics, UI state, and business rules.
3. **Hard-Blocked Valid Users & Split Roster Truth (`P1`)**: `BLOCKED_DUMMY_UIDS` in `src/utils/sessionAndOverrides.ts` (`damini_01`, `damini_888`, `demo_123`) suppresses real cohort accounts across Admin UI and listeners, while `AdminCohortProgressSection.tsx` and `AdminControlCenter.tsx` use divergent invite vs. student merge logic.
4. **Heavy Main Bundle (`P2`)**: Initial entry bundle `index-*.js` is **`1,342.51 kB`** (`390.48 kB` gzip) and `AdminControlCenter-*.js` is **`736.75 kB`** (`185.85 kB` gzip). `RulesGuideModal.tsx` triggers `[INEFFECTIVE_DYNAMIC_IMPORT]` because `AuthGateway.tsx` imports it statically while `App.tsx` lazy-loads it. `FloatingSupportChatWidget` (which imports `aiClient.ts`) is statically bundled into `App.tsx`.
5. **PWA Auto-Update & Asset Coverage (`P2`)**: `VitePWA` sets `registerType: 'autoUpdate'`, which can reload or swap the service worker during an active exam session, and `globPatterns` (`**/*.{js,css,html,ico,png,svg,woff,woff2}`) omits `.jpg`, excluding `hero_cgl_arena_1794665281724` (`719.80 kB`) from precache.
