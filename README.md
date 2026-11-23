# Dust Survey

A small web app for building questionnaires about household dust collection locations. Staff use a shared admin password. Participants open a separate survey link on a phone or computer. PostgreSQL stores drafts, published versions, and responses.

## Run locally

Install Docker Desktop or Docker Engine with Compose, Python 3.12, and Node.js 22.12 or newer. Run these commands from the project root. On Windows, use `Copy-Item .env.example .env` and `.\.venv\Scripts\Activate.ps1` in PowerShell.

```sh
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-test.txt
npm --prefix frontend ci
docker compose up -d --wait postgres
```

Replace both credential placeholders in your local `.env`. Choose an admin password of at least 10 characters and a separate random session secret of at least 32 characters. Generate a local secret with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

Start the FastAPI server from the project root and Vite in another terminal.

```sh
python -m backend.start
npm --prefix frontend run dev
```

Open [http://127.0.0.1:5173/admin](http://127.0.0.1:5173/admin). The API runs on port 8000. Vite forwards relative API requests to it. To test the built frontend served by FastAPI, use `npm --prefix frontend run build` and open [http://127.0.0.1:8000/admin](http://127.0.0.1:8000/admin).

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection. Accepts `postgresql://` and normalizes it for Psycopg. |
| `ADMIN_PASSWORD` | Shared admin password. Set on the server. |
| `SESSION_SECRET` | Separate signing key for admin sessions. Rotate to invalidate existing sessions. |
| `APP_ENV` | Set to `production` on HTTPS hosting, which requires a Secure cookie. |
| `PORT` | Default `8000` locally. Render sets it for deployment. |
| `TEST_DATABASE_URL` | Loopback-only PostgreSQL connection to an isolated database named `dust_test`. |
| `FRONTEND_DIST` | Optional server-side override for the built frontend directory. |

## Use the prototype

1. Open `/admin`, enter the shared password, and choose **New survey** or the demonstration draft.
2. Drag a question type onto the question list or select it in **Add question**. Edit its settings in the adjacent panel. Drag a card by its handle or use its up and down buttons. Select **Save** to keep a draft, or **Preview** to test the form.
3. Select **Publish**, then **Copy link**. The demo link after publication is `/s/dust-collection-demo`. Every new survey gets its own link. Draft edits appear for participants on the next publish. Earlier versions and their responses remain available in the results version selector.
4. In **Responses**, choose a published version. View individual responses, choice counts, or numeric summaries. Use **Download CSV** and **Download codebook** for analysis. Dates use `YYYY-MM-DD` and submission times use UTC. Empty answer cells represent unanswered questions. Checkbox selections are JSON arrays of readable labels.
5. Use **Close survey** to stop collection and **Lock admin** to clear this browser’s session. Publishing a closed survey opens it again and creates a new published version.

The demonstration survey is editable placeholder content. It starts unpublished and the app creates it once per database. Startup adds no test submissions. Automated tests use a separate PostgreSQL database with synthetic responses only.

## Checks

```sh
docker compose --profile test up -d --wait postgres-test
python -m pytest -q
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

With Playwright installed by `npm ci`, run `npx playwright install chromium` from `frontend`. Point `DATABASE_URL` at your disposable `dust_test` database, start `python -m backend.start` from the root, and set `E2E_ADMIN_PASSWORD` to the disposable app's admin password. Run `npm --prefix frontend run test:e2e`. `E2E_BASE_URL` defaults to `http://127.0.0.1:8000`. The browser suite creates synthetic records and must use the disposable app. GitHub Actions builds and runs the production image against test PostgreSQL and runs the browser workflow there.

To run the container yourself, use `docker build -t dust-survey .` and run it with the app environment variables, an accessible PostgreSQL URL, and a port mapping. For local HTTP set `APP_ENV=development` in its environment. With Docker Desktop on Windows or macOS, use `host.docker.internal` in the container’s database URL if PostgreSQL runs on the host and is reachable through that network. You can also use a shared Docker network and the database service hostname.

## Migrations

`python -m backend.start` applies tracked Alembic upgrades while holding a PostgreSQL advisory lock and then starts the server. A failed migration stops startup. To inspect local migration state, run `python -m alembic current`. For a separate local migration without a server, run `python -m alembic upgrade head` against the intended database. On a paid service that supports pre-deploy commands, move migrations to that phase if needed. Review schema changes and take an appropriate backup before running them against a study database.

## Deploy through GitHub and Render

1. Push the local `main` branch to the intended GitHub repository and confirm both jobs in **Actions → Prototype checks** pass.
2. In Render, connect GitHub under **Account Settings → Git Deployment Credentials** and grant access to that repository. In the intended workspace, choose **New → Blueprint**, select the repository and `main`, and use the root `render.yaml`. The Blueprint uses one Free Docker web service and one Free PostgreSQL 17 database in Oregon. Confirm the workspace has a free database slot and no unapproved billable usage.
3. Validate the YAML with `render blueprints validate render.yaml` using Render CLI 2.7 or later, or the Render validation API. On initial Blueprint creation, provide `ADMIN_PASSWORD` in Render. Render generates the separate `SESSION_SECRET` and connects the database privately through its internal connection string.
4. After the service starts, verify `/healthz`, open `/admin`, confirm the password gate in a signed-out browser, and publish the demo only if you intend to collect synthetic test responses. Copy its participant URL, submit a synthetic answer, and verify the results and export. Redeploy the same commit once and check that the response is still present.
5. In the web service settings, confirm the GitHub repository and branch, plus **After CI Checks Pass** under Auto-Deploy. The Blueprint configures `autoDeployTrigger: checksPass`. Keep the GitHub workflow enabled so Render detects checks.

[Git provider](https://render.com/docs/git-provider) · [Blueprint fields](https://render.com/docs/blueprint-spec) · [Docker](https://render.com/docs/docker) · [Web services](https://render.com/docs/web-services) · [Deploys](https://render.com/docs/deploys) · [Free plan limits](https://render.com/docs/free)

## Retention and restore

Free Render PostgreSQL expires after 30 days and has no managed backups. Use this configuration for synthetic demonstration data. Export responses and codebooks before expiration if you need to retain them. CSV files support analysis and do not restore survey definitions or application history. For a full logical backup, use `pg_dump -Fc` from an authorized machine or service with database access. The Blueprint blocks public database access, so use an authorized private connection or arrange a narrowly scoped, temporary approved access path. Store the backup outside the app. Verify it with `pg_restore --list`, then restore with `pg_restore --no-owner --no-privileges -d` to a **new, empty** PostgreSQL database and verify the survey and response counts before changing a live connection.

For ongoing collection, confirm the lab’s hosting and data-retention requirements and obtain approval for a paid database such as Render Basic-256mb, a recovery window, and protected storage for periodic logical backups. Test restoration before relying on the backup. Render documents point-in-time recovery on paid databases. [Render PostgreSQL recovery and backups](https://render.com/docs/postgresql-backups)

## Prototype limits and future accounts

The shared password does not identify individual staff members. The survey link does not identify participants, and the submission retry key prevents accidental duplicates for a single attempt. The app does not ask for names, street addresses, or health information in the demonstration questionnaire. The professor supplies the actual questionnaire.

The admin gate and CSRF handling live in `backend/access.py`. Future accounts can replace the shared access check there and add scoped access to admin routes in `backend/routes.py`. PostgreSQL models and migrations live in `backend/db.py` and `migrations/`. Question types are described in `frontend/src/models.ts` and validated in `backend/forms.py`. Preview and the participant page share `frontend/src/SurveyForm.tsx`.
