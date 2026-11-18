# Path to CGL — Preview & Staging Deployment Guide

- **Current Branch**: `repair/path-to-cgl`
- **Production Branch (`main`)**: Untouched (`https://koshti-ji.github.io/SSC-CGL/` remains unaffected)
- **Rollback Archive**: `/tmp/path-to-cgl-backups/pre-repair-baseline.tar.gz`

---

## 1. Local Staging Verification

Run either root-hosted preview or exact GitHub Pages subpath simulation locally:

```bash
# Option A: Root-path preview (http://localhost:3000/)
npm run build
npm run preview

# Option B: GitHub Pages subpath build check (matches /SSC-CGL/ asset prefixes)
BASE_PATH=/SSC-CGL/ npm run build
```

Verify key routes locally:
- Student Portal: `http://localhost:3000/`
- DEST & Computer Simulator: `http://localhost:3000/#/dest-simulator`
- Super Admin Gateway: `http://localhost:3000/#/om`

---

## 2. Isolated Preview Hosting Options (Without Touching `main`)

1. **Firebase Hosting Preview Channel** (recommended when Firebase CLI auth is available):
   ```bash
   BASE_PATH=/ npm run build
   firebase hosting:channel:deploy repair-preview --expires 7d
   ```
2. **Branch-Isolated GitHub Pages Preview / PR Review**:
   - Push `repair/path-to-cgl` (never force-push `main`) to open a pull request on `koshtI-JI/SSC-CGL`.
   - Deploy `dist/` built with `BASE_PATH=/<preview-subpath>/` or a staging branch rather than overwriting `gh-pages` until owner sign-off in `OWNER_ACTIONS.md` is complete.

---

## 3. Pre-Promotion Checklist

Before promoting `repair/path-to-cgl` to production:
1. Run `npm test && npm run lint && npx eslint firestore.rules DRAFT_firestore.rules`.
2. Confirm `BASE_PATH=/SSC-CGL/ npm run build` exits cleanly with `0` warnings.
3. Complete all live-environment items listed in `docs/engineering/OWNER_ACTIONS.md`.
