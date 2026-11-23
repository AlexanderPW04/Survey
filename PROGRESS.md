# Dust survey prototype progress

- [x] Implement the PostgreSQL schema and the create, publish, submit, review, and export workflow.
- [x] Build the draft editor, preview, participant form, and version-specific results.
- [x] Add automated checks, local setup, the Docker image definition, and the Render Blueprint.
- [x] Run offline verification and document the remaining environment and deployment checks.
- [ ] Run the full PostgreSQL and browser suites and build and start the production image.
- [ ] Push to the intended GitHub repository, apply the Render Blueprint, and verify the live workflow and redeploy persistence.

## Checks

- `python -m pytest -q` passed the offline validation, access logic, summaries, and CSV tests using cached packages. The three PostgreSQL integration tests were skipped because an isolated PostgreSQL server was unavailable.
- Python source compilation and `alembic upgrade head --sql` passed. The SQL was generated for PostgreSQL without connecting to a database.
- The npm lockfile passed an offline `npm ci --dry-run`. An offline TypeScript application source check with the locally available compiler, cached React declarations, and temporary Vite and React DOM declarations passed. The pinned install, production bundle, and Playwright checks await package registry access.
- The Blueprint passed Render’s official JSON Schema. Compose and GitHub Actions YAML parsed. Provider-side CLI validation and CI execution are pending.
- The source scan found no private keys or token patterns. The production frontend bundle still needs its secret scan in CI.

## Blockers and next action

The workspace has no GitHub remote or authenticated GitHub or Render connection. Its Git metadata is read-only from this session. Docker’s Linux engine did not start, and registry access is restricted. The Blueprint targets a free Oregon demo and needs an available free PostgreSQL slot. Follow the README to run the full checks in a connected environment, link the intended GitHub repository, and deploy through Render.
