# Updated Phase 2 Implementation Plan — Account Identity, Roster Reconciliation & Credential Containment

> **Scope**: Corrected Phase 2 plan tailored strictly to the verified `koshtI-JI/SSC-CGL` workspace (`/app/applet`) and aligned with Tasks 4 & 5 of the Pre-Phase-2 Verification Review.  
> **Prerequisite**: Owner approval before modifying any file in `src/`.  
> **Explicit Boundaries**: No Firebase Authentication migration, no `firestore.rules` deployment, no edits to `reports/` snapshots, and no automated mutation of live production Firestore records occur in Phase 2.

---

## 1. Non-Negotiable Architectural Invariants (Task 4)

Every code change in Phase 2 MUST satisfy all eight verified invariants:

1. **Immutable `uid` Across Username Changes**: A student's canonical `uid` (e.g., `damini_01`, `demo_123`) is permanently bound to the document key in `vipInvites/{uid}`, `students/{uid}`, `leaderboard/{uid}`, `attempts`, `xpLedger`, `revisionVault`, `sessionLogs`, and `progressBackups`. Changing `loginId` (e.g., `damini_01` $\rightarrow$ `damini_888`) updates **only** the mutable `loginId` attribute and never moves, rekeys, or forks historical records.
2. **Strict Separation of `uid` vs. `loginId`**: Authentication/login lookup resolves normalized `loginId` $\rightarrow$ canonical `uid`. All joins across `vipInvites`, `students`, `leaderboard`, `proctorPresence`, `attempts`, `xpLedger`, `sessionLogs`, and `revisionVault` match strictly on **`uid` (`invite.id === student.uid`)**, never on `loginId`. New accounts created by `createNewVipUser()` receive a generated immutable `uid` (`usr_<timestamp>_<rand>`) instead of `loginIdToKey(loginId)`, while enforcing normalized-login uniqueness against both exact `loginId` and normalized `loginIdToKey` collisions.
3. **Single Canonical Account Per `uid`**: Damini (`uid: "damini_01"`, current `loginId: "damini_888"`) and Demo (`uid: "demo_123"`, `loginId: "demo@123"`) each appear **exactly once** across Admin VIP Roster, Cohort Progress, Leaderboard, Proctoring, and Analytics. System placeholders (`admin_preview`, `dummy_student`, `test_dummy`) remain strictly excluded.
4. **Preservation of All Historical Snapshots**: `reports/students/damini_01.json`, `reports/students/damini_888.json`, `reports/students/demo_123.json`, `reports/students/admin.json`, `reports/backups/*`, `attempts`, `xpLedger`, `revisionVault`, and `sessionLogs` remain intact and unmerged. Damini's `502 XP / 6 tests` (`damini_01.json`) and `530 XP / 7 tests` (`damini_888.json`) are never added together.
5. **Read-Only Archive / Backup Policy**: Files under `reports/` are treated as point-in-time historical archives. Phase 2 introduces **zero** code paths that auto-restore or overwrite live Firestore student profiles, attempts, or XP from `reports/` or local backups.
6. **Documented Field-Level Source-of-Truth Precedence**: Every shared attribute between `vipInvites` and `students` has an explicit owner and normalized-timestamp rule (Section 2 below), eliminating the blind `map.set(st.uid, st)` overwrite in `AdminCohortProgressSection.tsx` and stale-name persistence in `verifyStudentLogin()` / `AdminLiveProctorPanel.tsx`.
7. **Empty Cohort Configuration $\neq$ Configuration Still Loading**: Cohort eligibility (`isRealCohortStudentUid()` / `filterRealCohortRecords()`) and UI callers explicitly distinguish `cohortConfigState: 'loading' | 'loaded'`:
   - When `cohortConfigState === 'loaded'` and `allowedCohortUids` is an empty `Set`/`[]`, `isRealCohortStudentUid(..., allowedCohortUids, { emptyAllowsAll: false })` **rejects all candidates (`false`)** rather than bypassing the whitelist.
   - When `cohortConfigState === 'loading'` (initial mount before `vipInvites` local/remote snapshot settles), Admin views display an explicit `"Loading VIP cohort..."` state instead of falsely reporting `"0 VIP Student IDs created yet"` or leaking unfiltered records.
8. **Zero Passwords in Administrative Roster Data**: Plaintext passwords (`currentPassword`, `password`) MUST NEVER appear in administrative roster row types (`AdminRosterRow`), table cells, view-models, reveal/copy actions, debug output, or `type="text"` inputs.

---

## 2. Field-Level Source-of-Truth Precedence Matrix

All timestamp comparisons use a single shared normalizer (`normalizeTimestampMs()` handling finite numbers, ISO date strings, and Firestore `{ toMillis() }` / `{ seconds, nanoseconds }` objects — never naive raw comparison).

| Field Group | Authoritative Owner | Secondary Copy / Mirror | Conflict Resolution Precedence Rule |
| :--- | :--- | :--- | :--- |
| **`uid`** (Immutable Account ID) | `vipInvites.id` | `students.uid`, `leaderboard.uid`, `attempts[].uid`, `xpLedger[].uid`, `sessionLogs[].uid`, `presence.uid` | Always `vipInvites.id` (`damini_01`, `demo_123`). Never derived or overwritten from `loginId`. |
| **`loginId`** (Mutable Sign-In Handle) | **`vipInvites.loginId`** | `students.loginId`, `presence.loginId` | **`vipInvites.loginId` always wins** (lowercase trimmed). `verifyStudentLogin()` & roster selectors overwrite stale `students.loginId` if they differ. |
| **`active` & Account Lifecycle** | **`vipInvites.active`** | None | **`vipInvites.active` strictly authoritative**. Revoked users cannot start sessions/tests; historical analytics/reports remain preserved. |
| **`slotNumber`** (`1..5`) | **`vipInvites.slotNumber`** | `students.slotNumber` | **`vipInvites.slotNumber` strictly authoritative**. Existing duplicate `slotNumber: 1` records are flagged via a non-destructive UI warning badge without silent reassignment. |
| **`createdAt`** | **`vipInvites.createdAt`** (earliest valid ms if present) | `students.createdAt` | Read-only display timestamp from `vipInvites.createdAt` (fallback `students.createdAt`, never replaced on edits). |
| **`displayName` & `targetPost`** | **Shared — Latest Normalized `updatedAt` Wins** | `vipInvites` $\leftrightarrow$ `students` $\rightarrow$ `leaderboard` | Compare `normalizeTimestampMs(student.updatedAt)` vs `normalizeTimestampMs(invite.updatedAt)`. If `student.updatedAt > invite.updatedAt`, student's self-edited profile wins; otherwise `invite` (Admin edit) wins. Both docs still sync cleanly on explicit edit actions. |
| **`city`, `targetYear`, `bio`, `avatarDataUrl`, `physicalChecklist`, `syllabusMastery`** | **`students/{uid}`** | `progressBackups/{uid}` | Student-owned fields; Admin invite edits MUST NOT erase or overwrite these fields. |
| **`totalXp`, `testsAttempted`, `bestScore`, `avgAccuracy`, `totalTimeSec`, `attempts`, `xpLedger`, `revisionVault`** | **Append/Computed Activity Stores (`attempts`, `xpLedger`, `sessionLogs`, `leaderboard`)** | `progressBackups/{uid}` | Owned by exam/study ledger; Admin metadata edits (`loginId`, `slotNumber`, `active`) never alter or merge XP/attempts. |

---

## 3. Target Files & Exact Code Changes in `koshtI-JI/SSC-CGL`

Because `AdminUserManagementTab.tsx`, `ConfigContext.tsx`, `LiveDataContext.tsx`, and `platformConfig.ts` do **not** exist in this GitHub checkout, Phase 2 applies cleanly to the actual workspace modules:

### 3.1 Fix Cohort Identity Filter (`src/utils/sessionAndOverrides.ts` & `src/utils/sessionAndOverrides.test.ts`)
- **Replace `BLOCKED_DUMMY_UIDS` (`damini_01`, `damini_888`, `demo_123` removal)**:
  - Rename/narrow to `SYSTEM_PLACEHOLDER_UIDS = new Set(['admin_preview', 'dummy_student', 'test_dummy'])`.
  - Remove `'damini_01'`, `'damini_888'`, and `'demo_123'` from the hardcoded placeholder deny list so Damini (`uid: "damini_01"`) and Demo (`uid: "demo_123"`) are treated as genuine cohort accounts whenever present in `vipInvites` or authenticated sessions.
- **Fix Empty `allowedCohortUids` Semantics**:
  - Update `isRealCohortStudentUid(uid, allowedCohortUids?, options?)`:
    - When `allowedCohortUids` is provided (`!== undefined`), convert to `Set<string>`. **If `set.size === 0` (explicitly loaded empty cohort), return `false`** unless `options?.emptyAllowanceMode === 'allow_unscoped'` is explicitly passed by an internal caller without invite context.
    - Never silently treat an empty `Set` as "allow everyone".
- **Update & Expand Tests (`src/utils/sessionAndOverrides.test.ts`)**:
  - Replace regression expectations (lines 55–57) that expected `'damini_01'`, `'damini_888'`, `'demo_123'` to be `false`.
  - Verify `'damini_01'` and `'demo_123'` pass when in `allowedCohortUids`, while `'admin_preview'`, `'dummy_student'`, `'test_dummy'` remain `false` even if accidentally added to `allowedCohortUids`.
  - Explicitly test `new Set()` returning `false` when `allowedCohortUids` is supplied empty.

### 3.2 Canonical Pure Roster Builder (`src/utils/adminCommandCenter.ts` & `src/utils/adminCommandCenter.test.ts`)
Since `AdminUserManagementTab.tsx` is merged inside `AdminControlCenter.tsx`, introduce pure, unit-tested helpers directly in `src/utils/adminCommandCenter.ts`:
- **`normalizeTimestampMs(raw: unknown): number`**: Safely normalizes numbers, ISO strings, `{ seconds, nanoseconds }`, and `{ toMillis() }` Firestore Timestamps.
- **`CanonicalAdminRosterRow` interface** *(strictly zero `password` / `currentPassword` properties)*:
  - Fields: `uid`, `loginId`, `displayName`, `targetPost`, `slotNumber`, `active`, `createdAtMs`, `updatedAtMs`, `totalXp`, `qualifyingAttempts`, `bestScore`, `avgAccuracy`, `studyTimeSec`, `online`, `presenceStatus`, `hasProfileDoc`.
  - TypeScript guarantee: **no password or passwordHash fields on the roster row type**.
- **`buildCanonicalAdminRosterRows(params)`**:
  - Filters inputs via `SYSTEM_PLACEHOLDER_UIDS` + `allowedCohortUids` (`vipInvites.map(i => i.id)`).
  - Deduplicates strictly by `uid` (`invite.id`).
  - Applies the **Section 2 Field-Level Precedence Matrix** (always `invite.loginId`, `invite.active`, `invite.slotNumber`; latest `normalizeTimestampMs` across `student.updatedAt` vs `invite.updatedAt` for `displayName` and `targetPost`).
  - Preserves existing `damini_01` (showing `loginId: damini_888`) as a single canonical row and `demo_123` (`loginId: demo@123`) as a single canonical row.
  - Emits non-destructive slot-collision diagnostics (`detectDuplicateCohortSlots(rows)`) when multiple active VIP accounts share `#1`.
- **Update All Admin Roster Callers Consistently**:
  - `src/components/AdminControlCenter.tsx`: Replace `realInvites.map(...)` table rows with `buildCanonicalAdminRosterRows(...)`, showing canonical UID badge (`uid: damini_01`), `createdAtMs`, duplicate-slot notice banner if detected, and loading vs empty-cohort state differentiation.
  - `src/components/AdminCohortProgressSection.tsx`: Replace blind `map.set(st.uid, st)` loop (lines 99–123) with shared precedence helper so `loginId` / `slotNumber` / `displayName` / `targetPost` match the Admin roster identically.
  - `src/components/AdminLiveProctorPanel.tsx`: Align `rows` assembly (lines 260–293) with the same precedence helper so `displayName`, `loginId`, and `targetPost` cannot disagree across Admin tabs.

### 3.3 Auth-to-Profile Sync & New Account UID Generation (`src/lib/firestoreService.ts`)
- **`verifyStudentLogin()` (L394–519)**:
  - Keep lookup by normalized `cleanLoginId` against `vipInvites.loginId`, preserving `uid = invite.id` (`damini_01`).
  - Fix profile merge (L434–448): normalize timestamps via shared `normalizeTimestampMs()`, enforce `invite.loginId` & `invite.slotNumber` from `vipInvites`, and select `displayName`/`targetPost` by comparing `invite.updatedAt` vs `student.updatedAt` rather than blindly trusting stale `effectiveProfileBase`.
  - Check `vipInvites` sync errors visibly rather than masking mismatched writes silently (full outbox hardening remains queued for Phase 4).
- **`createNewVipUser()` (L1130–1209)**:
  - Generate an immutable UID (`usr_${Date.now().toString(36)}_${rand}`) instead of deriving permanent doc IDs from mutable `loginIdToKey(cleanLoginId)`.
  - Enforce collision check against both `inv.loginId.toLowerCase() === cleanLoginId` and normalized `loginIdToKey(inv.loginId) === loginIdToKey(cleanLoginId)` to prevent punctuation-ambiguous duplicates (`demo@123` vs `demo_123`).
- **`updateVipUser()` (L1211–1335)**:
  - Preserve `inviteId` unchanged during `loginId` renames (never rekey `damini_01`).
  - Reject normalized punctuation collisions with other `inv.id !== inviteId` accounts.
- **Loading vs Loaded Cohort State (`subscribeVipInvites` / `App.tsx`)**:
  - Add a boolean `invitesLoaded` signal from `subscribeVipInvites` / `App.tsx` (passing `cohortConfigState: 'loading' | 'loaded'` into `AdminControlCenter.tsx`) so `"0 VIP Student IDs created yet"` only displays after initial load completes.

### 3.4 Immediate P0 Credential Exposure Containment (Task 5 Alignment)
To avoid postponing P0 credential fixes indefinitely while respecting the restriction against premature Firebase Auth migration or Firestore rule deploys:
1. **Remove Password Column, Reveal/Copy Buttons & `lastProvisionedCreds` Plaintext Box (`src/components/AdminControlCenter.tsx` L1203–1347)**:
   - Remove the `Current Password` column, eye/reveal button, and copy-stored-password button from the Admin roster table.
   - Change `<input id="vip-password" type="text">` (L1205) to `type="password"` (optionally paired with local show/hide toggle **only** for the unsaved value currently being typed by the admin, never prefilled from stored state).
   - Replace `lastProvisionedCreds` raw-password banner or restrict it strictly to non-persisted ephemeral creation feedback without exposing password values in DOM state/clipboard templates once dismissed (or display non-credential confirmation only).
2. **Stop Writing New Plaintext `currentPassword` Values (`src/lib/firestoreService.ts` & `src/utils/localFallbackStore.ts`)**:
   - Omit `currentPassword` from `createNewVipUser()`, `updateVipUser()`, and `upsertVipInvite()` payloads going forward (keep optional `currentPassword?: string` temporarily tolerated on historical read types / `firestore.rules` untouched until the approved Phase 3 migration + backup executes).
   - Strip `currentPassword` (and `adminCredentials` secrets) from `buildScopedDataExport()` (`src/utils/adminCommandCenter.ts`) so cohort exports cannot leak credentials.
3. **Explicit Deferral Boundary to Approved Phase 3 Plan**:
   - Full **Firebase Authentication** (`firebase/auth`) migration, **`firestore.rules` tightening** (requiring `request.auth != null` + role/UID enforcement + emulator verification), **legacy `vipInvites.currentPassword` & `passwordHash` DB purge**, and a concrete operator-approved password/reset strategy for `damini_888` and `demo@123` (given no email addresses or custom backend exist) will execute **only** under a separately reviewed and approved **Phase 3 Auth & Security Migration Plan**.

---

## 4. Verification & Acceptance Criteria (Before Exiting Phase 2)

1. **Automated Unit Tests (`npm test` + `src/utils/studyCoach.test.ts` — 21 files)**:
   - `isRealCohortStudentUid('damini_01', new Set(['damini_01', 'demo_123'])) === true`
   - `isRealCohortStudentUid('demo_123', new Set(['damini_01', 'demo_123'])) === true`
   - `isRealCohortStudentUid('damini_01', new Set()) === false` (loaded empty cohort never falls back to allow-all)
   - `isRealCohortStudentUid('admin_preview', new Set(['admin_preview'])) === false` (system placeholders always blocked)
   - `buildCanonicalAdminRosterRows()` produces **1 row** for Damini (`uid: 'damini_01'`, `loginId: 'damini_888'`, no `password`/`currentPassword` property), **1 row** for Demo (`uid: 'demo_123'`, `loginId: 'demo@123'`), preserves historical stats, prefers newer invite edits over stale student profiles (and vice versa by normalized timestamp), and reports duplicate `slotNumber: 1` warnings without mutating slots.
   - `buildScopedDataExport()` output contains zero `currentPassword` or `adminCredentials` fields.
2. **Static & Build Checks**:
   - `npm run lint` (`tsc --noEmit`): `0` errors.
   - `npm run build`: clean Vite + Workbox bundle.
   - `grep -rnE "currentPassword|visiblePasswordIds|Show password|Copy password" src/components/ src/utils/adminCommandCenter.ts` confirms zero password UI exposure remains in Admin components/view-models.
3. **Runtime Browser Verification (Dev Preview `http://localhost:3000/#/om` & Student Portal)**:
   - Inspect Admin VIP Roster, Cohort Progress, Leaderboard, and Live Proctor: Damini (`damini_888`, `uid: damini_01`) and Demo (`demo@123`, `uid: demo_123`) appear once each with identical identity metadata and zero plaintext passwords rendered.
   - Rename test login ID in local staging simulation and confirm `uid`, attempts, and XP remain single-account and intact.
   - Verify `reports/` files on disk remain completely untouched (`git diff reports/` empty).
