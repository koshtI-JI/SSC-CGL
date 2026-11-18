# Workspace Parity & Verification Report — Path to CGL (`koshtI-JI/SSC-CGL`)

> **Task**: Pre-Phase-2 Verification & Reconciliation (Tasks 1, 2, 3, 5, and 6)  
> **Status**: Verification-Only — zero modifications to `src/`, `package.json`, `firestore.rules`, Firebase configuration, student records, `reports/`, or backups.  
> **Master Specification Compared Against**: `public/assets/aistudio/PathToCGL_Master_Repair_Plan_b41b4299.txt` (written against the expanded `path-to-cgl.zip` archive).

---

## 1. Workspace Identification (Task 1)

### 1.1 Environment, Root, Branch & Commits

| Property | Verified Value |
| :--- | :--- |
| **Project Root** | `/app/applet` |
| **Current Git Branch** | `repair/path-to-cgl` |
| **Current `HEAD` Commit** | `853c76c86545c1d7f0b204c1e28bdd9e72434efa` (`853c76c`, `docs(phase-1): add baseline architecture, dependency, data-flow, and bug audit`) |
| **Baseline Commit (`main`)** | `3f4b0c785fbb8c53be5c3fad50cc4c96ddcc4d14` (`3f4b0c7`, `chore(phase-0): baseline workspace snapshot before Phase 2 repairs`) |
| **Configured Git Remotes** | None (`git remote -v` empty — local isolated repository) |
| **Immutable Baseline Backup** | `/tmp/path-to-cgl-backups/pre-repair-baseline.tar.gz` (`1.3 MB`, SHA-256 `9a0035f117b8ec35404580252964f59ad23d6342bcc4f5a283734cda794cd5e0`) |
| **Node / npm Runtime** | Node `v22.23.2`, npm `10.9.8` |

### 1.2 Workspace Origin Verdict

**Conclusion**: The current workspace originated from a **GitHub repository import of `koshtI-JI/SSC-CGL`**, **NOT** from the expanded `path-to-cgl.zip` archive described in `PathToCGL_Master_Repair_Plan_b41b4299.txt`.

**Direct Evidence**:
1. User Prompt #2 explicitly states: *"This app was imported from GitHub repository `koshtI-JI/SSC-CGL`."*
2. `package.json` declares `"name": "get-to-cgl"` and `"homepage": "https://koshti-ji.github.io/SSC-CGL/"` with `"deploy": "gh-pages -d dist"`.
3. Every refactored/modular archive module referenced in the Master Repair Plan (`src/context/ConfigContext.tsx`, `src/context/LiveDataContext.tsx`, `src/hooks/useLiveDataSync.ts`, `src/components/AdminUserManagementTab.tsx`, `src/components/DynamicSettingsManagerPanel.tsx`, `src/components/LiveCodeEditorPanel.tsx`, `src/utils/githubCodeEditor.ts`, `src/utils/cloudFirstSync.ts`, `src/utils/platformConfig.ts`) is **absent** from `/app/applet/src/` and has **zero string references** across `src/`, `README.md`, and `SYSTEM_BLUEPRINT.md`.

### 1.3 `package.json` Contents & Version Information

```json
{
  "name": "get-to-cgl",
  "homepage": "https://koshti-ji.github.io/SSC-CGL/",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 3000",
    "start": "vite preview --host 0.0.0.0 --port 3000",
    "build": "vite build",
    "predeploy": "npm run build",
    "deploy": "gh-pages -d dist",
    "preview": "vite preview --host 0.0.0.0 --port 3000",
    "clean": "rm -rf dist",
    "lint": "tsc --noEmit",
    "test": "tsx --test src/data/sscStarterBank.test.ts src/utils/bulkParser.test.ts src/utils/examEngine.test.ts src/utils/dreamPostCatalog.test.ts src/utils/tier1Engine.test.ts src/utils/tier2Engine.test.ts src/utils/localFallbackStore.test.ts src/utils/destSimulator.test.ts src/utils/syllabusCatalog.test.ts src/utils/revisionHistory.test.ts src/utils/appRoutes.test.ts src/lib/aiClient.test.ts src/utils/pdfIngestor.test.ts src/utils/pdfQuestionExtractor.test.ts src/utils/firestoreQuota.test.ts src/utils/staticGkBank.test.ts src/utils/indexedDbStore.test.ts src/utils/studentAnalyticsEngine.test.ts src/utils/adminCommandCenter.test.ts src/utils/sessionAndOverrides.test.ts"
  },
  "dependencies": {
    "@firebase/eslint-plugin-security-rules": "^0.0.2",
    "@tailwindcss/vite": "^4.3.3",
    "@vitejs/plugin-react": "^6.1.1",
    "firebase": "^13.3.0",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "pdfjs-dist": "^6.5.438",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "vite": "^8.3.0",
    "vite-plugin-pwa": "^2.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.14.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "autoprefixer": "^10.4.21",
    "esbuild": "^0.25.0",
    "eslint": "^10.14.0",
    "gh-pages": "^6.3.0",
    "tailwindcss": "^4.3.3",
    "tsx": "^4.21.0",
    "typescript": "^7.0.2"
  }
}
```

### 1.4 Complete Source File Inventory (`src/` — Verified `103` Files)

- **Root Entry & Assets (4 files)**
  - `src/App.tsx`
  - `src/assets/images/hero_cgl_arena_1794665281724.jpg`
  - `src/index.css`
  - `src/main.tsx`
- **Components (`src/components/` — 41 files)**
  - `src/components/AdminCohortProgressSection.tsx`
  - `src/components/AdminControlCenter.tsx`
  - `src/components/AdminLiveProctorPanel.tsx`
  - `src/components/AdminPdfIngestor.tsx`
  - `src/components/AiKeySettingsModal.tsx`
  - `src/components/AppErrorBoundary.tsx`
  - `src/components/AspirantCoachCard.tsx`
  - `src/components/AuthGateway.tsx`
  - `src/components/CameraRulesModal.tsx`
  - `src/components/CompletedTestsPanel.tsx`
  - `src/components/CustomMockBuilderModal.tsx`
  - `src/components/DestComputerSimulator.tsx`
  - `src/components/EditProfileModal.tsx`
  - `src/components/ExamCalculator.tsx`
  - `src/components/ExamRoughPadModal.tsx`
  - `src/components/FloatingSupportChatWidget.tsx`
  - `src/components/GitReportsSyncCard.tsx`
  - `src/components/GlobalSearchModal.tsx`
  - `src/components/LeaderboardPanel.tsx`
  - `src/components/NotificationBell.tsx`
  - `src/components/OfflineIndicator.tsx`
  - `src/components/PWAInstallButton.tsx`
  - `src/components/PdfQuestionExtractor.tsx`
  - `src/components/PendingTestsPanel.tsx`
  - `src/components/PopupRewardQuizModal.tsx`
  - `src/components/PrintableReportModal.tsx`
  - `src/components/ProgressChartPanel.tsx`
  - `src/components/QuestionTimeGraph.tsx`
  - `src/components/RankBadge.tsx`
  - `src/components/ReportQuestionModal.tsx`
  - `src/components/RevisionVault.tsx`
  - `src/components/RulesGuideModal.tsx`
  - `src/components/ScratchRewardModal.tsx`
  - `src/components/StudentDashboard.tsx`
  - `src/components/StudentProfilePanel.tsx`
  - `src/components/StudyFormulaBoosterModal.tsx`
  - `src/components/SyllabusTopicDropdown.tsx`
  - `src/components/TcsIonTestEngine.tsx`
  - `src/components/ThemeToggleButton.tsx`
  - `src/components/TopNav.tsx`
  - `src/components/WipeQuestionsModal.tsx`
- **Static Question Banks (`src/data/` — 7 files)**
  - `src/data/gkBank.json`
  - `src/data/sscEnglishBank.ts`
  - `src/data/sscGaBank.ts`
  - `src/data/sscQuantBank.ts`
  - `src/data/sscReasoningBank.ts`
  - `src/data/sscStarterBank.test.ts`
  - `src/data/sscStarterBank.ts`
- **Hooks (`src/hooks/` — 5 files)**
  - `src/hooks/useOnlineStatus.ts`
  - `src/hooks/usePWAInstall.ts`
  - `src/hooks/useStudentActivityTracker.ts`
  - `src/hooks/useStudentProctorPublisher.ts`
  - `src/hooks/useTheme.ts`
- **Libraries & Services (`src/lib/` — 4 files)**
  - `src/lib/aiClient.test.ts`
  - `src/lib/aiClient.ts`
  - `src/lib/firebase.ts`
  - `src/lib/firestoreService.ts`
- **Types (`src/types/` — 1 file)**
  - `src/types/exam.ts`
- **Domain Utilities & Unit Tests (`src/utils/` — 41 files: 22 modules + 19 test files; 21 total test files across `src/`)**
  - `src/utils/adminCommandCenter.test.ts`, `src/utils/adminCommandCenter.ts`
  - `src/utils/appRoutes.test.ts`, `src/utils/appRoutes.ts`
  - `src/utils/avatarUpload.ts`
  - `src/utils/bulkParser.test.ts`, `src/utils/bulkParser.ts`
  - `src/utils/calculatorEngine.ts`
  - `src/utils/destSimulator.test.ts`, `src/utils/destSimulator.ts`
  - `src/utils/dreamPostCatalog.test.ts`, `src/utils/dreamPostCatalog.ts`
  - `src/utils/examEngine.test.ts`, `src/utils/examEngine.ts`
  - `src/utils/firestoreQuota.test.ts`, `src/utils/firestoreQuota.ts`
  - `src/utils/indexedDbStore.test.ts`, `src/utils/indexedDbStore.ts`
  - `src/utils/localFallbackStore.test.ts`, `src/utils/localFallbackStore.ts`
  - `src/utils/pdfIngestor.test.ts`, `src/utils/pdfIngestor.ts`
  - `src/utils/pdfQuestionExtractor.test.ts`, `src/utils/pdfQuestionExtractor.ts`
  - `src/utils/questionSchema.ts`
  - `src/utils/revisionHistory.test.ts`, `src/utils/revisionHistory.ts`
  - `src/utils/sessionAndOverrides.test.ts`, `src/utils/sessionAndOverrides.ts`
  - `src/utils/staticGkBank.test.ts`, `src/utils/staticGkBank.ts`
  - `src/utils/studentAnalyticsEngine.test.ts`, `src/utils/studentAnalyticsEngine.ts`
  - `src/utils/studyCoach.test.ts`, `src/utils/studyCoach.ts` *(omitted from `package.json` `"test"` script)*
  - `src/utils/syllabusCatalog.test.ts`, `src/utils/syllabusCatalog.ts`
  - `src/utils/tier1Engine.test.ts`, `src/utils/tier1Engine.ts`
  - `src/utils/tier2Engine.test.ts`, `src/utils/tier2Engine.ts`

---

## 2. Version Difference Analysis (Task 2)

Comparison between the expanded archive referenced in `PathToCGL_Master_Repair_Plan_b41b4299.txt` and the verified `/app/applet` workspace (`koshtI-JI/SSC-CGL` checkout):

| File Path | Exists in Original Archive | Exists in Current Workspace | Status | Relevant Replacement File(s) in Workspace | Missing Original Functionality / Parity Impact |
| :--- | :---: | :---: | :--- | :--- | :--- |
| `src/components/AdminUserManagementTab.tsx` | **YES** | **NO** | **Merged / Inline** | `src/components/AdminControlCenter.tsx` (VIP Cohort tab, lines `1096–1463`; state/handlers lines `280–311`, `422–540`) | Archive's dedicated `AdminUserManagementTab.tsx` + pure `buildAdminUserManagementRows()` row builder merging `vipInvites + students + presence + leaderboard` with `createdAt` do not exist. Current UI renders `realInvites` only without merged profile columns, UID/createdAt display, or pure unit-tested roster view-model, while still exposing `inv.currentPassword` reveal/copy and `type="text"` password input. |
| `src/context/ConfigContext.tsx` | **YES** | **NO** | **Inline / Not Extracted** | `src/App.tsx` (`scoringConfig` state lines `134`, `332`, `927–960`), `src/lib/aiClient.ts` (`getRuntimeAiConfig`, `subscribeAiEngineStatus`), `src/lib/firebase.ts` | No `src/context/` directory exists. Platform configuration is prop-drilled from `App.tsx` or read via module singletons. No runtime feature-flag/branding configuration provider exists. |
| `src/context/LiveDataContext.tsx` *(and `src/hooks/useLiveDataSync.ts`)* | **YES** | **NO** | **Inline / Not Extracted** | `src/App.tsx` (17 state hooks lines `134–150`; Firestore `onSnapshot` subscriptions lines `326–360`) | Live data subscriptions live directly in `App.tsx` and flow down via props. There is no centralized sync-telemetry status badge/hook (`useLiveDataSync`) or React Context consumer abstraction. |
| `src/utils/githubCodeEditor.ts` *(and `src/components/LiveCodeEditorPanel.tsx`)* | **YES** | **NO** | **Removed / Never Present in Checkout** | Nearest partial analogue (read-only export only): `src/components/GitReportsSyncCard.tsx` + `buildStudentGitReportPayloads()` (`src/utils/examEngine.ts`) | In-app GitHub repository file browsing, editing, and PAT-based commits (`getcgl_github_cms_v1`) are completely absent. *Security corollary*: the archive's P1 GitHub PAT `localStorage` exposure defect does not exist here, while automated repo report pushing must instead use manual download (`GitReportsSyncCard.tsx`) or offline tooling. |
| `src/utils/cloudFirstSync.ts` | **YES** | **NO** | **Merged / Inline** | `src/lib/firestoreService.ts` (`executeWriteWithLocalFallback` L158–188, `mergeByIdWithTombstones`, `syncPendingLocalOpsToCloud`), `src/utils/localFallbackStore.ts` (`pendingSyncOps`, `deletedIds`, `bootstrapLocalDbFromIndexedDb`), `src/utils/firestoreQuota.ts` | Standalone unit-tested `cloudFirstSync` policy helper does not exist. Outbox truncation (`500` items), silent op drops on non-recoverable sync failures, and unconditional `bootstrapLocalDbFromIndexedDb()` execution on mount (`App.tsx` L178) are currently coupled inside `firestoreService.ts` and `localFallbackStore.ts`. |
| `src/utils/platformConfig.ts` *(and `src/components/DynamicSettingsManagerPanel.tsx`)* | **YES** | **NO** | **Split / Missing Dynamic UI** | `src/types/exam.ts` (`DEFAULT_SCORING_CONFIG` L17–24), `src/lib/firebase.ts` (`ADMIN_PREVIEW_UID` L14), `src/utils/sessionAndOverrides.ts` (`OFFLINE_AUTO_LOGOUT_MS`, `POPUP_QUIZ_ACTIVE_INTERVAL_MS`, `BLOCKED_DUMMY_UIDS`), `src/App.tsx` | Archive's centralized platform config constants + dynamic Admin settings manager UI (`DynamicSettingsManagerPanel.tsx`) are missing. Only scoring formula settings are configurable at runtime in `AdminControlCenter.tsx`. |

*(Additional baseline variance verified during Phase 1: `RulesGuideModal.tsx` triggers `[INEFFECTIVE_DYNAMIC_IMPORT]` between `App.tsx` and `AuthGateway.tsx`, `TcsIonTestEngine.tsx` stacks EN+HI without a live toggle despite `README.md` / `SYSTEM_BLUEPRINT.md` claims, and `src/utils/studyCoach.test.ts` [7 passing tests] is excluded from `package.json` `"test"`.)*

---

## 3. Account Data Verification (`reports/` & Backups) (Task 3)

Direct inspection of `reports/cohort_summary.json`, `reports/cohort_summary.md`, `reports/students/*.json`, and `diff -s` comparisons against `reports/backups/*_latest.json` confirm the following ground-truth facts:

### 3.1 Snapshot Verification Table

| File | Archive Backup Parity (`diff -s`) | `uid` | `loginId` | `displayName` | `slotNumber` | `targetPost` | Aggregate Metrics in Snapshot | `generatedAtIso` |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| `reports/students/damini_01.json` | Identical to `reports/backups/damini_01_latest.json` | **`damini_01`** | `damini_01` | `damini koshti` | `1` | `income tax inspector` | XP `502`, Tests `6`, Best Score `23.5`, Avg Acc `48.3%`, Study Time `12231s` (`03:23:51`) | `2026-11-14T07:29:49.574Z` |
| `reports/students/damini_888.json` | Identical to `reports/backups/damini_888_latest.json` | **`damini_01`** | **`damini_888`** | `damini koshti` | `1` | `ASO` | XP `530`, Tests `7`, Best Score `23.5`, Avg Acc `46.2%`, Study Time `21506s` (`05:58:26`) | `2026-11-14T16:43:45.997Z` |
| `reports/students/demo_123.json` | Identical to `reports/backups/demo_123_latest.json` | **`demo_123`** | **`demo@123`** | `demo` | `1` | `ASO in MEA` | XP `42`, Tests `3`, Best Score `3`, Avg Acc `23.3%`, Study Time `3731s` (`01:02:11`) | `2026-11-14T16:43:45.997Z` |
| `reports/students/admin.json` | Identical to `reports/backups/admin_latest.json` | `admin_preview` | `admin` | `Admin Preview Aspirant` | `1` | `SSC CGL Preview` | XP `0`, Tests `0`, Best Score `0`, Avg Acc `0%`, Study Time `25s` (`00:25`) | `2026-11-14T16:43:45.997Z` |

*(Correction to `docs/engineering/BASELINE_REPORT.md` Section 5 summary: exact ISO timestamps inside all four JSON snapshots are `2026-11-14` [not `2026-04-12`], and exact `bestScore` values are `23.5` for Damini and `3` for Demo as shown above.)*

### 3.2 Identity & Non-Merge Proof

1. **Damini Historical Continuity (`uid === "damini_01"`)**:
   - Both `damini_01.json` (morning snapshot `07:29:49Z`) and `damini_888.json` (afternoon snapshot `16:43:45Z`) carry the exact same immutable `uid: "damini_01"`.
   - Between the two snapshots, Damini's `loginId` changed from `damini_01` to `damini_888`, `targetPost` changed from `"income tax inspector"` to `"ASO"`, and one completed attempt was recorded (`"History Smart Test (15 Qs)"`, `+28 XP`, `+70s` test time, submitted `2026-11-14T15:32:56.613Z`).
   - All prior attempts from `damini_01.json` (`11` `recentAttempts` entries totaling `6` completed qualifying attempts) remain intact inside `damini_888.json`'s `12` `recentAttempts` entries (`7` completed).
   - **Strict Rule**: `damini_01.json` (`502 XP` / `6 tests`) and `damini_888.json` (`530 XP` / `7 tests`) are **point-in-time aggregate snapshots of the same account**, **NOT** separate accounts. XP and attempts must **NEVER** be summed or merged (`502 + 530` would double-count history). `reports/cohort_summary.json` (`syncedAtIso: 2026-11-14T16:43:46.873Z`) correctly lists Damini **once** under `damini_888`.
2. **Demo Canonical Identity (`uid === "demo_123"`, `loginId === "demo@123"`)**:
   - Verified `uid: "demo_123"` and `loginId: "demo@123"`. Note that `loginIdToKey("demo@123")` in `src/utils/examEngine.ts` (L21–24) deterministically yields `"demo_123"`, creating punctuation-collision risk if future accounts only differ by punctuation (`demo.123`, `demo_123`, `demo@123`).
3. **Repeated `slotNumber: 1` Anomaly**:
   - All entries in `reports/cohort_summary.md` (`damini_888`, `demo@123`, `admin`) report `slotNumber: 1`.
   - `createNewVipUser()` and `updateVipUser()` (`src/lib/firestoreService.ts` L1130–1335) enforce `1..5` bounds and total cohort cap `5`, but do **not** enforce slot uniqueness. `AdminControlCenter.tsx` (`handleCancelEditInvite` L438) initializes next slot from `invites.length + 1`, while existing records remain on `#1`. Slot numbers must **not** be silently reassigned without owner policy confirmation.

---

## 4. P0 Security Issues — Prioritized Visibility (Task 5)

Phase 2 account/identity fixes must **not** mask or deprioritize the four confirmed P0 security defects from `docs/engineering/BUG_REGISTER.md`:

| ID | Verified P0 Defect | Concrete Locations in Current Workspace | Mandatory Sequencing |
| :--- | :--- | :--- | :--- |
| **`BUG-P0-01`** | **No Firebase Authentication (`firebase/auth` absent)**: client-side salted SHA-256 verification against publicly readable Firestore collections + unsigned `sessionStorage` (`getcgl_session_v1`). | `src/lib/firebase.ts`, `src/lib/firestoreService.ts` (`verifyAdminLogin`, `verifyStudentLogin`), `src/App.tsx` | **Phase 3 (Separate Approved Auth Migration Plan)** — never deploy without staging proof + owner approval. |
| **`BUG-P0-02`** | **Open `firestore.rules` (schema-only, zero `request.auth` / role / ownership checks)**: every active collection allows unauthenticated read/write as long as field shapes pass `isValid*()`. | `firestore.rules` (L527–794), `security_spec.md` | **Phase 3 (Coupled to Firebase Auth Migration + Emulator Tests)** — do not deploy rules changes before Auth is live. |
| **`BUG-P0-03`** | **Plaintext `currentPassword` stored & rendered in Admin UI**: persisted in `vipInvites/{id}`, `localFallbackStore`, IndexedDB, and rendered with reveal/copy buttons + `type="text"` input. | `src/types/exam.ts` (L34), `firestore.rules` (L51, L58), `src/lib/firestoreService.ts` (L1066, 1085, 1178, 1256, 1271, 1305, 4828), `src/components/AdminControlCenter.tsx` (L1203–1347) | **Immediate Containment in Phase 2** (remove all password fields from admin roster view-models, remove reveal/copy & `type="text"` inputs, stop writing `currentPassword` on new/edited invites); **Legacy Field Purge in Phase 3** after approved snapshot backup. |
| **`BUG-P0-04`** | **Credential leakage in Cohort JSON Export / Blind Import**: `exportLocalCohortSnapshot()` exports raw `adminCredentials` & `vipInvites` (`passwordHash`, `currentPassword`); import overwrites local auth records. | `src/utils/localFallbackStore.ts` (L457–528), `src/utils/adminCommandCenter.ts` (`buildScopedDataExport` L485–549), `src/components/AdminControlCenter.tsx` | **Containment in Phase 2 / Full Hardening in Phase 3–4**: strip `currentPassword` from scoped/roster outputs in Phase 2 and exclude secrets + add dry-run diff in Phase 3/4. |
