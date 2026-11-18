# Path to CGL — System Blueprint & Architecture Guide

**Architecture Class:** 100% Serverless, Frontend-Only Single Page Application (SPA)  
**Stack:** React 19 · TypeScript · Vite 8 · Tailwind CSS v4 · IndexedDB + `localStorage` Hybrid Persistence · Client-Side Firebase Firestore SDK · Workbox PWA · Groq Browser API  

---

## 1. Zero-Backend Design Philosophy

Path to CGL executes **entirely inside the student/admin browser** with zero Node.js, Express, or custom backend servers:

1. **Instant Availability & Offline Continuity:** Starter bilingual question banks (`sscStarterBank`, `gkBank.json`), mock engines (`tier1Engine`, `tier2Engine`), and analytics (`studentAnalyticsEngine`, `adminCommandCenter`) run deterministically in-memory without waiting for external servers.
2. **Local-First Hybrid Storage (`localFallbackStore.ts` + `indexedDbStore.ts`):** Every write (attempt submission, exam draft, XP ledger entry, Revision Vault note, custom mock paper) is persisted immediately to `localStorage` (`getcgl_local_db_v1`), mirrored asynchronously to IndexedDB (`path_to_cgl_idb_v1`), and synchronized with Cloud Firestore (`ai-studio-b4ce5a3e-d757-414c-a8c3-2f1ce12c647c`) when online and within quota.
3. **Resilient AI + Deterministic Fallbacks (`aiClient.ts`):** Groq LLM calls execute directly from the browser using either `VITE_GROQ_API_KEY` or a runtime user-supplied key stored strictly in `localStorage`. On missing keys, offline state, or HTTP 429 rate limits, the engine applies automatic exponential cooldowns, serves cached local responses, or generates structured deterministic SSC CGL explanations and General Awareness static GK lookups (`staticGkBank.ts`).

---

## 2. Component Connection Map

```text
main.tsx
 └── AppErrorBoundary ("Application")
      └── App.tsx (Session state, route resolution, React.lazy + Suspense, online auto-sync, IDB bootstrap)
           ├── AuthGateway.tsx (Student ID/Pass login on "/" OR Restricted Admin login on "/om")
           ├── StudentDashboard.tsx (Student Workspace · Code-Split via React.lazy)
           │    ├── TopNav.tsx (Zone 1 Tabs, Zone 2 Back, Zone 3 NotificationBell + ThemeToggleButton + AI Key + Sign Out)
           │    ├── AspirantCoachCard.tsx (Deterministic Weakest-Section Sprint & Exam Readiness Engine)
           │    ├── PendingTestsPanel.tsx & CompletedTestsPanel.tsx
           │    ├── CustomMockBuilderModal.tsx & StudyFormulaBoosterModal.tsx
           │    ├── LeaderboardPanel.tsx (Dynamic XP Cohort Standings)
           │    ├── ProgressChartPanel.tsx
           │    │    ├── 7-Day Activity & Score Trend Charts
           │    │    ├── 18-Week (126-Day) Study Calendar Heatmap (buildStudyCalendarHeatmap)
           │    │    ├── Speed × Accuracy Efficiency Rank Card (computeEfficiencyRank)
           │    │    └── 10 Achievement Badges Grid (computeEarnedBadges)
           │    ├── RevisionVault.tsx (Smart Revision Vault 2.0)
           │    │    ├── Micro-Topic Mistake Clusters & One-Click Adaptive Mini-Mock Launcher
           │    │    ├── Completed Test Review Mode + QuestionTimeGraph.tsx
           │    │    └── AI Deep Note Cache + Mastery Toggle
           │    └── StudentProfilePanel.tsx + EditProfileModal.tsx + PrintableReportModal.tsx + PWAInstallButton.tsx
           ├── TcsIonTestEngine.tsx (Full TCS iON Exam Simulator · Code-Split via React.lazy)
           │    ├── Section Switcher, Question Palette, Bilingual Toggle (EN/HI), ExamCalculator.tsx, ExamRoughPadModal.tsx
           │    ├── IndexedDB + LocalStorage Auto-Draft Persistence (saveTestDraft)
           │    ├── Optional Live Camera Proctoring (useStudentProctorPublisher)
           │    └── Post-Test Dashboard + Section Analytics + QuestionTimeGraph.tsx + AI Post-Mortem
           ├── DestComputerSimulator.tsx (Data Entry Speed Test Typing Engine on "/dest-simulator")
           ├── AdminControlCenter.tsx (Super Admin Console on "/om" · Code-Split via React.lazy)
           │    ├── LeaderboardPanel.tsx
           │    ├── AdminCohortProgressSection.tsx
           │    │    ├── Cohort Command Center (Avg Mock %, Equiv /200, Accuracy, Study Hours, Top Platform Weak Topics)
           │    │    ├── Per-Student ProgressChartPanel.tsx & RankBadge.tsx
           │    │    └── GitReportsSyncCard.tsx & PrintableReportModal.tsx
           │    ├── AdminLiveProctorPanel.tsx (WebRTC / Presence Live Proctor Feed)
           │    ├── VIP Cohort Roster + 1-Click Scoped Data Portability (Full / Students+Attempts / Questions+Mocks JSON)
           │    ├── Gamification Formula + Manual XP Adjust + Cohort Tasks
           │    ├── Question Bank (Manual + Groq AI + External API + Bulk CSV/JSON + AdminPdfIngestor + PdfQuestionExtractor)
           │    ├── Tests Tab (7-Day Daily Automation + Chapter-Blueprint Custom Mock JSON Builder + Manual Composer)
           │    └── Support Tickets Desk
           └── Global Chrome
                ├── AiKeySettingsModal.tsx (Runtime Groq Key Entry, Validation, Test Connection, Cooldown Status)
                ├── OfflineIndicator.tsx (Offline Mode + IndexedDB Sync Queue Badge)
                ├── RulesGuideModal.tsx & CameraRulesModal.tsx
                └── FloatingSupportChatWidget.tsx
```

---

## 3. End-to-End Data Flow

```text
1. ATTEMPTING A TEST (ONLINE OR OFFLINE)
   Student clicks "Start Mock" / "Cache Mocks Offline"
     └─> firestoreService.cacheTestForOfflineLaunch() / cacheAllPublishedMocksForOffline()
           └─> Saves full MockTestDoc + resolved QuestionDoc[] in IndexedDB ("mock_packs" store)
     └─> TcsIonTestEngine auto-saves per-second answers & timers via saveTestDraft()
           └─> Writes to Firestore (if online) + localFallbackStore + IndexedDB ("test_drafts" store)

2. SUBMISSION & GAMIFICATION
   Student clicks "Submit Test"
     └─> examEngine.calculateTestOutcome() computes score, accuracy, sectionStats, perQuestionResults
     └─> firestoreService.submitTestAttempt()
           ├─> Writes TestAttemptDoc + responses, updates LeaderboardEntry & XpLedgerEntryDoc
           ├─> Auto-populates unmastered wrong/skipped items into Revision Vault
           ├─> Clears completed draft from Firestore + IndexedDB
           └─> If offline or Firestore quota exceeded -> persists locally & pushes to pendingSyncOps[]

3. AUTOMATIC CLOUD RECONCILIATION
   Browser fires window 'online' event (or Admin/Student clicks "Retry Cloud Sync")
     └─> App.tsx invokes firestoreService.syncPendingLocalOpsToCloud()
           └─> Replays queued creates/updates/deletes in order to Cloud Firestore

4. AI POST-MORTEM & SMART REVISION VAULT 2.0
   Student views QuestionTimeGraph (timeSpentSec vs. target pace, flags >1.75x Time Sinks)
     └─> Requests AI Deep Note / Mistake Analysis via aiClient.ts
           ├─> Static GA queries resolved locally first via staticGkBank.ts
           ├─> Checks deterministic response cache in localStorage
           ├─> Calls Groq API using Runtime UI Key (priority) or VITE_GROQ_API_KEY
           └─> On HTTP 429 / network error -> records 60s cooldown & returns structured deterministic fallback
     └─> RevisionVault groups mistakes into Micro-Topic Clusters (e.g. "Quant - Percentage")
           └─> "Launch Adaptive Mini-Mock" builds a real MockTestDoc via createSmartPracticeTest() and opens TcsIonTestEngine

5. ADMIN COHORT COMMAND CENTER
   Admin opens "/om" -> Analytics tab
     └─> fetchAllStudentsRevisionVaultsAdmin() merges cross-student Revision Vaults + attempts + sessionLogs
     └─> computeCohortCommandCenterStats() ranks Platform-Wide Weak Topics & computes Cohort KPIs
     └─> Admin builds targeted blueprint mocks in Tests tab -> exports Portable Custom Mock JSON or publishes live
```

---

## 4. Complete Directory Structure

| Path | Responsibility |
| :--- | :--- |
| `/src/App.tsx` | Top-level SPA router (`/`, `/om`, `/dest-simulator`), session lifecycle, `React.lazy` code-splitting, `AppErrorBoundary` guards, IndexedDB bootstrap, and online sync listener. |
| `/src/components/` | UI modules: `AuthGateway`, `TopNav`, `StudentDashboard`, `TcsIonTestEngine`, `DestComputerSimulator`, `ProgressChartPanel`, `QuestionTimeGraph`, `RevisionVault`, `AdminControlCenter`, `AdminCohortProgressSection`, `AiKeySettingsModal`, `OfflineIndicator`, `AppErrorBoundary`, plus modals and PDF tools. |
| `/src/lib/aiClient.ts` | Browser Groq client with runtime key management (`setRuntimeGroqApiKey`, `testGroqApiKey`), response caching, HTTP 429 exponential cooldown tracking, Static GK short-circuit, and offline deterministic fallbacks. |
| `/src/lib/firestoreService.ts` | Hybrid Firestore + LocalFallback + IndexedDB data access layer: auth, VIP roster, questions, mocks, attempts, drafts, offline mock pack caching, revision vaults, XP ledger, tasks, support tickets, and pending sync replay. |
| `/src/lib/firebase.ts` | Client-side Firebase SDK initialization reading `/firebase-applet-config.json`. |
| `/src/utils/indexedDbStore.ts` | Zero-dependency IndexedDB wrapper (`path_to_cgl_idb_v1`) with object stores `kv_snapshots`, `mock_packs`, and `test_drafts` plus in-memory fallback for non-browser tests. |
| `/src/utils/localFallbackStore.ts` | Synchronous `localStorage` mirror (`getcgl_local_db_v1`), pending sync queue, tombstones, cohort snapshot export/import, and async IndexedDB hydration (`bootstrapLocalDbFromIndexedDb`). |
| `/src/utils/studentAnalyticsEngine.ts` | Pure, unit-tested analytics engine: 126-day study calendar heatmap, 10 achievement badges, Speed × Accuracy efficiency rank, Question Time Graph series builder, and Revision Vault 2.0 micro-topic cluster + adaptive mini-mock selector. |
| `/src/utils/adminCommandCenter.ts` | Pure, unit-tested admin utilities: Cohort Command Center statistics & platform weak topic aggregator, chapter-blueprint custom mock assembler, portable custom mock JSON exporter/parser, and scoped 3-tier cohort backup exporter/importer. |
| `/src/utils/examEngine.ts` | Core TCS iON scoring engine, XP calculation, daily mock identifiers, activity summary, and rank tier progression. |
| `/src/utils/tier1Engine.ts` & `/src/utils/tier2Engine.ts` | Full SSC CGL Tier-I & Tier-II balanced mock test assemblers. |
| `/src/utils/dreamPostCatalog.ts` | Dream SSC CGL posts, Grade Pay metadata, physical checklists, and canonical micro-syllabus chapter taxonomy. |
| `/src/utils/staticGkBank.ts` & `/src/data/` | Curated bilingual SSC CGL banks (`sscQuantBank`, `sscReasoningBank`, `sscEnglishBank`, `sscGaBank`, `sscStarterBank`, `gkBank.json`). |
| `/src/hooks/` | `useOnlineStatus`, `usePWAInstall`, `useStudentActivityTracker`, `useStudentProctorPublisher`, `useTheme`. |
| `/src/types/exam.ts` | Strict TypeScript domain models across students, questions, mocks, attempts, drafts, proctoring, and scoring. |
| `/vite.config.ts` | Vite + Tailwind v4 + `vite-plugin-pwa` Workbox configuration with Google Fonts runtime caching and offline SPA shell. |

---

## 5. Groq API Key Usage & Management Guide

1. **Build-Time Configuration (Optional):**
   Set `VITE_GROQ_API_KEY=gsk_...` in `.env` (never commit real secrets).
2. **Runtime Frontend UI Configuration (Recommended for Serverless SPA):**
   Click **AI Key** in the top navigation bar (`TopNav.tsx`) from either the Student Dashboard or the `/om` Admin Command Center to open `AiKeySettingsModal.tsx`:
   - Paste any valid Groq API key (`gsk_...`).
   - Click **Test Connection** to verify model latency and validity directly against `https://api.groq.com/openai/v1/chat/completions`.
   - Click **Save Key** to persist strictly in browser `localStorage` (`getcgl_runtime_groq_api_key_v1`).
   - **Precedence:** Runtime UI Key > `VITE_GROQ_API_KEY` > Offline Deterministic Engine.
3. **Graceful Degradation:**
   - Responses are cached locally in `localStorage` (`getcgl_ai_cache_v1`) to minimize duplicate requests.
   - An HTTP `429 Rate Limit` or network outage enters a temporary cooldown timer surfaced inside `AiKeySettingsModal` and seamlessly falls back to deterministic SSC CGL heuristics—no error screens or blocked workflows.
