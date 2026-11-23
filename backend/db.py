from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Index, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Survey(Base):
    __tablename__ = "surveys"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'live', 'closed')", name="survey_status"),
        CheckConstraint(
            "(status = 'draft') = (current_version_id IS NULL)",
            name="survey_status_matches_version",
        ),
        ForeignKeyConstraint(
            ["id", "current_version_id"], ["survey_versions.survey_id", "survey_versions.id"],
            name="survey_current_version", use_alter=True,
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    template_key: Mapped[str | None] = mapped_column(String(80), unique=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text)
    draft: Mapped[dict] = mapped_column(JSONB)
    revision: Mapped[int]
    status: Mapped[str] = mapped_column(String(12))
    current_version_id: Mapped[UUID | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SurveyVersion(Base):
    __tablename__ = "survey_versions"
    __table_args__ = (
        UniqueConstraint("survey_id", "number", name="survey_version_number"),
        UniqueConstraint("survey_id", "id", name="survey_version_identity"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    survey_id: Mapped[UUID] = mapped_column(ForeignKey("surveys.id"))
    number: Mapped[int]
    definition: Mapped[dict] = mapped_column(JSONB)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Response(Base):
    __tablename__ = "responses"
    __table_args__ = (
        UniqueConstraint("survey_id", "submission_key", name="survey_submission_key"),
        ForeignKeyConstraint(
            ["survey_id", "version_id"], ["survey_versions.survey_id", "survey_versions.id"],
            name="response_survey_version",
        ),
        Index("response_version_page", "survey_id", "version_id", "submitted_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    survey_id: Mapped[UUID] = mapped_column(ForeignKey("surveys.id"))
    version_id: Mapped[UUID]
    submission_key: Mapped[UUID]
    answers: Mapped[dict] = mapped_column(JSONB)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
