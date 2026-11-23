import re
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response as FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.access import equal_secret, require_admin, start_session
from backend.db import Response, Survey, SurveyVersion
from backend.exports import answer_label, export_codebook, export_rows, summaries, utc_time
from backend.forms import (
    Definition, DraftSave, Password, PreviewSubmission, Revision, Submission,
    definition_errors, demo_definition, validate_answers,
)

auth = APIRouter(prefix="/api/admin/session")
admin = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])
public = APIRouter(prefix="/api/public")


def database(request: Request):
    with request.app.state.sessions() as session:
        yield session


DB = Annotated[Session, Depends(database)]


def invalid(errors):
    if errors:
        raise HTTPException(422, {"message": "Check the highlighted fields.", "fields": errors})


@auth.post("")
def login(payload: Password, request: Request):
    # A custom header makes cross-origin login requests require a preflight.
    if request.headers.get("X-Admin-Request") != "1":
        raise HTTPException(403, "Open the admin page to sign in.")
    address = request.client.host if request.client else "unknown"
    attempts = request.app.state.attempts
    attempts.consume(address)
    if not equal_secret(payload.password, request.app.state.admin_password):
        raise HTTPException(401, "That password was incorrect.")
    attempts.reset(address)
    return start_session(request)


@auth.get("", dependencies=[Depends(require_admin)])
def session_status(request: Request):
    return {"csrf": request.session["csrf"]}


@auth.delete("", status_code=204, dependencies=[Depends(require_admin)])
def logout(request: Request):
    request.session.clear()


def get_survey(db, survey_id, lock=False):
    query = select(Survey).where(Survey.id == survey_id)
    survey = db.scalar(query.with_for_update() if lock else query)
    if survey is None:
        raise HTTPException(404, "Survey not found.")
    return survey


def by_slug(db, slug, lock=False):
    query = select(Survey).where(Survey.slug == slug)
    survey = db.scalar(query.with_for_update() if lock else query)
    if survey is None or survey.status == "draft":
        raise HTTPException(404, "This survey is unavailable.")
    return survey


def survey_summary(survey, response_count=None):
    data = {
        "id": survey.id, "slug": survey.slug, "title": survey.title,
        "status": survey.status, "updated_at": utc_time(survey.updated_at),
        "is_demo": survey.template_key is not None, "current_version_id": survey.current_version_id,
    }
    if response_count is not None:
        data["response_count"] = response_count
    return data


def survey_detail(survey):
    return {**survey_summary(survey), "revision": survey.revision, "definition": survey.draft}


def new_survey(definition, slug=None):
    base = re.sub(r"[^a-z0-9]+", "-", definition.title.lower()).strip("-")[:65].rstrip("-") or "survey"
    return {
        "id": uuid4(), "slug": slug or f"{base}-{uuid4().hex[:16]}",
        "title": definition.title.strip(), "description": definition.description,
        "draft": definition.model_dump(), "revision": 1, "status": "draft",
    }


def seed_demo(db):
    record = new_survey(demo_definition(), slug="dust-collection-demo")
    record["template_key"] = "dust-collection-demo"
    db.execute(insert(Survey).values(**record).on_conflict_do_nothing(index_elements=["template_key"]))
    db.commit()


def check_revision(survey, revision):
    if survey.revision != revision:
        raise HTTPException(409, "This draft changed elsewhere. Copy your edits before reloading.")


def touch(survey):
    survey.revision += 1
    survey.updated_at = datetime.now(timezone.utc)


@admin.get("/surveys")
def list_surveys(db: DB):
    count = select(func.count(Response.id)).where(Response.survey_id == Survey.id).scalar_subquery()
    surveys = db.execute(select(Survey, count).order_by(Survey.updated_at.desc(), Survey.id)).all()
    return [survey_summary(survey, responses) for survey, responses in surveys]


@admin.post("/surveys", status_code=201)
def create_survey(definition: Definition, db: DB):
    invalid(definition_errors(definition))
    survey = Survey(**new_survey(definition))
    db.add(survey)
    db.flush()
    result = survey_detail(survey)
    db.commit()
    return result


@admin.get("/surveys/{survey_id}")
def draft(survey_id: UUID, db: DB):
    return survey_detail(get_survey(db, survey_id))


@admin.put("/surveys/{survey_id}")
def update_draft(survey_id: UUID, payload: DraftSave, db: DB):
    invalid(definition_errors(payload.definition))
    survey = get_survey(db, survey_id, lock=True)
    check_revision(survey, payload.revision)
    saved_keys = {question["id"]: question["key"] for question in survey.draft["questions"]}
    invalid({
        question.id: "A question's variable key cannot change."
        for question in payload.definition.questions
        if saved_keys.get(question.id, question.key) != question.key
    })
    survey.title = payload.definition.title.strip()
    survey.description = payload.definition.description
    survey.draft = payload.definition.model_dump()
    touch(survey)
    result = survey_detail(survey)
    db.commit()
    return result


@admin.post("/surveys/{survey_id}/publish")
def publish(survey_id: UUID, payload: Revision, db: DB):
    survey = get_survey(db, survey_id, lock=True)
    check_revision(survey, payload.revision)
    invalid(definition_errors(Definition.model_validate(survey.draft), publish=True))
    number = db.scalar(select(func.max(SurveyVersion.number)).where(SurveyVersion.survey_id == survey.id)) or 0
    version = SurveyVersion(survey_id=survey.id, number=number + 1, definition=survey.draft)
    db.add(version)
    db.flush()
    survey.current_version_id = version.id
    survey.status = "live"
    touch(survey)
    result = survey_detail(survey)
    db.commit()
    return result


@admin.post("/surveys/{survey_id}/close")
def close(survey_id: UUID, payload: Revision, db: DB):
    survey = get_survey(db, survey_id, lock=True)
    check_revision(survey, payload.revision)
    if survey.status != "live":
        raise HTTPException(409, "Only a live survey can be closed.")
    survey.status = "closed"
    touch(survey)
    result = survey_detail(survey)
    db.commit()
    return result


@admin.delete("/surveys/{survey_id}", status_code=204)
def delete_draft(survey_id: UUID, payload: Revision, db: DB):
    survey = get_survey(db, survey_id, lock=True)
    check_revision(survey, payload.revision)
    if survey.status != "draft" or survey.template_key or db.scalar(
        select(SurveyVersion.id).where(SurveyVersion.survey_id == survey.id).limit(1)
    ):
        raise HTTPException(409, "Only unused drafts can be deleted.")
    db.delete(survey)
    db.commit()


@admin.post("/preview", status_code=204)
def preview(payload: PreviewSubmission):
    invalid(definition_errors(payload.definition, publish=True))
    _, errors = validate_answers(payload.definition.model_dump(), payload.answers)
    invalid(errors)


@public.get("/surveys/{slug}")
def live_survey(slug: str, db: DB):
    survey = by_slug(db, slug)
    if survey.status == "closed":
        raise HTTPException(410, "This survey is closed.")
    version = db.get(SurveyVersion, survey.current_version_id)
    return {"version_id": version.id, "definition": version.definition}


@public.post("/surveys/{slug}/responses")
def submit(slug: str, payload: Submission, db: DB):
    survey = by_slug(db, slug, lock=True)
    previous = db.scalar(select(Response).where(
        Response.survey_id == survey.id, Response.submission_key == payload.submission_key,
    ))
    if previous is not None and previous.version_id != payload.version_id:
        raise HTTPException(409, "This submission key was already used.")
    if previous is None and survey.status == "closed":
        raise HTTPException(410, "This survey is closed.")
    version = db.scalar(select(SurveyVersion).where(
        SurveyVersion.id == payload.version_id, SurveyVersion.survey_id == survey.id,
    ))
    if version is None:
        raise HTTPException(404, "This version of the survey is unavailable.")
    answers, errors = validate_answers(version.definition, payload.answers)
    if previous is not None:
        if errors or answers != previous.answers:
            raise HTTPException(409, "This submission key was already used.")
        return {"saved": True}
    invalid(errors)
    db.add(Response(
        survey_id=survey.id, version_id=version.id,
        submission_key=payload.submission_key, answers=answers,
    ))
    db.commit()
    return {"saved": True}


def response_summary(response):
    return {"id": response.id, "submitted_at": utc_time(response.submitted_at)}


def version_summary(version):
    return {"id": version.id, "number": version.number, "published_at": utc_time(version.published_at)}


def version_rows(survey_id, version_id):
    return select(Response).where(Response.survey_id == survey_id, Response.version_id == version_id)


def get_version(db, survey, version_id):
    target = version_id or survey.current_version_id
    if target is None:
        return None
    version = db.scalar(select(SurveyVersion).where(
        SurveyVersion.id == target, SurveyVersion.survey_id == survey.id,
    ))
    if version is None:
        raise HTTPException(404, "Published version not found.")
    return version


@admin.get("/surveys/{survey_id}/results")
def results(
    survey_id: UUID, db: DB, version_id: UUID | None = None,
    page: int = Query(default=1, ge=1, le=100_000),
):
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
    survey = get_survey(db, survey_id)
    versions = db.scalars(select(SurveyVersion).where(
        SurveyVersion.survey_id == survey.id,
    ).order_by(SurveyVersion.number.desc())).all()
    total = db.scalar(select(func.count(Response.id)).where(Response.survey_id == survey.id))
    version = get_version(db, survey, version_id)
    result = {
        "survey": survey_summary(survey, total), "versions": [version_summary(v) for v in versions],
        "version": None, "responses": [], "page": page, "page_size": 25, "version_total": 0, "summaries": [],
    }
    if version is not None:
        base = version_rows(survey.id, version.id)
        rows = db.scalars(base.order_by(Response.submitted_at.desc(), Response.id.desc()).offset((page - 1) * 25).limit(25))
        result["responses"] = [response_summary(row) for row in rows]
        answers = db.scalars(
            select(Response.answers).where(Response.survey_id == survey.id, Response.version_id == version.id)
            .execution_options(yield_per=256)
        )
        result["summaries"], result["version_total"] = summaries(version.definition, answers)
        result["version"] = {**version_summary(version), "definition": version.definition}
    return result


@admin.get("/surveys/{survey_id}/responses/{response_id}")
def response_detail(survey_id: UUID, response_id: UUID, db: DB):
    response = db.scalar(select(Response).where(Response.survey_id == survey_id, Response.id == response_id))
    if response is None:
        raise HTTPException(404, "Response not found.")
    version = db.get(SurveyVersion, response.version_id)
    items = [
        {"question": question, "value": answer_label(question, response.answers.get(question["id"]))}
        for question in version.definition["questions"] if question["type"] != "section"
    ]
    return {**response_summary(response), "version": version_summary(version), "items": items}


@admin.get("/surveys/{survey_id}/exports/{kind}")
def export(survey_id: UUID, kind: str, db: DB, request: Request, version_id: UUID | None = None):
    survey = get_survey(db, survey_id)
    version = get_version(db, survey, version_id)
    if version is None or kind not in {"responses.csv", "codebook.csv"}:
        raise HTTPException(404, "Export not found.")
    headers = {"Content-Disposition": f'attachment; filename="{survey.slug}-v{version.number}-{kind}"'}
    if kind == "codebook.csv":
        return FileResponse(export_codebook(version), media_type="text/csv", headers=headers)
    target_id, selected_id = survey.id, version.id

    def stream():
        with request.app.state.sessions() as connection:
            rows = connection.scalars(
                version_rows(target_id, selected_id).order_by(Response.submitted_at, Response.id)
                .execution_options(yield_per=256)
            )
            yield from export_rows(version, rows)

    return StreamingResponse(stream(), media_type="text/csv", headers=headers)
