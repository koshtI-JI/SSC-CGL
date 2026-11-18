# Original Archive (`path-to-cgl.zip`) Availability Verification Report

> **Verification Mode**: Strictly read-only inspection of `/app/applet`, `/tmp`, mounted AI Studio assets, and repository Git history on branch `repair/path-to-cgl`.  
> **Strategy Status**: Owner approved **Option C (Reconciled Development Baseline)** as architectural strategy only. **Phase 2 implementation is NOT authorized and has NOT started.**  
> **Gate Result**: **STOPPED AT ARCHIVE AVAILABILITY CHECK — `path-to-cgl.zip` IS NOT AVAILABLE IN THE WORKSPACE.**

---

## 1. Archive Search Evidence

Direct filesystem and Git commands run in `/app/applet` verify the absence of the original uploaded ZIP archive:

| Location / Scope Checked | Command / Method Executed | Observed Result |
| :--- | :--- | :--- |
| **Workspace tree (`/app/applet`)** | `find /app/applet -maxdepth 5 -not -path "/app/applet/node_modules*" -not -path "/app/applet/.git*" \( -iname "*.zip" -o -iname "*.tar*" -o -iname "*.rar" -o -iname "*.7z" \)` | **0 matches** (`""`). No `.zip` or other archive exists inside `/app/applet`. |
| **AI Studio uploaded assets (`/app/applet/public/assets/aistudio/`)** | `ls -la /app/applet/public/assets/aistudio/` | Contains **only 1 file**: `PathToCGL_Master_Repair_Plan_b41b4299.txt` (`87,782` bytes) — a text engineering plan, **not** source code or a ZIP archive. |
| **Temporary directories (`/tmp`, `/tmp/path-to-cgl-backups/`)** | `ls -la /tmp /tmp/path-to-cgl-backups` | Contains only `/tmp/path-to-cgl-backups/pre-repair-baseline.tar.gz` (`1,304,994` bytes, SHA-256 `9a0035f117b8ec35404580252964f59ad23d6342bcc4f5a283734cda794cd5e0`), which is our Phase 0 backup of the current `/app/applet` GitHub checkout (`3f4b0c7`), **not** `path-to-cgl.zip`. |
| **Git repository tracked files & commits** | `git branch -vv && git log -n 5 --oneline && git ls-files \| grep -E "zip\|AdminUserManagementTab\|ConfigContext\|LiveDataContext\|useLiveDataSync\|cloudFirstSync\|platformConfig\|LiveCodeEditorPanel\|githubCodeEditor\|DynamicSettingsManagerPanel"` | **0 matches** (`git ls-files`). Only two local branches exist: `main` (`3f4b0c7` baseline import) and `repair/path-to-cgl` (`853c76c`, `b611441`, `77f7f9b` docs-only commits). Zero Git remotes exist; earlier commit history from `koshtI-JI/SSC-CGL` is not embedded in `.git`. |

---

## 2. Why Direct Phase A Source Comparison Cannot Be Completed

1. **No binary archive to validate or extract**: Because `path-to-cgl.zip` is not mounted anywhere in `/app/applet`, `/tmp`, or Git history, SHA-256 checksum calculation, archive integrity testing, and isolated `/tmp` extraction cannot be performed.
2. **Audit docs are not original source code**: Earlier Phase 1 parity notes inferred ZIP file structure and behaviors from `public/assets/aistudio/PathToCGL_Master_Repair_Plan_b41b4299.txt` (an AI-authored plan/summary document) and `README.md`. Per strict engineering standards, **neither `PathToCGL_Master_Repair_Plan_b41b4299.txt` nor `README.md` may be treated as equivalent to inspecting actual original source files**.
3. **Zero fabricated comparisons**: Rather than inventing line-by-line comparisons for files we cannot read (`AdminUserManagementTab.tsx`, `ConfigContext.tsx`, `LiveDataContext.tsx`, `useLiveDataSync.ts`, `cloudFirstSync.ts`, `platformConfig.ts`, `LiveCodeEditorPanel.tsx`, `githubCodeEditor.ts`, `DynamicSettingsManagerPanel.tsx`) or guessing hidden diffs inside shared files (`App.tsx`, `firestoreService.ts`, `package.json`, `vite.config.ts`), Phase A direct comparison is **formally paused** until the original archive is supplied.

---

## 3. Verified vs. Unverified Findings Boundary

### 3.1 Directly Verified in the Current Workspace (`koshtI-JI/SSC-CGL` at `/app/applet`)
Every fact below was inspected directly in `/app/applet` source files, configs, and test runs:

- **Repository & Build Health**:
  - `103` files under `src/`; `package.json` (`0.0.0`, `"deploy": "gh-pages -d dist"`, `gh-pages` devDependency, `bun.lock` present); `vite.config.ts` (clean `VitePWA` `generateSW` with `registerType: 'autoUpdate'`, no `copy-unbundled-src-assets` hook).
  - Baseline verification recorded on `3f4b0c7`: `114/114` passing unit tests across `20` test files in `"test"` (`studyCoach.test.ts` omitted from default `package.json` `"test"` script), `tsc --noEmit` clean (`0` errors), `eslint firestore.rules` (`0` errors), `vite build` passes cleanly (`dist/index-C0x-9j0v.js` ~1.34 MB, `AdminControlCenter` chunk ~737 KB, `[INEFFECTIVE_DYNAMIC_IMPORT]` on `RulesGuideModal.tsx`).
- **Absence of the 9 Missing Files in `/app/applet`**:
  - Confirmed 0 files exist at `src/components/AdminUserManagementTab.tsx`, `src/context/ConfigContext.tsx`, `src/context/LiveDataContext.tsx`, `src/hooks/useLiveDataSync.ts`, `src/utils/cloudFirstSync.ts`, `src/utils/platformConfig.ts`, `src/components/LiveCodeEditorPanel.tsx`, `src/utils/githubCodeEditor.ts`, or `src/components/DynamicSettingsManagerPanel.tsx`. Also confirmed `prismjs` is not in `package.json` and `getcgl_github_cms_v1` does not appear anywhere in `src/`.
- **Inlined / Present Implementations in `/app/applet` (22 Phase-A Modules Checked on Current Side)**:
  - `src/App.tsx`: holds `17` root `useState` slices (L134–150), `13` Firestore subscriptions (L326–360), unconditional `bootstrapLocalDbFromIndexedDb()` (L178), and routing (`/`, `/om`, `/dest-simulator`).
  - `src/components/AdminControlCenter.tsx`: implements inline VIP user management (`activeTab === 'cohort'`, L1096–1463), scoring config form (L1584–1714), test composer (L2659–3260), reported queries, support tickets, and cohort backup/restore UI (L1465–1580).
  - `src/lib/firestoreService.ts` & `src/utils/localFallbackStore.ts` & `src/utils/indexedDbStore.ts`: implement cloud-first reads/writes with local fallback (`executeWriteWithLocalFallback` L158–188, `mergeByIdWithTombstones`, `queuePendingSyncOp` capped at `500`, silent `.catch(() => {})` on secondary writes), `getcgl_local_db_v1` in `localStorage`, and `path_to_cgl_idb_v1` (`kv_db`, `offline_test_packs`, `exam_drafts`, `ai_cache`) in `IndexedDB`.
  - Complete feature implementations verified for: Authentication (`AuthGateway.tsx`, `firestoreService.ts`), Student Dashboard (`StudentDashboard.tsx` 2,547 lines + subpanels), Exam Engine (`TcsIonTestEngine.tsx` 2,527 lines, `tier1Engine.ts`, `tier2Engine.ts`, `examEngine.ts`), Question Banks (`120` starter questions, `22` starter tests, `26` GK entries, bulk/override tools), PDF Import (`AdminPdfIngestor.tsx`, `PdfQuestionExtractor.tsx`), AI Integration (`aiClient.ts` 1,746 lines, `AiKeySettingsModal.tsx`, `FloatingSupportChatWidget.tsx`), PWA (`vite-plugin-pwa`, `OfflineIndicator.tsx`, `PWAInstallButton.tsx`), Git Reports (`GitReportsSyncCard.tsx`, `reports/*`), Backup/Restore (`adminCommandCenter.ts`, `localFallbackStore.ts`), DEST Simulator (`DestComputerSimulator.tsx` Module A + `destSimulator.ts`), and Computer Knowledge Simulator (`DestComputerSimulator.tsx` Module B, `20` Qs, `15m`).
- **Account Data & P0 Security Findings (Verified Directly)**:
  - **Damini (`damini_01`)**: `reports/students/damini_01.json` & `damini_888.json` prove `damini_01` is the canonical stable UID and `damini_888` is the updated `loginId` (renamed from `damini_01`). `BLOCKED_DUMMY_UIDS` in `sessionAndOverrides.ts` (L19–22), `AdminControlCenter.tsx` (L88–91), `firestoreService.ts` (L231–233), and `StudentDashboard.tsx` currently blocks both `damini_01` and `demo_123`.
  - **Demo (`demo_123`)**: `reports/students/demo_123.json` proves canonical `uid = "demo_123"`, `loginId = "demo@123"`.
  - **All 5 P0 Security Defects**: Zero `firebase/auth` imports; client-side SHA-256 auth (`sankalp_admin_v1:`, `sankalp_vip_v1:`); open `firestore.rules` without `request.auth`; plaintext `currentPassword` stored/displayed/written; `exportLocalCohortSnapshot()` / `buildScopedDataExport()` exporting credentials & hashes. `verifyStudentLogin()` authenticates via **`invite.passwordHash`** only (never `currentPassword`).

### 3.2 Items Still Requiring the Original `path-to-cgl.zip` Archive
The following items **cannot be verified** from `/app/applet` alone and must wait for direct inspection of original source code:

1. **Exact Source Code, Props, & Edge Cases of the 9 Absent Files**:
   - `src/components/AdminUserManagementTab.tsx` (and `buildAdminUserManagementRows` if present in `adminCommandCenter.ts`)
   - `src/context/ConfigContext.tsx`
   - `src/context/LiveDataContext.tsx`
   - `src/hooks/useLiveDataSync.ts`
   - `src/utils/cloudFirstSync.ts` (+ its unit tests)
   - `src/utils/platformConfig.ts`
   - `src/components/LiveCodeEditorPanel.tsx`
   - `src/utils/githubCodeEditor.ts` (+ its unit tests)
   - `src/components/DynamicSettingsManagerPanel.tsx`
2. **True Diff of Shared Modules**:
   - Whether `App.tsx`, `AdminControlCenter.tsx`, `firestoreService.ts`, `indexedDbStore.ts`, `localFallbackStore.ts`, `TcsIonTestEngine.tsx`, `DestComputerSimulator.tsx`, `StudentDashboard.tsx`, `aiClient.ts`, `firestore.rules`, `package.json`, and `vite.config.ts` in the original ZIP contain any subtle UI controls, validation checks, schema fields, security rules, or unit tests that were lost, altered, or superseded in `koshtI-JI/SSC-CGL`.
3. **ZIP Package / Build / Asset Parity**:
   - Exact original `package.json` dependency versions (including `prismjs` or any other packages absent from `/app/applet`), original `vite.config.ts`, complete `src/` + test file inventory (e.g., whether there were `24` test files vs `21` here), and any `reports/` or `public/` differences.

---

## 4. Exact Source Material Needed to Unblock Phase A

To execute **Phase A — Direct Source Comparison** safely and honestly, please provide **one** of the following:

1. **Preferred**: Upload **`path-to-cgl.zip`** (the complete original ZIP archive) to the workspace or uploaded assets so we can:
   - Verify ZIP integrity and record its **SHA-256 checksum**.
   - Extract it into an isolated `/tmp/path-to-cgl-original/` directory outside the Git repository.
   - Generate its full file inventory (`src/`, tests, `package.json`, configs, `reports/`) and run an exact diff against `/app/applet` across all 22 modules without touching `/app/applet`.
2. **Alternative (if the full ZIP cannot be uploaded)**: Upload an archive or extracted files containing at minimum:
   - The 9 files missing from `/app/applet` (`AdminUserManagementTab.tsx`, `ConfigContext.tsx`, `LiveDataContext.tsx`, `useLiveDataSync.ts`, `cloudFirstSync.ts`, `platformConfig.ts`, `LiveCodeEditorPanel.tsx`, `githubCodeEditor.ts`, `DynamicSettingsManagerPanel.tsx`) + their unit test files.
   - Original `package.json`, `vite.config.ts`, `firestore.rules`, `src/App.tsx`, `src/lib/firestoreService.ts`, `src/utils/adminCommandCenter.ts`, `src/utils/indexedDbStore.ts`, `src/utils/localFallbackStore.ts`, `src/components/AdminControlCenter.tsx`, and `src/components/StudentDashboard.tsx`.
3. **Fallback Decision (if the original ZIP is permanently unavailable)**: Explicitly instruct whether to treat `/app/applet` (`koshtI-JI/SSC-CGL`) as the sole verified source baseline and reconstruct the missing modular boundaries (`ConfigContext`, `LiveDataContext`, `useLiveDataSync`, `cloudFirstSync`, `platformConfig`, `AdminUserManagementTab`, `DynamicSettingsManagerPanel`, `LiveCodeEditorPanel`/`githubCodeEditor`) from engineering specifications prior to Phase 2.
