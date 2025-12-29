# Open Source Production Deployment Plan

## 1. Secret & Credential Hardening (Highest Priority)
- [X] **Strict `.gitignore` Check:** Ensure `.env`, `.env.production`, `node_modules`, and any `data/` folders are explicitly ignored. 
- [X] **Example Env File:** Create a `.env.example` in the root. This contains all necessary keys but with empty or dummy values (e.g., `OPENAI_API_KEY=your_key_here`).
- [X] **Commit History Audit:** Run a tool like `trufflehog` or `git-filter-repo` to ensure you haven't committed API keys in previous commits. Once public, your entire history is searchable.



## 2. CI/CD & Security for Public Repos
- [ ] **Branch Protection:** Enable "Branch Protection" on `main` in GitHub. Require a pull request and status checks before merging.
- [ ] **GitHub Actions Secrets:** If you use CI/CD, move your server SSH keys and deployment scripts into **GitHub Actions Secrets** rather than keeping them in the repo.
- [X] **Dependency Audits:** Enable **Dependabot** to automatically alert you to security vulnerabilities in your open-source packages.

## 3. Licensing & Legal
- [X] **Add a LICENSE File:** Choose a license (e.g., **MIT** for maximum flexibility or **GPLv3** to ensure modifications remain open source). Without this file, you retain all rights, and others cannot legally contribute.
- [ ] **README Accessibility Section:** Since your app is accessibility-focused, include a "Compliance" section in your README explaining how it meets WCAG 2.1 standards.
- [ ] **Contributor Guidelines:** Create a `CONTRIBUTING.md` file to explain how others can help without breaking the production build.



## 4. Production Environment (Self-Hosted + Git)
- [O] **Separate Production Branch:** Ensure your Linux host pulls only from a `stable` or `production` branch to prevent "Work in Progress" code from public contributors hitting your live server.
- [ ] **Docker Hub/GHCR:** Consider building your images and pushing them to **GitHub Container Registry (GHCR)**. This keeps your production environment cleaner and prevents build errors on the host if a contributor pushes a broken dependency.
- [ ] **Sanitized Logs:** Ensure your production logging does not output user data or API keys to the console, as these could be seen if you ever share logs for debugging.

## 5. Persistence & User Privacy
- [ ] **Data Anonymization:** Ensure your database backups are stored in a non-public directory on your Linux host.
- [ ] **Privacy Policy:** Since the app is public and uses Voice APIs (sending data to OpenAI), include a `PRIVACY.md` explaining that voice data is processed by third-party LLMs.