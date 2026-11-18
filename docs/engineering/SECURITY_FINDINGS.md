# Path to CGL — Security Findings & Remediation Status

**Scope**: Repository codebase security posture on `repair/path-to-cgl` vs. live production infrastructure items requiring owner execution outside this workspace.

---

## 1. Fixed in Repository (`repair/path-to-cgl`)

### SEC-01 (High) — Plaintext Student Password Persistence & UI Exposure (`currentPassword`)
- **Finding**: Legacy `vipInvites` documents stored and rendered plaintext `currentPassword` values in storage, admin UI tables, and JSON exports.
- **Remediation**:
  - Updated `src/utils/localFallbackStore.ts`, `src/utils/adminCommandCenter.ts`, `src/lib/firestoreService.ts`, and `src/components/AdminUserManagementTab.tsx` to strip `currentPassword` on ingest/normalization (`sanitizeVipInviteForStorage`, `sanitizeVipInviteForExport`) and authenticate exclusively against SHA-256 digests (`sha256Hex`).
  - Added legacy plaintext detection (`legacyPlaintextDetected` dry-run counter) so admins can identify un-rotated records without ever displaying, copying, or exporting plaintext secrets.
  - Verified by unit tests (`localFallbackStore.test.ts`, `adminCommandCenter.test.ts`) and Playwright DOM inspection (`leaksPlaintext: false`).

### SEC-02 (High) — Unprotected GitHub PAT & Accidental `main` Branch Writes in Repo CMS
- **Finding**: Live repository editing risks persisting a Personal Access Token to browser storage or committing directly to `main`/`master`.
- **Remediation**:
  - Implemented `src/utils/githubCodeEditor.ts` and `src/components/LiveCodeEditorPanel.tsx` with a strictly **in-memory** PAT React state reference (never written to `localStorage`, `sessionStorage`, IndexedDB, or Firestore).
  - Enforced `isProtectedBranch` / `assertEditableGitBranch` guards blocking commits to `main` and `master` both in helper logic (unit tested in `githubCodeEditor.test.ts`) and in UI state (verified on `/#/om` Repo CMS).

### SEC-03 (High) — Permissive Production `firestore.rules` (Unauthenticated Client Reads/Writes)
- **Finding**: Baseline `firestore.rules` on `main` allows open access required by the legacy client-hash auth architecture.
- **Remediation**:
  - Authored `DRAFT_firestore.rules` (652 lines, 0 ESLint rule violations) implementing fail-closed defaults (`allow read, write: if false`), Firebase Auth identity checks (`isSignedIn()`, `isAdmin()`, `isOwner()`), strict allowed/required field validation, immutable attempt/XP ledger logs, and explicit rejection of `currentPassword` on `vipInvites`.
  - Kept live `firestore.rules` unchanged on disk and undeployed so production cohort login is not broken before migrating credentials to Firebase Auth.

### SEC-04 (Medium) — Backup Snapshot Admin Credential Injection
- **Finding**: Restoring a JSON snapshot could overwrite local admin credentials or inject plaintext passwords.
- **Remediation**: `importLocalCohortSnapshot` in `src/utils/localFallbackStore.ts` refuses to overwrite existing `adminCredentials` and sanitizes restored `vipInvites` to strip any legacy plaintext field.

---

## 2. Production-Only Security Items Requiring Owner Action

These items cannot be completed inside the repository alone because they require live Firebase Console, GitHub repository, or cohort account actions:

1. **Migrate Auth to Firebase Auth Before Deploying `DRAFT_firestore.rules`**: Deploying `DRAFT_firestore.rules` while users still authenticate without `request.auth` will block live Firestore reads/writes. Pair Firebase Auth / custom claims provisioning with `DRAFT_firestore.rules` rollout.
2. **Rotate Existing Passwords & Scrub Remote Legacy `currentPassword` Fields**: Once admin and cohort passwords are reset via `AdminUserManagementTab`, scrub remaining `currentPassword` attributes from live Firestore `vipInvites` documents.
3. **Restrict `firebase-applet-config.json` API Key & Enable App Check**: Restrict the Google Cloud API key to production origins (`koshti-ji.github.io` and authorized preview domains) and enable Firebase App Check.
4. **Verify GitHub Repo Secrets & Audit History**: Confirm no GitHub PAT or paid API keys were committed to git history or GitHub Actions variables; rotate any previously exposed secret (see `OWNER_ACTIONS.md`).
