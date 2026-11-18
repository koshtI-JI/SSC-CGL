# Dependency Map — Path to CGL (`koshtI-JI/SSC-CGL`)

> **Verification Command**: `npm ls --depth=0` + static import analysis of `src/`.

---

## 1. NPM Dependencies (`package.json` vs Installed)

### Runtime Dependencies
| Package | `package.json` Spec | Installed Version | Primary Consumers |
| :--- | :--- | :--- | :--- |
| `react` | `^19.0.1` | `19.3.1` | All UI components (`src/`) |
| `react-dom` | `^19.0.1` | `19.3.1` | `src/main.tsx` (`createRoot`) |
| `firebase` | `^13.3.0` | `13.4.0` | `src/lib/firebase.ts`, `src/lib/firestoreService.ts` (`firebase/app`, `firebase/firestore` only; **`firebase/auth` unused**) |
| `lucide-react` | `^0.546.0` | `0.546.0` | All components & `AuthGateway` |
| `motion` | `^12.23.24` | `12.43.0` | `StudentDashboard`, modals, route transitions (`motion/react`) |
| `pdfjs-dist` | `^6.5.438` | `6.5.438` | `src/components/AdminPdfIngestor.tsx`, `src/components/PdfQuestionExtractor.tsx` |
| `@tailwindcss/vite` | `^4.3.3` | `4.3.5` | `vite.config.ts` |
| `@vitejs/plugin-react` | `^6.1.1` | `6.3.0` | `vite.config.ts` |
| `vite` | `^8.3.0` | `8.3.8` | Build / dev / preview server |
| `vite-plugin-pwa` | `^2.0.0` | `2.0.0` | `vite.config.ts` (generates `sw.js`, `manifest.webmanifest`) |
| `@firebase/eslint-plugin-security-rules` | `^0.0.2` | `0.0.2` | `eslint.config.mjs` (rules linting via `npx eslint firestore.rules`) |

### Dev Dependencies & Lockfiles
| Package | `package.json` Spec | Installed Version | Purpose |
| :--- | :--- | :--- | :--- |
| `typescript` | `^7.0.2` | `7.0.2` | `npm run lint` (`tsc --noEmit`) |
| `tsx` | `^4.21.0` | `4.23.15` | `npm test` (`tsx --test ...`) |
| `eslint` | `^10.14.0` | `10.15.0` | Rules & workspace linting (`eslint.config.mjs`) |
| `gh-pages` | `^6.3.0` | `6.3.0` | `"deploy": "gh-pages -d dist"` |
| `tailwindcss` | `^4.3.3` | `4.3.5` | Global stylesheet `src/index.css` |
| `autoprefixer` | `^10.4.21` | `10.6.2` | CSS vendor prefixing |
| `esbuild` | `^0.25.0` | `0.25.12` | Transitive / tooling bundler |
| `@types/node` | `^22.14.0` | `22.14.0` | Node types for tests/Vite config |
| `@types/react` / `@types/react-dom` | `^19.3.0` | `19.3.0` | React TS types |

> **Lockfile Note**: Workspace contains `bun.lock` (202,964 bytes) and `package.json`, with no `package-lock.json`.

---

## 2. Internal Module Import Graph

```
src/main.tsx
 └── src/App.tsx
      ├── src/utils/appRoutes.ts
      ├── src/utils/localFallbackStore.ts ──> src/utils/indexedDbStore.ts
      ├── src/lib/firestoreService.ts
      │    ├── src/lib/firebase.ts ──> firebase-applet-config.json
      │    ├── src/utils/localFallbackStore.ts
      │    ├── src/utils/indexedDbStore.ts
      │    ├── src/utils/firestoreQuota.ts
      │    ├── src/utils/examEngine.ts
      │    ├── src/utils/sessionAndOverrides.ts
      │    └── src/data/sscStarterBank.ts (quant/reasoning/english/ga + gkBank.json)
      ├── src/hooks/useStudentActivityTracker.ts ──> firestoreService, sessionAndOverrides
      ├── src/hooks/useStudentProctorPublisher.ts ──> firestoreService, sessionAndOverrides
      ├── [static] AuthGateway, TopNav, FloatingSupportChatWidget (──> aiClient.ts), OfflineIndicator
      └── [lazy] StudentDashboard, AdminControlCenter, TcsIonTestEngine, DestComputerSimulator, Modals
```

---

## 3. Critical Coupling & Caller Maps (Phase 2 & Phase 3 Targets)

### 3.1 `src/utils/sessionAndOverrides.ts` (`isRealCohortStudentUid` & `filterRealCohortRecords`)
Directly imports from: `../types/exam`, `./examEngine`.  
Direct callers verified by `grep`:
- `src/components/AdminControlCenter.tsx` (lines 281, 289, 293, 297, 301, 305, 309)
- `src/components/AdminCohortProgressSection.tsx` (lines 55, 63, 67, 71, 75, 82)
- `src/components/AdminLiveProctorPanel.tsx` (lines 261–264)
- `src/lib/firestoreService.ts` (lines 1367, 1402, 3110, 3163, 3351, 3483, 5585)
- `src/hooks/useStudentActivityTracker.ts` (line 93)
- `src/hooks/useStudentProctorPublisher.ts` (lines 188, 402, 422, 449)
- `src/utils/sessionAndOverrides.test.ts`

### 3.2 VIP Roster Mutation Helpers (`src/lib/firestoreService.ts`)
- `upsertVipInvite()` (lines 1054–1128) — called by `AdminControlCenter.tsx` (and legacy code paths)
- `createNewVipUser()` (lines 1164–1225) — called by `AdminControlCenter.tsx` inline VIP Cohort form
- `updateVipUser()` (lines 1244–1333) — called by `AdminControlCenter.tsx` inline VIP Cohort edit/toggle form
- `deleteVipInvite()` (lines 1337–1353) — called by `AdminControlCenter.tsx` inline VIP Cohort delete action
- `verifyStudentLogin()` (lines 382–523) — called by `AuthGateway.tsx`
- `verifyAdminLogin()` & `updateAdminCredentials()` (lines 304–380) — called by `AuthGateway.tsx`, `AdminControlCenter.tsx`

### 3.3 Static / Dynamic Import Warnings
- `src/components/RulesGuideModal.tsx`: imported **statically** by `src/components/AuthGateway.tsx` AND **dynamically** via `lazy()` by `src/App.tsx` -> Vite reports `[INEFFECTIVE_DYNAMIC_IMPORT]` and bundles it into main entry chunk.
- `src/lib/aiClient.ts` (1,745 lines): pulled into main entry chunk via `FloatingSupportChatWidget.tsx` -> `App.tsx`, and into `AdminControlCenter` via `AdminPdfIngestor` / `PdfQuestionExtractor` / `AiKeySettingsModal`.
- `pdfjs-dist`: isolated inside `AdminControlCenter` chunk (`AdminPdfIngestor.tsx`, `PdfQuestionExtractor.tsx`), except its `1,271.91 kB` worker asset is emitted under `dist/assets/`.
