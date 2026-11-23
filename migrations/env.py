from alembic import context
from sqlalchemy import create_engine, pool

from backend.config import database_url
from backend.db import Base

config = context.config


def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    context.configure(
        url=database_url(), target_metadata=Base.metadata, literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()
elif config.attributes.get("connection") is not None:
    migrate(config.attributes["connection"])
else:
    with create_engine(database_url(), poolclass=pool.NullPool).connect() as connection:
        migrate(connection)
