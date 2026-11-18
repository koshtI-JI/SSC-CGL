# Baseline Report — Phase 0 & Phase 1 Verification (`Path to CGL`)

> **Scope**: Verified workspace isolation, file checksums, unit tests, type-check/rules linting, production build sizes, and `reports/` audit on branch `repair/path-to-cgl` (commit `3f4b0c7`).  
> **Code Integrity**: Zero edits to `src/`, `firestore.rules`, `package.json`, `vite.config.ts`, `firebase-applet-config.json`, or production Firebase.

---

## 1. Phase 0 Workspace Protection Summary

| Check | Verified Value |
| :--- | :--- |
| Immutable pre-repair tarball | `/tmp/path-to-cgl-backups/pre-repair-baseline.tar.gz` (`1.3 MB`) |
| Tarball exclusions | `node_modules`, `dist`, `dev-dist`, `.git`, `.playwright-cli` |
| Backup SHA-256 checksum | `9a0035f117b8ec35404580252964f59ad23d6342bcc4f5a283734cda794cd5e0` |
| Git repository & `main` baseline | Local repo initialized; `main` at `3f4b0c7` (`139 files changed, 56775 insertions(+)`) |
| Isolated repair branch | `repair/path-to-cgl` (active) |
| Remote configuration | `git remote -v` empty (`0` remotes configured — offline/local isolation verified) |

---

## 2. Baseline Verification Commands & Results

| Command | Result | Exact Measured Output |
| :--- | :---: | :--- |
| `node --version` / `npm --version` | PASS | Node `v22.23.2`, npm `10.9.8` |
| `npm test` (`20` listed suites) | PASS | `107/107` tests passed (`0` fail, `duration_ms: 1873.52`) |
| `npx tsx --test src/utils/studyCoach.test.ts` | PASS | `7/7` tests passed (`0` fail, `duration_ms: 199.22`; omitted from `package.json` `"test"`) |
| Combined Unit Test Coverage | **114 / 114** | Across `21` `*.test.ts` files on disk |
| `npm run lint` (`tsc --noEmit`) | PASS | `0` TypeScript errors |
| `npx eslint firestore.rules` | PASS | `0` ESLint security-rules errors |
| `npm run build` (`vite build`) | PASS (with warnings) | Built in `1.25s`; `2,163` modules; PWA precache `31` entries (`2,949.12 KiB`) |
| `which lighthouse` | **NOT MEASURED** | `lighthouse` CLI is not installed in this container |

### Lighthouse Status (Not Measured)
Because neither `lighthouse` nor headless Lighthouse runner CLI is installed in this environment, **no Lighthouse scores are reported or fabricated**. The owner can measure baseline Performance / Accessibility / Best Practices / SEO / PWA scores locally with:
```bash
npm run build && npm run preview -- --port 3000
# In another terminal:
npx lighthouse http://localhost:3000 --view --output=html --output-path=./lighthouse-baseline.html
```

---

## 3. Production Build Chunk & Asset Inventory (`npm run build`)

| Output Artifact | Raw Size | Gzip Size | Notes |
| :--- | ---: | ---: | :--- |
| `dist/assets/index-DhsvY2f8.js` | **1,342.51 kB** | **390.48 kB** | Over 500 kB Vite limit warning; includes Firebase, starter banks, `RulesGuideModal`, `FloatingSupportChatWidget` (`aiClient`) |
| `dist/assets/pdf.worker.min-CIqJB0yW.mjs` | 1,271.91 kB | — | Emitted for `pdfjs-dist@6.5.438` |
| `dist/assets/AdminControlCenter-UBsNzDF4.js` | **736.75 kB** | **185.85 kB** | Over 500 kB Vite limit warning |
| `dist/assets/hero_cgl_arena_1794665281724-D-DO8zc4.jpg` | 719.80 kB | — | Excluded from Workbox precache (`.jpg` missing from `globPatterns`) |
| `dist/assets/StudentDashboard-DUb6ksdW.js` | 322.25 kB | 60.57 kB | Lazy-loaded student workspace |
| `dist/assets/react-GIkDdfCk.js` | 148.48 kB | 50.13 kB | Shared React runtime |
| `dist/assets/TcsIonTestEngine-BdpmaqJC.js` | 117.13 kB | 21.16 kB | Lazy-loaded exam interface |
| `dist/assets/index-d-UXzDeq.css` | 109.69 kB | 16.00 kB | Tailwind CSS v4 bundle |
| `dist/assets/TopNav-x3TcjT8g.js` | 98.05 kB | 18.32 kB | Shared top navigation chunk |
| `dist/assets/DestComputerSimulator-SHa7d-BQ.js` | 42.99 kB | 10.74 kB | DEST simulator route chunk |
| `dist/assets/jsx-dev-runtime-AmfmlME3.js` | 28.18 kB | 9.23 kB | Runtime helper |
| `dist/assets/QuestionTimeGraph-BC3zEKHo.js` | 16.92 kB | 3.90 kB | Chart component |
| `dist/assets/AiKeySettingsModal-CS0atwrP.js` | 15.71 kB | 3.91 kB | Lazy modal |
| `dist/assets/CameraRulesModal-Bm9-m7KO.js` | 8.33 kB | 2.02 kB | Lazy modal |
| `dist/index.html` / `dist/manifest.webmanifest` / `dist/registerSW.js` | 2.55 / 0.59 / 0.13 kB | 1.03 kB (HTML) | Plus `dist/sw.js` & `dist/workbox-afac4cd2.js` |

### Build Warnings Observed
1. **Chunk Size Warning**: `Some chunks are larger than 500 kB after minification` (`index-*.js`, `AdminControlCenter-*.js`).
2. **`[INEFFECTIVE_DYNAMIC_IMPORT]`**: `src/components/RulesGuideModal.tsx` is dynamically imported in `src/App.tsx` and statically imported in `src/components/AuthGateway.tsx`.

---

## 4. Key Configuration & Source File Checksums (SHA-256)

| File | SHA-256 |
| :--- | :--- |
| `package.json` | `e180a3bacef16d7fbac38fc26298b236d9efeb1ab5d53918de8f8d698cce368d` |
| `vite.config.ts` | `b128fe9e50df30149394ba13b43aa0abb75f2c0c5b5aa62012b6e239cf2898cf` |
| `tsconfig.json` | `e9715df750ac29ff79091b6d636c63fcd8ad90b312acd2092367ac82ae6f0bcb` |
| `eslint.config.mjs` | `f08d66a1452d415cbe68e8ee605323be3da33f7a6fde0958c7cb3825f5b029f9` |
| `index.html` | `bdc65ea517d3fc88227906c5512deed6d4f4dcd0862701b4094c34e2de08f9b9` |
| `metadata.json` | `56e1607e97267885be00bacfdf7786989b1b24724284981cbc9c1554ea1a15fb` |
| `firestore.rules` | `b1ba4132908e9b5e2def37dbeb6d51b90563d5f0755d89a24d1b27c069c20d61` |
| `firebase-blueprint.json` | `6678d679757d9bd73712ad9ad14e1f44eeb2f2f10af088b5fe6c8b9f8f57497c` |
| `firebase-applet-config.json` | `14ed489f7ff1dc514ae6aded5f5e34e6c1d366b70162648861de0701cbdde5b9` |
| `src/App.tsx` | `3e59d23f0c10af7f44ba3e17ea631050736fa61f4b5e629e9ac52ec41bbf2d4c` |
| `src/lib/firebase.ts` | `f06316ea5d0073110c92eb20c26c0d8fba0eb614a73edc98ab379b323ff24cf0` |
| `src/lib/firestoreService.ts` | `10765730950f39f77dd4f8ea02ccf2f6e099e8b49791d1308c2f961afebb2e31` |
| `src/utils/sessionAndOverrides.ts` | `65e83e65aa931c08fb0c52444027300ef959c732a4b5db493cec29d9352d7b00` |
| `src/utils/localFallbackStore.ts` | `e158b8d09c38d46c60836f948b9868a58d08cffe1482319a2bfc56878407b8ba` |
| `src/utils/indexedDbStore.ts` | `51f43a40e881a2f1d3e789fa2fb8bf7292200675ce3baf90f3d2f1127e7bd736` |
| `src/components/TcsIonTestEngine.tsx` | `a2e544fd2d4a174d661f021fdcfe7b9255bb9df63f87e621cfadb59b92db1aaf` |
| `src/components/AdminControlCenter.tsx` | `e69b284fd2ccabe26c9e1bef080b5aa7a9ea87304fbdeb6624737477aeb8eebb` |
| `src/components/AdminCohortProgressSection.tsx` | `47692011adcbf53ec212a402dec9f4f76a27f93f7ecbcc28f3921590507c824b` |
| `reports/cohort_summary.json` | `1d1e1232910d4e4ab590ccfc3f8274bf244396926236ca3e2cde705f3cc15d0b` |
| `reports/cohort_summary.md` | `c14680d1f286396c6af4e4d3888763c969cb454136b5fa02e81999379f774342` |
| `reports/students/admin.json` | `28bec04ab1fa37d47e38391d7bca14c3c919d089867cc4c573696057768ff0b6` |
| `reports/students/damini_01.json` | `ff51d4fa44015924f66c8ba357ac2d6e6618c61a9bc8e01d21798872f3147db3` |
| `reports/students/damini_888.json` | `a20e08c47b92b8ca0515f3f1fccba5011e20ea2bb68b96be0d1ff78ce4600274` |
| `reports/students/demo_123.json` | `585b1751730d984a9941d3c2aa878c09cfac054a2ac06ba63638b37dd7037ed8` |

---

## 5. `reports/` Snapshot Baseline Summary

- `reports/students/damini_01.json` (exported `2026-04-12T07:29:14.703Z`): `uid: "damini_01"`, `loginId: "damini_01"`, `slotNumber: 1`, `totalXp: 502`, `testsAttempted: 6`, `bestScore: 30`.
- `reports/students/damini_888.json` (exported `2026-04-12T16:43:39.500Z`): `uid: "damini_01"`, `loginId: "damini_888"`, `slotNumber: 1`, `totalXp: 530`, `testsAttempted: 7`, `bestScore: 30`.
- `reports/students/demo_123.json` (exported `2026-04-12T17:19:53.030Z`): `uid: "demo_123"`, `loginId: "demo@123"`, `slotNumber: 1`, `totalXp: 42`, `testsAttempted: 3`, `bestScore: 7`.
- `reports/students/admin.json`: `uid: "admin_preview"`, `slotNumber: 1`, `totalXp: 0`, `testsAttempted: 0`.
