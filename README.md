# Path to CGL (Get to CGL) — 100% Frontend-Only SSC CGL Cohort Platform

> **A 100% frontend-only, zero-backend, invite-only TCS iON Computer-Based Test (CBT) mock exam platform, cohort analytics workspace, and Tier-II DEST & Computer Knowledge simulator.**

![React 19](https://img.shields.io/badge/React-19.0-1d4ed8?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-7.x-2563eb?style=flat-square&logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8.3-646cff?style=flat-square&logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06b6d4?style=flat-square&logo=tailwindcss)
![Firebase Firestore](https://img.shields.io/badge/Firebase-Firestore_Client_SDK-f59e0b?style=flat-square&logo=firebase)
![Groq AI](https://img.shields.io/badge/Groq_AI-Client--Side_Fetch-059669?style=flat-square)
![Static SPA](https://img.shields.io/badge/Architecture-100%25_Frontend_Static_SPA-0f172a?style=flat-square)

---

## 1. 100% Frontend-Only Architecture (Zero Backend)

This project has **zero backend server** — no Node.js/Express server, no `server.ts`, no `/api/*` proxy routes, and no server-side secrets. Every feature runs **100% inside the user's browser** as a static Single Page Application (SPA) bundled with **Vite**:

| Layer | Pure Frontend Implementation |
| --- | --- |
| **UI & Build** | **React 19**, **TypeScript**, and **Tailwind CSS v4** bundled into static HTML/JS/CSS (`dist/`) via Vite (`vite.config.ts`), with offline PWA asset caching (`vite-plugin-pwa`). |
| **Client-Side Routing** | Hash-first SPA routing (`src/utils/appRoutes.ts`) + static `public/404.html` fallback supporting `/#/` (Student Portal), `/#/om` (Hidden Admin Gateway), and `/#/dest-simulator` (DEST & Computer Knowledge Simulator) on any static host without server rewrites. |
| **Local-First Cloud Hybrid Persistence** | **Local-First Store (`src/utils/localFallbackStore.ts`) + Firebase Firestore Client SDK** (`src/lib/firebase.ts` & `src/lib/firestoreService.ts`). Every write executes seamlessly even if Firestore Spark daily free write quota is exhausted or offline, merges with tombstone tracking, queues pending ops, and auto-syncs via **Retry Cloud Sync**. |
| **Browser Crypto Auth** | Salted **SHA-256** credential hashing runs natively in the browser via Web Crypto (`crypto.subtle.digest`) against Firestore + Local-First `vipInvites` and `settings/adminCredentials`, with strict tab-scoped `sessionStorage` and automatic sign-out on tab hide/close. |
| **Client-Side AI (Groq + Cache)** | Direct browser `fetch` calls to Groq's OpenAI-compatible endpoint (`https://api.groq.com/openai/v1/chat/completions`) in `src/lib/aiClient.ts` using `import.meta.env.VITE_GROQ_API_KEY` with 5-model cascade fallback (`openai/gpt-oss-120b` → `openai/gpt-oss-20b` → `llama-3.3-70b-versatile` → `meta-llama/llama-4-scout-17b-16e-instruct` → `llama-3.1-8b-instant`), persistent `localStorage` response cache, in-flight request deduplication, and deterministic offline fallbacks so rate limits never block the user. |
| **In-Browser PDF Parsing** | `pdfjs-dist` (`AdminPdfIngestor.tsx` & `PdfQuestionExtractor.tsx`) runs its Web Worker directly in the browser to extract text layers from uploaded SSC CGL PYQ PDFs before structuring them into MCQs. |
| **External Question Import** | Direct browser CORS fetches (`fetchExternalQuestionsClient`) to Open Trivia DB (`opentdb.com`) or custom HTTPS JSON feeds. |
| **Peer-to-Peer WebRTC Proctoring** | Browser `RTCPeerConnection` (`useStudentProctorPublisher.ts` & `AdminLiveProctorPanel.tsx`) using public Google STUN servers and Firestore `proctorRooms` signaling + throttled JPEG snapshot fallback — no media or signaling server required. |
| **Portable JSON Backup & Reports** | Pure browser `Blob` + `URL.createObjectURL` downloads & file-upload restores for entire cohort JSON snapshots (`localFallbackStore.ts`), `.md` / `.json` cohort reports (`GitReportsSyncCard.tsx`), and CSS `@media print` A4 PDF scorecards (`PrintableReportModal.tsx`). |

---

## 2. Routes & Portals

| Route | Purpose |
| --- | --- |
| `/#/` | **Candidate Portal:** Invite-only Student ID + Password login, Student Dashboard, TCS iON Mock Engine, Smart Topic Filter, Revision Vault, Leaderboard, and Formula Booster. |
| `/#/om` | **Hidden Super Admin Control Center:** First-time Admin ID + Master Password setup/login, VIP slot provisioning (5 slots), Question Bank & PDF Ingestor, Mock Test Builder, Cohort Progress, Live Camera Proctor, Support Tickets, and Report Exports. |
| `/#/dest-simulator` | **Tier-II Section-III Simulator:** 15-minute DEST typing test (2,000-keystroke passage, Gross/Net WPM, Error % `<= 5%` qualification, copy/paste lock) + 20-question Tier-II Computer Knowledge mock (`+3 / -1`, `18/60` qualifying mark). |

---

## 3. Complete Feature Breakdown

### Student Features
- **TCS iON CBT Exam Engine (`TcsIonTestEngine.tsx`, `tier1Engine.ts` & `tier2Engine.ts`):**
  - **100-Question Tier-I Full Mock:** 25 questions each in official SSC CGL sequence (*General Intelligence & Reasoning* → *General Awareness* → *Quantitative Aptitude* → *English Comprehension*) with a 60-minute total timer and 15-minute sectional locks/auto-advance (`+2.00 / -0.50`).
  - **100-Question Tier-II Paper-I Full Mock:** Weighted Mains pattern (`25 Quant + 25 Reasoning + 30 English + 20 GA`) prioritizing `hard` and `medium` questions with an 80-minute total timer, 20-minute sectional locks, and Tier-II marking (`+3.00 / -1.00`).
  - **AI Exam Post-Mortem & Recovery Blueprint:** Post-test diagnostic analyzing negative-mark leakage, recoverable score swing, a 3-step action checklist, and Hindi summary powered by Groq AI with instant deterministic offline computation.
  - **Strict >80% Completion Rule & Zero-Loss Resume:** Every answer, mark-for-review flag, and remaining second continuously auto-saves to browser `localStorage` and throttled Firestore `testDrafts`.
  - **Exam Tools:** 5-state Question Palette, instant EN / हिंदी toggle (with persistent per-question translation cache), built-in Exam Calculator (`ExamCalculator.tsx`), Rough Pad (`ExamRoughPadModal.tsx`), and camera proctoring verification (`CameraRulesModal.tsx`).
- **Smart Topic Mock Builder (`CustomMockBuilderModal.tsx` & `syllabusCatalog.ts`):**
  - Grouped searchable SSC CGL syllabus dropdown across all 4 subjects.
  - Pulls matching PYQs from Question Bank & bundled starter banks and dynamically generates any shortfall in bilingual JSON via client-side Groq (`aiGenerateQuestions`).
- **Dream Post & Syllabus Mastery (`dreamPostCatalog.ts`):**
  - Target post selection (*ASO in MEA*, *Income Tax Inspector*, *GST Inspector*, *AAO*, *CBI SI*, etc.) with live cut-off comparison on scorecards, Inspector/SI Physical Standards Checklist, and chapter mastery badges (>80% accuracy).
- **Revision Vault & Portable Backups (`RevisionVault.tsx` & `StudentProfilePanel.tsx`):**
  - Automatically stores wrong and skipped questions for targeted re-testing, supports cached AI deep explanations, awards activity-multiplied XP bonuses, and lets students **Download & Restore Progress Backups (JSON)** anytime in the browser.
- **Pocket Formula Sheet & Study Mentor (`StudyFormulaBoosterModal.tsx` & `FloatingSupportChatWidget.tsx`):**
  - Built-in bilingual SSC CGL formula/rule cards (works 100% offline with zero API key), cached Groq AI formula lookup + saved cards in `localStorage`, AI Study Mentor chat, and Admin Bug/Support Ticketing synced via Local-First + Firestore `supportTickets`.
- **Live Notification Bell (`NotificationBell.tsx`):**
  - Alerts for Today's Daily Mock & Sectional Drills, Admin-published tests, Cohort Missions, Pending Revision Vault count, and Resolved Support Tickets.

### Admin Features (`/#/om`)
- **VIP Cohort Management & Portable Snapshots (`AdminControlCenter.tsx`):** Provision up to 5 VIP student slots with salted SHA-256 passwords, active/paused toggles, non-destructive profile editing, **Export / Import Full Cohort Snapshot JSON**, and one-click **Retry Cloud Sync** when pending local operations exist.
- **Bulk Ingestion & PDF Extraction (`AdminPdfIngestor.tsx` & `PdfQuestionExtractor.tsx`):**
  - Drag-and-drop `.pdf` parsing directly in the browser (`pdfjs-dist`), canonical JSON bulk import, external OpenTDB / JSON API import, editable preview table, batched save, and confirmation-gated database wipe (`WipeQuestionsModal.tsx`).
- **Live Camera Proctoring (`AdminLiveProctorPanel.tsx`):** Real-time student online/in-exam status, tab-switch counter, periodic camera preview snapshots (captured only when watched or in exam), and peer-to-peer WebRTC live video stream.
- **Analytics & Browser Exports (`AdminCohortProgressSection.tsx` & `GitReportsSyncCard.tsx`):** Cohort study time logs, per-student `.md` / `.json` browser downloads, full cohort `.json` export, and printable A4 PDF reports.

---

## 4. Firestore Database Collections (Direct Client SDK)

Configured in `firebase-applet-config.json` and validated by `firestore.rules` + `firebase-blueprint.json`:
- `settings` (`scoring`, `adminCredentials`)
- `vipInvites`
- `students` (with subcollections `revisionVault` and `testDrafts`)
- `progressBackups`
- `leaderboard`
- `questions`
- `tests`
- `attempts` (with subcollection `responses`)
- `tasks`
- `xpLedger`
- `presence`
- `proctorRooms` (with subcollection `candidates`)
- `sessionLogs`
- `supportTickets`

---

## 5. Project Structure

```text
├── firebase-applet-config.json   # Firebase project & Firestore database config
├── firebase-blueprint.json       # Entity & collection schema blueprint
├── firestore.rules               # Schema-validated Firestore security rules
├── index.html                    # SPA entry HTML + theme bootstrap
├── package.json                  # Pure frontend scripts (Vite, TypeScript, tsx tests)
├── public/                       # PWA icons & GitHub Pages 404.html SPA redirect
├── vite.config.ts                # Vite + Tailwind v4 + VitePWA config (port 3000)
└── src/
    ├── App.tsx                   # Session lifecycle, routing, daily mock sync & shell
    ├── components/               # Dashboard, Exam Engine, Admin Center, DEST, Modals
    ├── data/                     # Built-in starter SSC CGL question banks
    ├── hooks/                    # Online status, PWA install, activity & WebRTC proctor
    ├── lib/
    │   ├── aiClient.ts           # 100% browser-side Groq API client + OpenTDB fetcher
    │   ├── firebase.ts           # Firebase app & Firestore client initialization
    │   └── firestoreService.ts   # All Firestore CRUD, subscriptions & SHA-256 auth
    ├── types/exam.ts             # Shared TypeScript interfaces
    └── utils/                    # Pure exam, Tier-I, DEST, PDF, syllabus & route logic
```

---

## 6. Local Development, Testing & Build

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Optional — Enable Client-Side Groq AI Features:**
   Copy `.env.example` to `.env` and add your Groq API key (all non-AI features, built-in question banks, built-in formula sheets, Firestore sync, PDF text parsing, and CBT exams work even without a key):
   ```env
   VITE_GROQ_API_KEY=your_groq_api_key_here
   ```

3. **Run the frontend dev server (Vite on port `3000`):**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000/` for the Student Portal or `http://localhost:3000/#/om` for the Admin Control Center.

4. **Run unit tests, TypeScript check, and production build:**
   ```bash
   npm test       # Runs all 15 unit test suites (80 tests) via tsx --test
   npm run lint   # Runs tsc --noEmit
   npm run build  # Outputs pure static SPA bundle to dist/
   npm run start  # Serves built dist/ via vite preview on port 3000
   ```

---

## 7. Static Deployment (Zero Backend Required)

Because there is no backend server, the `dist/` folder can be hosted on **any static hosting provider**:

- **GitHub Pages (`https://koshti-ji.github.io/SSC-CGL/`):**
  ```bash
  npm run deploy
  ```
  Runs `vite build` (default production `base: '/SSC-CGL/'`) and publishes `dist/` via `gh-pages`. For GitHub Actions CI, pass `VITE_GROQ_API_KEY` as a repository secret during the build step.

- **Root-Domain Static Hosts (Netlify, Vercel, Cloudflare Pages, Firebase Hosting):**
  Build with root base path:
  ```bash
  BASE_PATH=/ npm run build
  ```
  Publish the generated `dist/` directory.
