# Source-of-Truth Foundation Recommendation — Path to CGL

> **Strategy Status**: **Option C (Reconciled Development Baseline)** is **APPROVED AS STRATEGY ONLY**. Execution of Phase 2 has **NOT** started and remains gated on `path-to-cgl.zip` availability (`docs/engineering/ORIGINAL_ZIP_VERIFICATION.md`).  
> **Non-Negotiable Protections**: Zero edits to `src/`, `package.json`, `firestore.rules`, Firebase config, live database, or `reports/`.

---

## 1. Approved Architecture & Role Assignments (Phase B)

Under the approved **Option C — Reconciled Development Baseline**, each source carries a strict, non-overlapping engineering role:

1. **Current GitHub Workspace (`/app/applet` — `koshtI-JI/SSC-CGL` at commit `3f4b0c7`) = Runtime, Build & Deploy Foundation**
   - Keeps verified Firebase target (`total-reflector-plkqp`, Firestore database `ai-studio-b4ce5a3e-d757-414c-a8c3-2f1ce12c647c`).
   - Keeps passing baseline tests (`114/114` across 20 suites in `"test"`, plus `studyCoach.test.ts`), clean `tsc --noEmit`, clean `eslint firestore.rules`, `bun.lock`, `"deploy": "gh-pages -d dist"`, clean `vite.config.ts`, tracked `reports/` snapshots, and all verified working UI/engine modules (`StudentDashboard`, `TcsIonTestEngine`, `DestComputerSimulator`, `AdminPdfIngestor`, `aiClient`, `indexedDbStore`, `localFallbackStore`).
2. **Original Project Archive (`path-to-cgl.zip`, once supplied by owner) = Reference for Original Source Code & Missing/Divergent Features**
   - Authoritative reference for the 9 files absent from `/app/applet` (`AdminUserManagementTab.tsx`, `ConfigContext.tsx`, `LiveDataContext.tsx`, `useLiveDataSync.ts`, `cloudFirstSync.ts`, `platformConfig.ts`, `LiveCodeEditorPanel.tsx`, `githubCodeEditor.ts`, `DynamicSettingsManagerPanel.tsx`) and any subtle diffs in shared files (`App.tsx`, `firestoreService.ts`, `package.json`, `vite.config.ts`, `firestore.rules`).
3. **Reconciled Baseline = Verified Combination of Both**
   - Merges verified missing features/clean module boundaries onto `/app/applet` cleanly **without** losing passing tests, GitHub Pages deploy setup, or Firebase integration, and **without** reintroducing security regressions (e.g., `localStorage` PAT storage or plaintext passwords).

---

## 2. Side-by-Side Comparison of Options A, B, and C

| Evaluation Criterion | Option A (ZIP Only) | Option B (GitHub Only + Patches) | Option C (Reconciled Baseline — **APPROVED**) |
| :--- | :--- | :--- | :--- |
| **Data & Account History Preservation** | Risky (ZIP unavailable here; risks diverging from `reports/` & `firebase-applet-config.json`) | High | **Highest** (preserves verified Firebase DB, `reports/`, and passing baseline tests) |
| **Original Feature Preservation** | High for ZIP modules, loses GitHub deploy tooling (`gh-pages`, `bun.lock`) | Moderate (delayed, bolted onto 3.6k-line monoliths) | **Highest** (retains 100% of verified `/app/applet` + restored ZIP capabilities once Phase A completes) |
| **Code Compatibility & Maintainability** | High initial swap risk without lockfile | Suboptimal (`App.tsx` / `AdminControlCenter.tsx` require double work) | **Highest** (clean context/tab/sync extraction once, prior to major state repairs) |
| **Firebase & Deploy Compatibility** | Missing `gh-pages` script / unverified against current config | Verified (`total-reflector-plkqp`, `gh-pages`, Vite) | **Verified** (`total-reflector-plkqp`, `gh-pages`, `BASE_PATH`) |
| **Current Blocker** | `path-to-cgl.zip` is **not** available in workspace | None for code present, but misses CMS/settings parity | **Blocked at Phase A** until `path-to-cgl.zip` is supplied (or owner authorizes spec-based reconstruction) |

---

## 3. Account Management Safety Rules (Phase C — Mandatory Invariants)

1. **Damini Canonical Identity**:
   - Immutable `uid = "damini_01"` (`reports/students/damini_01.json` & `damini_888.json`).
   - Current `loginId = "damini_888"` (renamed from `damini_01`).
   - **Never** create a second Damini account, **never** change `uid` when `loginId` changes, and **never** merge or sum historical XP (`502` XP / `6` tests in `damini_01.json` vs. `530` XP / `7` tests in `damini_888.json`).
2. **Demo Canonical Identity**:
   - Immutable `uid = "demo_123"`, current `loginId = "demo@123"` (`reports/students/demo_123.json`).
   - Do not derive permanent UIDs from mutable login IDs (`loginIdToKey`).
3. **Roster & Data Safety**:
   - Keep `SYSTEM_PLACEHOLDER_UIDS` (`admin_preview`, `dummy_student`, `test_dummy`) blocked while unblocking `damini_01` and `demo_123`.
   - Render one canonical row per account, keep historical snapshots untouched, never auto-overwrite live records from backup snapshots, and distinguish **loading** from **loaded-empty** cohort state.

---

## 4. Security Posture & Phase 2 Credential Containment Plan (Phase D)

### Active P0 Defects (Unmitigated Until Executed in Approved Phases)
1. **No `firebase/auth` (`BUG-P0-01`)**: `firebase/auth` is absent; sessions rely on `sessionStorage` (`getcgl_session_v1`).
2. **Client-Side Password Verification**: `verifyAdminLogin()` / `verifyStudentLogin()` hash inputs client-side against client-readable Firestore docs.
3. **Open `firestore.rules` Without `request.auth` (`BUG-P0-02`)**: Schema checks only, zero auth/UID/admin checks.
4. **Plaintext `currentPassword` Exposure (`BUG-P0-03`)**: Stored in `vipInvites.currentPassword`, permitted by `firestore.rules` (L51, L58), mirrored in local/IDB storage, and shown in `AdminControlCenter.tsx` (L1203–1347).
5. **Unsafe Credential Exports (`BUG-P0-04`)**: `exportLocalCohortSnapshot()` and `buildScopedDataExport()` emit raw `adminCredentials` and `vipInvites` secrets (`passwordHash`, `currentPassword`), while `importLocalCohortSnapshot()` overwrites auth records blindly.

### Safe Credential Containment Design (Future Phase 2 — Login-Compatible)
Verified directly in `src/lib/firestoreService.ts` (L410–413, L1251–1254):
- `verifyStudentLogin()` checks `sha256Hex('sankalp_vip_v1:' + password)` exclusively against **`invite.passwordHash`** — it **never** reads `currentPassword`.
- `updateVipUser()` preserves `existingData.passwordHash` when password input is left blank.

Therefore, when Phase 2 is authorized:
- **UI**: Remove password column, reveal/copy buttons, and `lastProvisionedCreds` plaintext display from Admin roster UI; use `type="password"`.
- **DTOs**: Strip `password` and `currentPassword` from roster view-models.
- **Writes**: Stop writing `currentPassword` inside `createNewVipUser()`, `updateVipUser()`, and `upsertVipInvite()` while continuing to write `passwordHash` cleanly so `damini_888` and `demo@123` logins stay 100% uninterrupted.
- **Exports**: Strip `adminCredentials`, `passwordHash`, and `currentPassword` from local & scoped exports.
- **Deferred Boundary**: Leave Firebase Auth migration and `firestore.rules` hardening cleanly in **Phase 3** (requires dedicated security design approval, pre-migration backup, and emulator tests first).
