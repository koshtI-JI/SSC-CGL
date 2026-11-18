# Data Flow Map — Path to CGL (`koshtI-JI/SSC-CGL`)

> **Scope**: Complete inventory of Firestore collections, browser `localStorage`/`sessionStorage`/IndexedDB keys, offline/sync flows, and `reports/` snapshots verified from source code.

---

## 1. Firebase Target (`firebase-applet-config.json`)

- **Project ID**: `total-reflector-plkqp`
- **Firestore Database ID**: `ai-studio-b4ce5a3e-d757-414c-a8c3-2f1ce12c647c`
- **Auth Domain**: `total-reflector-plkqp.firebaseapp.com`
- **SDK Initialization**: `src/lib/firebase.ts` initializes `getFirestore(app, firebaseConfig.firestoreDatabaseId)` only. **No Firebase Auth session is created.**

---

## 2. Cloud Firestore Collections & Subcollections (`firestore.rules` + `firebase-blueprint.json`)

| Collection / Subcollection | Rule Summary (`firestore.rules`) | Deletion Policy | Primary Readers / Writers (`firestoreService.ts`) |
| :--- | :--- | :--- | :--- |
| `/settings/{settingId}` (`scoring`, `adminCredentials`) | `get`/`list`/`create`/`update` schema-validated; **no `request.auth`** | `delete: false` | `App.tsx`, `AuthGateway`, `AdminControlCenter`, `firestoreService.ts` |
| `/vipInvites/{inviteKey}` | Open schema-validated CRUD incl. `currentPassword` (plaintext) | `delete: isValidId` | `AuthGateway`, `AdminControlCenter`, `firestoreService.ts` |
| `/students/{studentUid}` | Open schema-validated `get`/`list`/`create`/`update`; **no `request.auth`** | `delete: false` | `App.tsx`, `verifyStudentLogin`, `updateVipUser`, `StudentDashboard`, `AdminControlCenter`, `AdminCohortProgressSection` |
| `/students/{uid}/revisionVault/{questionId}` | Schema-validated + parent `students/{uid}` exists on create | `delete: isValidId` | `RevisionVault.tsx`, `submitTestAttempt` |
| `/students/{uid}/testDrafts/{testId}` | Schema-validated + parent `students/{uid}` exists on create | `delete: isValidId` | `TcsIonTestEngine.tsx`, `firestoreService.ts` (`saveTestDraft`, `loadTestDraft`, `deleteTestDraft`) |
| `/progressBackups/{backupId}` | Open schema-validated `get`/`list`/`create`/`update` | `delete: false` | `syncProgressBackupSnapshot`, `AdminControlCenter` (`importLocalCohortSnapshot`) |
| `/leaderboard/{studentUid}` | Open schema-validated CRUD | `delete: isValidId` | `App.tsx`, `LeaderboardPanel.tsx`, `submitTestAttempt`, `adjustStudentXp`, `deleteVipInvite` |
| `/questions/{questionId}` | Open schema-validated CRUD | `delete: isValidId` | `App.tsx`, `AdminPdfIngestor`, `PdfQuestionExtractor`, `WipeQuestionsModal` |
| `/tests/{testId}` | Open schema-validated CRUD | `delete: isValidId` | `App.tsx`, `CustomMockBuilderModal`, `StudentDashboard`, `AdminControlCenter` |
| `/attempts/{attemptId}` | Open schema-validated `create`/`update`; checks parent test exists on create | `delete: false` | `App.tsx`, `submitTestAttempt`, `CompletedTestsPanel`, `PendingTestsPanel` |
| `/attempts/{attemptId}/responses/{questionId}` | Schema-validated; checks `existsAfter` parent attempt on create | `delete: false` | `submitTestAttempt` |
| `/tasks/{taskId}` | Open schema-validated CRUD | `delete: isValidId` | `App.tsx`, `AdminControlCenter`, `StudentDashboard` |
| `/xpLedger/{entryId}` | Open schema-validated `create` | `update, delete: false` | `App.tsx`, `submitTestAttempt`, `adjustStudentXp`, `recordTaskCompletion` |
| `/presence/{studentUid}` | Open schema-validated CRUD (incl. `snapshotDataUrl` up to 900KB) | `delete: isValidId` | `useStudentProctorPublisher.ts`, `AdminLiveProctorPanel.tsx` |
| `/proctorRooms/{studentUid}` & `/candidates/{candId}` | Open schema-validated CRUD (WebRTC SDP + ICE candidates) | `delete: isValidId` | `useStudentProctorPublisher.ts`, `AdminLiveProctorPanel.tsx` |
| `/sessionLogs/{sessionId}` | Open schema-validated CRUD | `delete: isValidId` | `useStudentActivityTracker.ts`, `AdminCohortProgressSection.tsx` |
| `/supportTickets/{ticketId}` | Open schema-validated CRUD | `delete: isValidId` | `FloatingSupportChatWidget.tsx`, `AdminControlCenter.tsx`, `NotificationBell.tsx` |
| `/reportedQueries/{reportId}` | Open schema-validated CRUD | `delete: isValidId` | `ReportQuestionModal.tsx`, `AdminControlCenter.tsx` |
| `/corrected_questions_bank/{questionId}` | Open schema-validated CRUD | `delete: isValidId` | `App.tsx`, `AdminControlCenter.tsx`, `applyQuestionOverrides()` |

---

## 3. Browser Storage Keys

### `sessionStorage`
- `getcgl_session_v1` (`src/App.tsx:109`): Serialized `{ role: 'admin' | 'student', adminId?, adminDisplayName?, student? }`. **Not signed or backed by Firebase Auth.**

### `localStorage` Keys
| Key / Pattern | Owner File | Purpose / Risk |
| :--- | :--- | :--- |
| `getcgl_local_db_v1` | `src/utils/localFallbackStore.ts` | Full mirrored cohort snapshot (`adminCredentials`, `vipInvites` w/ hashes & plaintext `currentPassword`, `students`, `leaderboard`, `questions`, `tests`, `attempts`, `tasks`, `xpLedger`, `pendingSyncOps[]` capped at 500, `tombstones` capped at 500). |
| `getcgl_exam_draft_${uid}_${testId}` & `sankalp_exam_draft_${uid}_${testId}` | `TcsIonTestEngine.tsx`, `firestoreService.ts` | Zero-loss live test draft autosave & legacy migration key. |
| `getcgl_active_exam_v1_${uid}` & `sankalp_active_exam_v1_${uid}` | `App.tsx` | Active exam resume pointer cleared on logout/completion. |
| `getcgl_progress_backup_${uid}` | `firestoreService.ts:4547` | Local mirror of `ProgressBackupDoc` (note `deleteVipInvite` clears `${uid}` key, though legacy keys under renamed IDs are not guaranteed cleaned). |
| `getcgl_daily_suite_done_${uid}_${dateKey}` | `firestoreService.ts:4244` | Daily 4-subject mini-suite completion marker. |
| `getcgl_daily_goal_${uid}` | `StudentDashboard.tsx:201` | Student daily question goal count. |
| `getcgl_popup_quiz_state_v1_${uid}` | `StudentDashboard.tsx` | Scratch-card / popup reward quiz cooldown state. |
| `getcgl_rank_tier_${uid}` / legacy key | `StudentDashboard.tsx:502` | Rank tier celebration dedup tracker. |
| `getcgl_mistake_tags_v1_${uid}` | `RevisionVault.tsx:139` | Student's custom mistake category tags. |
| `getcgl_cam_consent_v1_${uid}` | `useStudentProctorPublisher.ts:21` | Per-UID webcam consent flag. |
| `getcgl_runtime_groq_key_v1` & `getcgl_runtime_ai_config_v1` | `src/lib/aiClient.ts:78-79` | Browser-persisted AI API key & provider URL/model in plaintext `localStorage`. |
| `getcgl_ai_cache_v1` | `src/lib/aiClient.ts:77` | Cached AI explanations, formulas, and translations (max 100 entries). |
| `getcgl_ssc_updates_cache_v1` | `src/lib/aiClient.ts:1338` | Cached SSC exam notices/updates. |
| `getcgl_firestore_quota_v1` | `src/utils/firestoreQuota.ts:4` | 30-minute Firestore quota exceeded circuit-breaker timestamp. |
| `getcgl_theme_v1` | `index.html`, `src/hooks/useTheme.ts:5` | Light/dark matte UI preference. |
| `getcgl_notif_seen_v1` | `src/components/NotificationBell.tsx:42` | Seen notification IDs (capped at 120). |
| `getcgl_saved_ai_formulas_v1` | `src/components/StudyFormulaBoosterModal.tsx:26` | Saved AI formula pocket cards. |
| `sankalp_cgl_session_v1` | `src/App.tsx:110` | Legacy session key cleaned out from `localStorage` on boot. |

### IndexedDB (`src/utils/indexedDbStore.ts`)
- **Database**: `path_to_cgl_idb_v1` (`version: 1`)
- **Object Stores**:
  1. `kv_db`: Mirrors `getcgl_local_db_v1` (`idbKey: 'main_local_db'`) via `bootstrapLocalDbFromIndexedDb()` unconditionally on `App` mount and `writeLocalDb()`.
  2. `offline_test_packs`: Pre-bundled test + question payloads for offline play.
  3. `exam_drafts`: Durable `TestDraftDoc` fallback keyed by `${uid}::${testId}`.
  4. `ai_cache`: Auxiliary AI cache store.

---

## 4. Runtime Sync & Offline Queue Flow

```
UI Mutation (Login / Profile / Test Submit / Admin Roster)
  │
  ├──► 1. Immediate Local Write (`writeLocalDb` -> `localStorage` + `IndexedDB kv_db`)
  │
  └──► 2. Cloud Write (`raceWithWriteTimeout(..., 2500ms)`)
         ├── Success ──► Firestore `onSnapshot` listeners push merged state to `App.tsx`
         ├── `resource-exhausted` ──► Sets `getcgl_firestore_quota_v1` (30m cooldown) + enqueues `pendingSyncOps`
         └── Timeout / Offline / Error ──► Enqueues `pendingSyncOps` (or `.catch(() => {})` swallows secondary writes!)
```

### Verified Sync & Integrity Hazards
1. **Secondary write error swallowing**: `verifyStudentLogin()` (L472/485), `updateStudentOwnProfile()` (L732/741), `updateStudentGamificationState()` (L835/842), and `updateVipUser()` (L1312–1329) swallow student/leaderboard/backup/sessionLog/attempt propagation failures with `.catch(() => {})`.
2. **Silent queue truncation**: `localFallbackStore.ts` slices `pendingSyncOps` (L342) and `tombstones` (L348) to `-500`, and `writeLocalDb` prunes `sessionLogs` to 25 (L247–256) on quota errors.
3. **Non-recoverable outbox drop**: `syncPendingLocalOpsToCloud()` (`firestoreService.ts:5110-5113`) permanently removes queued ops on non-recoverable errors without alerting the user.
4. **Asymmetric deletion**: `deleteVipInvite()` removes `/vipInvites/{key}` and tombstones locally, but `firestore.rules` sets `allow delete: if false` on `students`, `attempts`, `xpLedger`, and `progressBackups`.

---

## 5. `reports/` Snapshot Audit (`reports/cohort_summary.*`, `reports/students/*`, `reports/backups/*`)

Committed static JSON & Markdown cohort backups inside `reports/` (not in `.gitignore`):
- `damini_01.json` (exported `2026-04-12T07:29:14Z`): `uid: "damini_01"`, `loginId: "damini_01"`, `displayName: "Damini"`, `slotNumber: 1`, `totalXp: 502`, `testsAttempted: 6`, `attemptsHistory` length `6`.
- `damini_888.json` (exported `2026-04-12T16:43:39Z`): `uid: "damini_01"`, `loginId: "damini_888"`, `displayName: "Damini"`, `slotNumber: 1`, `totalXp: 530`, `testsAttempted: 7`, `attemptsHistory` length `7`.
- `demo_123.json` (exported `2026-04-12T17:19:53Z`): `uid: "demo_123"`, `loginId: "demo@123"`, `displayName: "Demo"`, `slotNumber: 1`, `totalXp: 42`, `testsAttempted: 3`, `attemptsHistory` length `3`.
- `admin.json`: `uid: "admin_preview"`, `totalXp: 0`, `testsAttempted: 0`.
- `cohort_summary.json`: Combined snapshot showing **4 files** with `slotNumber: 1` shared by `damini_01`, `demo_123`, and `admin_preview`. Notice `damini_01` vs `damini_888` represents **one user (`uid: damini_01`) after a `loginId` rename to `damini_888`**, yet `damini_01` and `demo_123` are currently **hard-blocked** from Admin views by `BLOCKED_DUMMY_UIDS`.
