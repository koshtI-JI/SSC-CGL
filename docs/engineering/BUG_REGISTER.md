# Bug Register — Path to CGL (`koshtI-JI/SSC-CGL`)

> Reconciled register of all defects verified directly in this workspace (`repair/path-to-cgl` baseline `3f4b0c7`). Target Phases follow `PathToCGL_Master_Repair_Plan_b41b4299.txt`.

---

## Summary by Severity

| Severity | Count | Key Themes |
| :--- | :---: | :--- |
| **P0 (Critical Security / Integrity)** | 4 | No Firebase Auth; open `firestore.rules`; plaintext `currentPassword` in DB/UI; unauthenticated backup export/import overwriting credentials |
| **P1 (High Functional / Data Loss)** | 10 | Real users (`damini_01`, `damini_888`, `demo_123`) hard-blocked; naive student-overwrites-invite roster merge; swallowed multi-doc write failures; outbox op drops; stale reports committed in repo; exam double-submit / interval drift; `/dest-simulator` auth gate; build base path vs `package.json` homepage |
| **P2 (Medium Quality / Performance)** | 6 | 1.34 MB entry chunk + 737 KB admin chunk; ineffective dynamic import on `RulesGuideModal`; PWA `autoUpdate` mid-exam & missing `.jpg` precache; stale `README`/`SYSTEM_BLUEPRINT` docs; `studyCoach.test.ts` omitted from `npm test` |
| **Plan N/A (Absent in This Repo)** | 3 | `githubCodeEditor.ts` / `getcgl_github_cms_v1` PAT CMS, `src/context/useLiveDataSync.ts`, and `cloudFirstSync.ts` do not exist in this `koshtI-JI/SSC-CGL` checkout |

---

## Verified Bug Register

### P0 — Critical Security & Access Control

1. **`BUG-P0-01`: Zero Firebase Authentication Integration**
   - **Files**: `src/lib/firebase.ts`, `src/lib/firestoreService.ts` (L304–523), `src/App.tsx` (L109, L436–455)
   - **Evidence**: `firebase/auth` is never imported. Login hashes `sankalp_admin_v1:${password}` and `sankalp_vip_v1:${password}` via WebCrypto SHA-256 on the client against readable Firestore documents and stores an unsigned JSON object in `sessionStorage` (`getcgl_session_v1`).
   - **Target Phase**: Phase 3 (Auth & Session Hardening).

2. **`BUG-P0-02`: `firestore.rules` Enforces Schema Only — Zero `request.auth`, Ownership, or Role Checks**
   - **Files**: `firestore.rules` (L527–794) vs `security_spec.md`
   - **Evidence**: Every active collection (`settings`, `vipInvites`, `students`, `attempts`, `xpLedger`, `corrected_questions_bank`, `reportedQueries`, `proctorRooms`, etc.) permits unauthenticated `get`/`list`/`create`/`update` whenever field schemas pass `isValid*()`. Any client can read `/settings/adminCredentials` or overwrite `/vipInvites` and `/leaderboard`.
   - **Target Phase**: Phase 3 (with Firebase Auth / Custom Claims or Firestore Auth token model + emulator tests).

3. **`BUG-P0-03`: Plaintext `currentPassword` Stored in Firestore, `localStorage`, and Rendered in Admin UI**
   - **Files**: `src/types/exam.ts` (L34), `firestore.rules` (L51, L58), `src/lib/firestoreService.ts` (L1066, L1085, L1178, L1256, L1271, L1305, L4828), `src/components/AdminControlCenter.tsx` (L1203–1347)
   - **Evidence**: `VipInvite.currentPassword` is persisted unencrypted in `/vipInvites/{key}`, mirrored to `localStorage` (`getcgl_local_db_v1`) and IndexedDB, and rendered with reveal/copy buttons in the Admin VIP Cohort table.
   - **Target Phase**: Phase 3.

4. **`BUG-P0-04`: Backup Export Leaks Credentials & Import Blindly Overwrites Auth Records**
   - **Files**: `src/utils/localFallbackStore.ts` (`exportLocalCohortSnapshot` L457–467, `importLocalCohortSnapshot` L469–528), `src/components/AdminControlCenter.tsx`
   - **Evidence**: Cohort JSON backup exports raw `adminCredentials` and `vipInvites` (`passwordHash`, `currentPassword`), and restore overwrites local auth slots without stripping secrets or offering dry-run diff/confirmation. Also `VITE_*` / browser-stored AI keys in `src/lib/aiClient.ts` (`getcgl_runtime_groq_key_v1`) are readable from JS `localStorage`.
   - **Target Phase**: Phase 3 / Phase 4.

---

### P1 — High-Impact Functional & Data Integrity Bugs

5. **`BUG-P1-01`: Active Real Users Hard-Blocked by `BLOCKED_DUMMY_UIDS` & Empty Set Edge Case**
   - **Files**: `src/utils/sessionAndOverrides.ts` (L19–62), `src/utils/sessionAndOverrides.test.ts` (L52–70), plus callers in `AdminControlCenter.tsx`, `AdminCohortProgressSection.tsx`, `AdminLiveProctorPanel.tsx`, `firestoreService.ts`, `useStudentActivityTracker.ts`, `useStudentProctorPublisher.ts`
   - **Evidence**: `BLOCKED_DUMMY_UIDS` contains `'damini_01'`, `'damini_888'`, and `'demo_123'`, hiding real cohort progress (`reports/students/damini_888.json` = 530 XP / 7 tests; `demo_123.json` = 42 XP / 3 tests). Additionally, `isRealCohortStudentUid()` line 59 skips whitelist check when `allowedUids.size === 0`.
   - **Target Phase**: **Phase 2**.

6. **`BUG-P1-02`: Naive Roster Merge Precedence & Inconsistent Identity Sources Across Admin Panels**
   - **Files**: `src/components/AdminCohortProgressSection.tsx` (L99–123), `src/components/AdminControlCenter.tsx` (L1280–1463), `src/components/AdminLiveProctorPanel.tsx` (L261–293), `src/lib/firestoreService.ts` (`verifyStudentLogin` L435–448)
   - **Evidence**: `AdminCohortProgressSection.cohortCandidates` seeds from `realInvites` then unconditionally overwrites each `uid` entry with `realStudents` regardless of timestamp; `AdminControlCenter` renders `realInvites` separately; `verifyStudentLogin` prefers stale `effectiveProfileBase.displayName` over updated invite metadata and compares heterogeneous `updatedAt` timestamps (`extractCreatedOrUpdatedMs`). `reports/students/*.json` all show `slotNumber: 1`.
   - **Target Phase**: **Phase 2** (canonical pure roster merge helper in `adminCommandCenter.ts` + caller alignment).

7. **`BUG-P1-03`: Secondary Cloud Writes Swallowed with `.catch(() => {})`**
   - **Files**: `src/lib/firestoreService.ts` (L472, L485, L732, L741, L835, L842, L1312–1329)
   - **Evidence**: Updating an invite (`updateVipUser`), login profile sync (`verifyStudentLogin`), student profile (`updateStudentOwnProfile`), or XP state swallows errors on `students`, `leaderboard`, `progressBackups`, `attempts`, and `sessionLogs`, causing cross-collection drift.
   - **Target Phase**: Phase 4.

8. **`BUG-P1-04`: Silent Queue Truncation & Dropping of Failed Cloud Sync Ops**
   - **Files**: `src/utils/localFallbackStore.ts` (L247–256, L342, L348), `src/lib/firestoreService.ts` (L5110–5113)
   - **Evidence**: `pendingSyncOps` & `tombstones` silently truncate to 500 entries; quota errors prune `sessionLogs` to 25; `syncPendingLocalOpsToCloud()` drops ops on non-recoverable errors without surfaced diagnostics or dead-letter queue.
   - **Target Phase**: Phase 4.

9. **`BUG-P1-05`: Asymmetric Invite Deletion vs `allow delete: if false` Collections**
   - **Files**: `src/lib/firestoreService.ts` (`deleteVipInvite` L1337–1353), `firestore.rules` (L565, L615, L671, L707)
   - **Evidence**: Deleting an invite removes `/vipInvites/{key}`, `/leaderboard/{uid}`, and local records, while remote `/students`, `/attempts`, `/xpLedger`, and `/progressBackups` disallow delete (`if false`). Re-inviting/tombstoning leaves orphaned analytics or inconsistent state unless explicitly soft-archived.
   - **Target Phase**: Phase 4.

10. **`BUG-P1-06`: No Synchronous Submission Mutex or Idempotency Key in `TcsIonTestEngine.tsx`**
    - **Files**: `src/components/TcsIonTestEngine.tsx` (L546, L877–918), `src/lib/firestoreService.ts` (`submitTestAttempt`)
    - **Evidence**: `handleConfirmSubmit()` guards via async React `submitting` state; rapid double-clicks or auto-submit timeout race (`L546`) can trigger duplicate `makeId('att')` submissions and duplicate XP ledger credits.
    - **Target Phase**: Phase 5.

11. **`BUG-P1-07`: Exam Timer Drift via 1s `setInterval` Decrement & `lang: 'en'` Hardcoded in Drafts**
    - **Files**: `src/components/TcsIonTestEngine.tsx` (L270, L291, L496–542)
    - **Evidence**: Timer decrements `prev - 1` inside `setInterval(1000)` instead of deadline timestamps (`endAtMs - Date.now()`), drifting on backgrounded mobile/browser tabs. Draft saves also hardcode `lang: 'en'` while UI always stacks EN+HI without a language toggle.
    - **Target Phase**: Phase 5.

12. **`BUG-P1-08`: `/dest-simulator` Route Blocked Behind `AuthGateway` When Logged Out**
    - **Files**: `src/App.tsx` (L1029–1056)
    - **Evidence**: Navigating directly to `/dest-simulator` while unauthenticated renders `<AuthGateway />` rather than standalone `DestComputerSimulator` (or explicit guard feedback).
    - **Target Phase**: Phase 5.

13. **`BUG-P1-09`: `reports/` Student Snapshots Not Gitignored & `BASE_PATH` Deployment Mismatch**
    - **Files**: `.gitignore`, `reports/`, `package.json` (`homepage` & `deploy`), `vite.config.ts` (`base`)
    - **Evidence**: `reports/` contains cohort student data snapshots tracked in git. Meanwhile `package.json` sets `"homepage": "https://koshti-ji.github.io/SSC-CGL/"` and `"deploy": "gh-pages -d dist"`, while `vite.config.ts` defaults `base` to `'/'` unless `BASE_PATH=/SSC-CGL/` is supplied.
    - **Target Phase**: Phase 4 / Phase 7.

14. **`BUG-P1-10`: `studyCoach.test.ts` Omitted from `npm test` Script**
    - **Files**: `package.json` (L19), `src/utils/studyCoach.test.ts` (7 passing tests)
    - **Evidence**: `npm test` lists 20 explicit test file arguments instead of discovering all 21 `*.test.ts` files, leaving `studyCoach.ts` untested in CI/default runs.
    - **Target Phase**: Phase 7 (or Phase 6 verification tooling).

---

### P2 — Performance, PWA, & Documentation Drift

15. **`BUG-P2-01`: Oversized JS Chunks (`index-*.js` 1.34 MB, `AdminControlCenter-*.js` 737 KB)**
    - **Files**: `src/App.tsx`, `src/components/FloatingSupportChatWidget.tsx`, `src/components/AdminControlCenter.tsx`
    - **Evidence**: `index-*.js` (`1,342.51 kB`, gzip `390.48 kB`) eagerly bundles Firebase, starter banks, `FloatingSupportChatWidget` (`aiClient`), and `RulesGuideModal`. `AdminControlCenter-*.js` (`736.75 kB`) triggers Vite's `> 500 kB` chunk warning.
    - **Target Phase**: Phase 6.

16. **`BUG-P2-02`: `[INEFFECTIVE_DYNAMIC_IMPORT]` on `RulesGuideModal.tsx`**
    - **Files**: `src/App.tsx` + `src/components/AuthGateway.tsx`
    - **Evidence**: Lazy import in `App.tsx` is negated by static import in `AuthGateway.tsx`.
    - **Target Phase**: Phase 6.

17. **`BUG-P2-03`: PWA `registerType: 'autoUpdate'` & Missing `.jpg` Precache**
    - **Files**: `vite.config.ts` (L18, L68–70)
    - **Evidence**: `autoUpdate` can activate a new SW mid-exam; `globPatterns` omits `.jpg` so `hero_cgl_arena_1794665281724` (`719.80 kB`) is excluded from offline precache; `public/assets/aistudio/` attachment files would also copy into `dist/` unless excluded or removed later.
    - **Target Phase**: Phase 6.

18. **`BUG-P2-04`: Stale Documentation (`README.md`, `SYSTEM_BLUEPRINT.md`)**
    - **Files**: `README.md` (L51, L139, L155), `SYSTEM_BLUEPRINT.md` (L42, L120)
    - **Evidence**: Documents outdated test counts (15 suites / 80 tests vs 21 files / 114 tests), incorrect IndexedDB store names, and non-existent `EN / हिंदी` live toggle in `TcsIonTestEngine.tsx`.
    - **Target Phase**: Phase 7.
