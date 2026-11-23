import os
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from backend.config import admin_credentials, database_url

MIGRATION_LOCK = 316482021


def upgrade(url):
    engine = create_engine(url, hide_parameters=True)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": MIGRATION_LOCK})
            connection.commit()
            try:
                config = Config(Path(__file__).resolve().parent.parent / "alembic.ini")
                config.attributes["connection"] = connection
                command.upgrade(config, "head")
            finally:
                connection.rollback()
                connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": MIGRATION_LOCK})
                connection.commit()
    finally:
        engine.dispose()


if __name__ == "__main__":
    admin_credentials()
    try:
        upgrade(database_url())
    except Exception:
        raise SystemExit("Database migration failed. Check the database connection and migration state.") from None
    uvicorn.run(
        "backend.main:create_app", factory=True, host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")), access_log=False,
    )
