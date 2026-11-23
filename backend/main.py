import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.middleware.sessions import SessionMiddleware
from starlette.staticfiles import StaticFiles

from backend.access import PasswordAttempts, SESSION_AGE
from backend.config import admin_credentials, database_url
from backend.routes import admin, auth, public, seed_demo

ROOT = Path(__file__).resolve().parent.parent


def create_app():
    password, secret = admin_credentials()
    production = os.getenv("APP_ENV") == "production"
    engine = create_engine(database_url(), pool_pre_ping=True, hide_parameters=True)
    sessions = sessionmaker(engine)

    @asynccontextmanager
    async def lifespan(app):
        try:
            with sessions() as session:
                seed_demo(session)
            yield
        finally:
            engine.dispose()

    app = FastAPI(
        lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None,
    )
    app.state.engine = engine
    app.state.sessions = sessions
    app.state.admin_password = password
    app.state.attempts = PasswordAttempts()
    app.add_middleware(
        SessionMiddleware, secret_key=secret, session_cookie="dust_admin", path="/api/admin",
        max_age=SESSION_AGE, same_site="strict", https_only=production,
    )

    @app.middleware("http")
    async def response_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith(("/api", "/admin", "/s/")):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        return JSONResponse({"detail": "Check the form and try again."}, status_code=422)

    @app.get("/healthz")
    def health():
        return {"status": "ok"}

    app.include_router(auth)
    app.include_router(admin)
    app.include_router(public)

    dist = Path(os.getenv("FRONTEND_DIST", str(ROOT / "frontend" / "dist")))
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/")
    @app.get("/admin")
    @app.get("/admin/{path:path}")
    @app.get("/s/{path:path}")
    def frontend():
        if not (dist / "index.html").is_file():
            raise HTTPException(503, "Start Vite or build the frontend.")
        return FileResponse(dist / "index.html", headers={
            "Content-Security-Policy": "default-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        })

    return app
