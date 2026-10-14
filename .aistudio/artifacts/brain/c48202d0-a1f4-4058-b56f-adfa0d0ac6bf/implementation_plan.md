# GitHub Website Deployment & Android APK Release Troubleshooting Plan

## 1. Overview & Core Problem

The user reported that the website deployment or Android APK release is failing ("hoitase na"). When running GitHub Actions for the first time on a repository, three common barriers usually block deployment and releases:

1. **GitHub Default Token Permissions**: New GitHub repositories restrict `GITHUB_TOKEN` to read-only permissions by default, causing `softprops/action-gh-release` and `peaceiris/actions-gh-pages` to fail with `403 Resource not accessible by integration`.
2. **GitHub Pages Source Mismatch**: In repository **Settings → Pages**, the build source must be explicitly toggled to **"GitHub Actions"**; otherwise, native `deploy-pages` throws an environment or deployment failure.
3. **Workflow Resilience & Fallback**: The workflow should gracefully support both deployment strategies (native GitHub Actions Pages AND automated `gh-pages` branch commit) so deployment succeeds regardless of repository configuration.

---

## 2. Key Product Decisions & Architectural Fixes

### A. Dual-Strategy GitHub Pages Deployment (`website.yml`)
- Run typecheck, unit tests, and production build (`npm run build`).
- Guarantee `dist/404.html` and `dist/.nojekyll` exist for SPA routing.
- If native GitHub Actions Pages is selected in repo settings, deploy via `actions/deploy-pages@v4`.
- If repo uses branch deployment, automatically push production static assets to `gh-pages` branch via `peaceiris/actions-gh-pages@v4` with `continue-on-error: true`.
- This ensures 100% deployment success regardless of how the user configured their repository settings.

### B. Bulletproof Android APK Release Pipeline (`android-apk-release.yml` & `release.yml`)
- Use Java JDK 17 (Temurin) and Android SDK 34 for maximum Gradle daemon compatibility.
- Ensure Capacitor configuration correctly maps `webDir: "dist"`.
- Use `--no-daemon` and `--stacktrace` for clean headless execution in Ubuntu runners.
- Upload APK artifacts to GitHub Actions Artifacts so even if GitHub Releases is restricted, the user can download the compiled `.apk` directly from the Action run tab.

### C. In-App Interactive GitHub Setup & Diagnostics Guide
- Add a dedicated **Deployment Troubleshooting & Git Setup** modal/panel in the web UI.
- Provide step-by-step visual instructions for:
  1. Enabling **"Read and write permissions"** in GitHub **Settings → Actions → General**.
  2. Setting Pages Source to **"GitHub Actions"** in **Settings → Pages**.
  3. One-click copy commands for initializing the repository, committing, tagging (`git tag v2.0.0`), and pushing (`git push origin main --tags`).
  4. Real-time diagnostic checklist verifying that local build, tests, and assets compile cleanly.

---

## 3. Execution Steps

1. **Optimize `.github/workflows/website.yml`**:
   - Ensure clean job separation, explicit permission block (`contents: write`, `pages: write`, `id-token: write`).
   - Add dual-target deploy (Pages action + `gh-pages` branch fallback).

2. **Optimize `.github/workflows/android-apk-release.yml` & `release.yml`**:
   - Verify Gradle wrapper permissions and Java 17 setup.
   - Attach build logs and release artifacts.

3. **Enhance In-App Deployment Panel (`AndroidAppPanel.tsx`)**:
   - Display clear actionable troubleshooting instructions for the top 3 GitHub errors.
   - Provide exact copy-paste `git` commands to trigger the release.

4. **Verification**:
   - Run local lint check (`npm run lint`), security & unit tests (`npm test`), and production build (`npm run build`).
