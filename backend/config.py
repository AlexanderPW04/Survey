import os

from dotenv import load_dotenv
from sqlalchemy.engine import make_url

load_dotenv()


def database_url(value: str | None = None):
    raw = value or os.environ.get("DATABASE_URL")
    if not raw:
        raise RuntimeError("Set DATABASE_URL to a PostgreSQL connection.")
    try:
        url = make_url(raw)
    except Exception:
        raise RuntimeError("DATABASE_URL is invalid.") from None
    if url.drivername not in {"postgres", "postgresql", "postgresql+psycopg"}:
        raise RuntimeError("DATABASE_URL must use PostgreSQL.")
    return url.set(drivername="postgresql+psycopg")


def admin_credentials():
    password = os.getenv("ADMIN_PASSWORD", "")
    secret = os.getenv("SESSION_SECRET", "")
    if (
        len(password.strip()) < 10 or len(password) > 1024
        or len(secret.strip()) < 32 or password == secret
        or any(
            value.lower().startswith(("replace-", "change-me", "changeme", "placeholder", "example"))
            for value in (password.strip(), secret.strip())
        )
    ):
        raise RuntimeError("Configure a distinct ADMIN_PASSWORD and SESSION_SECRET.")
    return password, secret
