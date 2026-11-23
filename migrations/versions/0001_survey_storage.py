"""Create surveys, their published snapshots, and responses."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001_survey_storage"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "surveys",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("template_key", sa.String(80), unique=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("draft", JSONB(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("current_version_id", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('draft', 'live', 'closed')", name="survey_status"),
        sa.CheckConstraint("(status = 'draft') = (current_version_id IS NULL)", name="survey_status_matches_version"),
    )
    op.create_table(
        "survey_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("survey_id", sa.Uuid(), sa.ForeignKey("surveys.id"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("definition", JSONB(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("survey_id", "number", name="survey_version_number"),
        sa.UniqueConstraint("survey_id", "id", name="survey_version_identity"),
    )
    op.create_foreign_key(
        "survey_current_version", "surveys", "survey_versions",
        ["id", "current_version_id"], ["survey_id", "id"],
    )
    op.create_table(
        "responses",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("survey_id", sa.Uuid(), sa.ForeignKey("surveys.id"), nullable=False),
        sa.Column("version_id", sa.Uuid(), nullable=False),
        sa.Column("submission_key", sa.Uuid(), nullable=False),
        sa.Column("answers", JSONB(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("survey_id", "submission_key", name="survey_submission_key"),
        sa.ForeignKeyConstraint(
            ["survey_id", "version_id"], ["survey_versions.survey_id", "survey_versions.id"],
            name="response_survey_version",
        ),
    )
    op.create_index("response_version_page", "responses", ["survey_id", "version_id", "submitted_at", "id"])


def downgrade():
    op.drop_table("responses")
    op.drop_constraint("survey_current_version", "surveys", type_="foreignkey")
    op.drop_table("survey_versions")
    op.drop_table("surveys")
