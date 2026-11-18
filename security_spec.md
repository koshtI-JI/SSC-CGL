# Security Specification — Path to CGL Firestore Rules

## 1. Data Invariants
1. **Closed Invite-Only Cohort**: Only the bootstrapped Super Admin, documents in `/admins/{uid}`, and login IDs listed with `active: true` in `/vipInvites/{inviteKey}` may participate in cohort data.
2. **PII Isolation**: Login IDs & credentials live strictly in `/vipInvites`, `/students/{uid}`, and `/settings/adminCredentials`. `/leaderboard/{uid}` contains zero sensitive credentials.
3. **Immutable Ownership & Timestamps**: `uid` / `createdBy` must stay unchanged on update. `createdAt` must equal `request.time` on creation and remain immutable. `updatedAt` must equal `request.time` on updates.
4. **No Self-Assigned Roles**: Students can never write to `/vipInvites`, `/settings`, `/questions`, `/tests`, or `/tasks`.
5. **Relational Sync & Master Gate**: `/attempts/{attemptId}/responses/{questionId}` checks parent `/attempts/{attemptId}` via `existsAfter()`. `/students/{studentUid}/revisionVault/{questionId}` and `/students/{studentUid}/testDrafts/{testId}` require parent `/students/{studentUid}` existence.
6. **Query Enforcer (No Blanket List)**: Every `allow list` validates `resource.data` without `get()`/`exists()` inside `allow list`.
7. **Indestructible Progress Backups (Zero Deletion)**: `/students/{studentUid}`, `/attempts/{attemptId}`, `/attempts/{attemptId}/responses/{questionId}`, `/xpLedger/{entryId}`, and `/progressBackups/{backupId}` strictly enforce `allow delete: if false;` so student progress reports and attempt history can never be deleted.

## 2. Dirty Dozen Adversarial Payloads (Must All Yield PERMISSION_DENIED)
1. **Unauthenticated Read on Leaderboard**: Anonymous request `get /leaderboard/u1` -> DENIED.
2. **Unverified Email Spoof**: Token with `email: "omkoshti8@gmail.com"` and `email_verified: false` writing `/questions/q1` -> DENIED.
3. **Non-Invited User Registration**: Authenticated user not in `/vipInvites` attempting `create /students/u_rogue` -> DENIED.
4. **Student Privilege Escalation**: Invited student attempting `create /admins/u1` -> DENIED.
5. **Shadow Ghost Field Injection**: Student creating `/attempts/a1` with extra key `isVerified: true` -> DENIED (`hasOnly` rejects).
6. **Cross-Student PII Read**: Student A attempting `get /students/studentB` -> DENIED.
7. **Cross-Student Attempt Forgery**: Student A creating `/attempts/a1` with `uid: "studentB"` -> DENIED.
8. **Score/Leaderboard Tampering Outside Valid Schema**: Student injecting string `totalXp: "99999"` or shadow field `rankOverride: 1` -> DENIED.
9. **Resource Poisoning via Oversized ID**: Creating `/questions/<1500_char_id>` -> DENIED (`isValidId` max 128 chars + regex).
10. **Timestamp Spoofing**: Creating `/attempts/a1` with backdated `createdAt` (`!= request.time`) -> DENIED.
11. **Admin Gate Secret Read by Student**: Student reading `/settings/adminGate` -> DENIED.
12. **Blanket List Query Without Cohort/Owner Filter**: Unfiltered list on `/students` by non-admin -> DENIED.
