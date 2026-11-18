# Path to CGL — Owner Actions Checklist (Production Only)

All code, unit test, build optimization, offline hardening, and draft rules preparation are complete on branch **`repair/path-to-cgl`**. The items below modify **live production systems, secrets, or deployment targets** and require explicit repository/project owner execution outside this sandbox.

---

## 1. Credential Rotation & Legacy Plaintext Scrubbing
- [ ] **Rotate Super Admin Master Password** via `/#/om` (`VIP` tab -> *Update Admin ID & Master Password*).
- [ ] **Rotate Cohort Student Passwords** for active VIP accounts (`damini_888` under UID `damini_01`, `demo@123` under UID `demo_123`, and remaining active slots) using `AdminUserManagementTab`.
- [ ] **Scrub Legacy `currentPassword` Field in Live Firestore**: Run a one-time owner cleanup script against `vipInvites/*` in Firestore (`total-reflector-plkqp` / `ai-studio-b4ce5a3e-d757-414c-a8c3-2f1ce12c647c`) using `deleteField()` for `currentPassword` once hashes are verified.
- [ ] **Verify Historical Data Continuity**: Confirm in live `/#/om` that Damini's (`damini_01`) attempts and XP history remain unified under `damini_888` without unintended merges.

## 2. Firebase Auth + `DRAFT_firestore.rules` Rollout
- [ ] **Provision Firebase Authentication Sign-In Flow**: `DRAFT_firestore.rules` enforces `request.auth != null` and admin claims (`request.auth.token.admin == true` or `users/{uid}.role == 'admin'`). Do **not** overwrite live `firestore.rules` with `DRAFT_firestore.rules` until client sessions mint real Firebase Auth tokens.
- [ ] **Test Against Firestore Emulator / Staging Project** using `DRAFT_firestore.rules`, then deploy once auth claims are live:
  ```bash
  cp DRAFT_firestore.rules firestore.rules
  firebase deploy --only firestore:rules
  ```
- [ ] **Configure API Key Restrictions & App Check**: Restrict the web API key in `firebase-applet-config.json` (`total-reflector-plkqp`) to `https://koshti-ji.github.io/*` (plus authorized preview origins) and enable Firebase App Check (reCAPTCHA v3 / Enterprise).

## 3. GitHub Repository & GitHub Pages Promotion
- [ ] **Audit Exposed Keys & Secrets**: Check GitHub Actions secrets, `.env` values, and commit history for any previously exposed `VITE_GROQ_API_KEY` or GitHub PAT; revoke and regenerate any compromised keys.
- [ ] **Push & Review `repair/path-to-cgl`**: Push `repair/path-to-cgl` to `origin`, inspect the diff against `main` (`3f4b0c7`), and verify CI/preview checks pass.
- [ ] **Deploy Production When Ready**: After owner review & merge to `main`, run `BASE_PATH=/SSC-CGL/ npm run deploy` to update `https://koshti-ji.github.io/SSC-CGL/`.
