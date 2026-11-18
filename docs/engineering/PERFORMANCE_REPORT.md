# Path to CGL — Performance & Bundle Audit Report

**Branch**: `repair/path-to-cgl`
**Measurement Basis**: Real Vite `dist/` outputs comparing M6 pre-optimization baseline (`3f93d5f`) against final M9 `HEAD` (`vite build` + `BASE_PATH=/SSC-CGL/ vite build`), plus headless Chromium `performance.getEntriesByType('navigation')` measurements.

---

## 1. Optimization Changes Implemented (M7 + M8)

1. **Lazy-Loaded Non-Critical Entry Modals & Floating Chat** (`src/components/AuthGateway.tsx`, `src/App.tsx`):
   - Converted `RulesGuideModal` and `FloatingSupportChatWidget` to `React.lazy(...)` + `<Suspense fallback={null}>`, removing their code from the initial entry chunk (`index`).
2. **Explicit Rollup Vendor `manualChunks`** (`vite.config.ts`):
   - Split large third-party packages into deterministic cacheable vendor bundles:
     - `vendor-firebase` (`firebase/*`)
     - `vendor-react` (`react`, `react-dom`)
     - `vendor-icons` (`lucide-react`)
     - `vendor-motion` (`motion`)
     - `vendor-pdf` (`pdfjs-dist`)
3. **Exam-Safe Workbox Precaching** (`vite.config.ts`):
   - Added `**/*.jpg` to `workbox.globPatterns` so the hero arena banner (`719.80 kB`) is precached for offline launch, and switched PWA registration from `autoUpdate` to `prompt` guarded against active exams and `#/dest-simulator`.

---

## 2. Before vs. After Bundle Comparison (`BASE_PATH=/`)

| Asset / Metric | Baseline (`3f93d5f`) | Final M9 (`HEAD`) | Change |
| --- | --- | --- | --- |
| Entry `index-*.js` (raw) | `1,363.42 kB` | `331.26 kB` | **-75.7%** |
| Entry `index-*.js` (gzip) | `395.62 kB` | `85.50 kB` | **-78.4%** |
| `AdminControlCenter-*.js` (raw) | `795.95 kB` | `347.19 kB` | **-56.4%** |
| `AdminControlCenter-*.js` (gzip) | `198.25 kB` | `62.78 kB` | **-68.3%** |
| `StudentDashboard-*.js` (raw / gzip) | `323.34 kB` / `60.96 kB` | `320.99 kB` / `59.93 kB` | `-0.7%` |
| `TcsIonTestEngine-*.js` (raw / gzip) | `120.93 kB` / `21.99 kB` | `119.41 kB` / `21.33 kB` | `-1.3%` |
| `TopNav-*.js` (raw / gzip) | `97.73 kB` / `18.20 kB` | `88.87 kB` / `14.46 kB` | **-9.1%** (`-20.5%` gzip) |
| `RulesGuideModal-*.js` (lazy) | Bundled in entry | `14.67 kB` (`3.27 kB` gzip) | Deferred off initial load |
| `FloatingSupportChatWidget-*.js` (lazy) | Bundled in entry | `16.27 kB` (`3.82 kB` gzip) | Deferred off initial load |
| `vendor-firebase-*.js` (raw / gzip) | Mixed in entry | `492.98 kB` (`148.59 kB` gzip) | Cache-split `< 500 kB` |
| `vendor-pdf-*.js` (raw / gzip) | Mixed in admin | `443.06 kB` (`133.32 kB` gzip) | Cache-split `< 500 kB` |
| `vendor-react-*.js` (raw / gzip) | `148.53 kB` / `50.14 kB` | `404.72 kB` (`123.13 kB` gzip) | Unified React runtime |
| `vendor-motion-*.js` (raw / gzip) | Mixed in entry | `132.86 kB` (`44.03 kB` gzip) | Cache-split |
| `vendor-icons-*.js` (raw / gzip) | Mixed in entry | `46.92 kB` (`16.13 kB` gzip) | Cache-split |
| Rollup / Vite Build Warnings | `[INEFFECTIVE_DYNAMIC_IMPORT]` + `>500 kB` | **0 warnings** | **Resolved** |
| PWA Precache (`BASE_PATH=/`) | `30 entries (3034.78 KiB)` | `37 entries (3749.04 KiB)` | Includes hero `.jpg` + split chunks |

---

## 3. Subpath Production Build (`BASE_PATH=/SSC-CGL/`)

- Build command: `BASE_PATH=/SSC-CGL/ npm run build`
- Build time: `1.06s`, **0 warnings**
- `dist/index.html`: `3.07 kB` (`1.11 kB` gzip)
- Entry `index-*.js`: `331.32 kB` (`85.52 kB` gzip)
- Precache: `36 entries (3749.21 KiB)`

---

## 4. Headless Chromium Runtime & Offline Latency Metrics

Measured via Playwright CLI against local Vite server (`http://localhost:3000/`) with Firebase network routes aborted:
- **Navigation Timing (`/#/om`)**: `domContentLoadedEventEnd: 4194 ms`, `loadEventEnd: 4196 ms` (dev-server unbundled ESM cold load).
- **Offline / Blocked-Network Exam Submission (`submitTestAttempt`)**: Completed end-to-end persistence to local store + `pendingSyncOps` queue + Result Scorecard render in **`3131 ms`** (down from 30–45s+ WebChannel retry stalls prior to M9 timeout hardening).
- **Layout Stability**: `0 px` horizontal scroll overflow on `1440x900` desktop and `390x844` mobile across auth, student dashboard, exam engine, DEST simulator, and admin views.
