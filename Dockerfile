FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run typecheck && npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 APP_ENV=production FRONTEND_DIST=/app/frontend/dist
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt && useradd --system --uid 10001 dust
COPY --chown=dust backend ./backend
COPY --chown=dust migrations ./migrations
COPY --chown=dust alembic.ini ./
COPY --from=frontend --chown=dust /build/dist ./frontend/dist
USER dust
CMD ["python", "-m", "backend.start"]
