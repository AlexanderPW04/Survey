import csv
import io
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError

from backend.config import database_url
from backend.db import Response
from backend.main import create_app
from backend.start import upgrade

DEMO_PASSWORD = "synthetic-integration-password"


@pytest.fixture(scope="module")
def pg_url():
    raw = os.getenv("TEST_DATABASE_URL")
    if not raw:
        pytest.skip("Set TEST_DATABASE_URL to the isolated dust_test database.")
    url = database_url(raw)
    assert url.host in {"localhost", "127.0.0.1", "::1"} and url.database == "dust_test"
    upgrade(url)
    return url


@pytest.fixture
def context(pg_url, monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", pg_url.render_as_string(hide_password=False))
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ADMIN_PASSWORD", DEMO_PASSWORD)
    monkeypatch.setenv("SESSION_SECRET", "synthetic-session-secret-for-integration")
    monkeypatch.setenv("FRONTEND_DIST", str(tmp_path))
    (tmp_path / "index.html").write_text("<!doctype html><title>QA</title>", encoding="utf-8")
    with TestClient(create_app(), base_url="https://testserver") as client:
        yield client, pg_url


def admin(client):
    logged = client.post("/api/admin/session", json={"password": DEMO_PASSWORD}, headers={"X-Admin-Request": "1"})
    assert logged.status_code == 200, logged.text
    assert all(flag in logged.headers["set-cookie"].lower() for flag in ("httponly", "secure", "samesite=strict"))
    return {"X-CSRF-Token": logged.json()["csrf"]}


def definition():
    return {
        "title": "Synthetic dust test " + uuid4().hex[:8], "description": "Testing only.",
        "questions": [
            {"id": "room", "key": "room", "type": "single", "label": "Original location", "required": True,
             "options": [{"id": "a", "label": "Original kitchen"}, {"id": "b", "label": "Hall"}]},
            {"id": "days", "key": "days", "type": "integer", "label": "Delta", "min": -10, "unit": "days"},
            {"id": "note", "key": "note", "type": "long", "label": "Note"},
        ],
    }


def created(client, headers, form):
    response = client.post("/api/admin/surveys", json=form, headers=headers)
    assert response.status_code == 201, response.text
    survey = response.json()
    return survey, "/api/admin/surveys/" + survey["id"], "/api/public/surveys/" + survey["slug"]


def publish(client, headers, root, revision):
    result = client.post(root + "/publish", json={"revision": revision}, headers=headers)
    assert result.status_code == 200, result.text
    return result.json()


def attempt(version, answers):
    return {"version_id": version, "submission_key": str(uuid4()), "answers": answers}


def test_sessions_and_fallback(context):
    client, _ = context
    root = "/api/admin/surveys/" + str(uuid4())
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/admin/surveys/" + str(uuid4()) + "/edit").status_code == 200
    assert client.get("/s/sample-slug").status_code == 200
    assert "application/json" in client.get("/api/missing").headers["content-type"]
    assert client.get("/api/missing").status_code == 404
    assert client.post("/api/missing", json={}).status_code == 404
    assert client.get("/api/admin/surveys").status_code == 401
    assert client.get(root + "/results").status_code == 401
    assert client.get(root + "/exports/responses.csv").status_code == 401
    assert client.get(root).status_code == 401
    assert client.post("/api/admin/surveys", json=definition()).status_code == 401
    assert client.post("/api/admin/session", json={"password": DEMO_PASSWORD}).status_code == 403
    headers = admin(client)
    assert client.post("/api/admin/surveys", json=definition()).status_code == 403
    assert client.get("/api/admin/session").status_code == 200
    assert client.delete("/api/admin/session", headers=headers).status_code == 204
    assert client.get("/api/admin/surveys").status_code == 401


def test_failed_login_is_throttled(context):
    client, _ = context
    for _ in range(8):
        assert client.post("/api/admin/session", json={"password": "incorrect"}, headers={"X-Admin-Request": "1"}).status_code == 401
    blocked = client.post("/api/admin/session", json={"password": DEMO_PASSWORD}, headers={"X-Admin-Request": "1"})
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0


def test_saved_versions_results_exports_and_restart(context):
    client, url = context
    headers = admin(client)
    form = definition()
    draft, root, participant = created(client, headers, form)
    unused, unused_root, _ = created(client, headers, definition())
    assert client.request("DELETE", unused_root, json={"revision": unused["revision"]}, headers=headers).status_code == 204
    assert client.get(unused_root).status_code == 404
    assert client.get(participant).status_code == 404
    assert client.post(participant + "/responses", json=attempt(str(uuid4()), {"room": "a"})).status_code == 404
    assert client.post("/api/admin/preview", json={"definition": form, "answers": {"room": "a"}}, headers=headers).status_code == 204
    assert client.get(root + "/results").json()["survey"]["response_count"] == 0
    form["questions"].reverse()
    updated = client.put(root, json={"revision": draft["revision"], "definition": form}, headers=headers).json()
    assert client.get(root).json()["definition"]["questions"][0]["id"] == "note"
    assert client.put(root, json={"revision": draft["revision"], "definition": form}, headers=headers).status_code == 409
    live = publish(client, headers, root, updated["revision"])
    v1 = client.get(participant).json()["version_id"]
    other, other_root, other_participant = created(client, headers, definition())
    other_live = publish(client, headers, other_root, other["revision"])
    assert client.post(participant + "/responses", json=attempt(other_live["current_version_id"], {"room": "a"})).status_code == 404
    assert client.post(other_participant + "/responses", json=attempt(v1, {"room": "a"})).status_code == 404

    unacceptable = client.post(participant + "/responses", json=attempt(v1, {"days": 1.5, "bad": "x"}))
    assert unacceptable.status_code == 422
    assert unacceptable.json()["detail"]["fields"].keys() == {"room", "days", "bad"}
    first = attempt(v1, {"room": "a", "days": -4, "note": '=1+1,"café"\nNext line'})
    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(lambda _: client.post(participant + "/responses", json=first), range(2)))
    assert [result.status_code for result in outcomes] == [200, 200]
    assert client.post(participant + "/responses", json={**first, "answers": {"room": "b"}}).status_code == 409

    form["questions"][-1]["label"] = "New room"
    form["questions"][-1]["options"][0]["label"] = "New kitchen"
    updated = client.put(root, json={"revision": live["revision"], "definition": form}, headers=headers).json()
    assert client.get(participant).json()["definition"]["questions"][-1]["label"] == "Original location"
    live2 = publish(client, headers, root, updated["revision"])
    v2 = client.get(participant).json()["version_id"]
    assert v2 != v1
    assert client.post(participant + "/responses", json=attempt(v1, {"room": "b", "days": 0})).status_code == 200
    assert client.post(participant + "/responses", json=attempt(v1, {"room": "a"})).status_code == 200
    assert client.post(participant + "/responses", json=attempt(v2, {"room": "a"})).status_code == 200

    latest = client.get(root + "/results").json()
    assert latest["survey"]["response_count"] == 4 and latest["version_total"] == 1
    assert latest["version"]["number"] == 2
    assert client.get(other_root + "/results").json()["survey"]["response_count"] == 0
    v1_results = client.get(root + "/results", params={"version_id": v1}).json()
    summary = {row["id"]: row for row in v1_results["summaries"]}
    assert summary["days"]["mean"] == -2 and summary["days"]["missing"] == 1
    assert summary["room"]["choices"] == [{"label": "Original kitchen", "count": 2}, {"label": "Hall", "count": 1}]
    selected_id = v1_results["responses"][-1]["id"]
    details = client.get(root + "/responses/" + selected_id).json()
    assert details["items"][-1]["question"]["label"] == "Original location"
    assert details["items"][-1]["value"] == "Original kitchen"
    assert client.get(other_root + "/responses/" + selected_id).status_code == 404
    assert client.get(other_root + "/exports/responses.csv", params={"version_id": v1}).status_code == 404
    for kind in ("responses", "codebook"):
        export = client.get(root + "/exports/" + kind + ".csv", params={"version_id": v1})
        assert export.status_code == 200 and "attachment" in export.headers["content-disposition"]
        rows = list(csv.DictReader(io.StringIO(export.text)))
        if kind == "responses":
            assert {row["days"] for row in rows} == {"", "-4", "0"}
            assert any(row["note"] == '\'=1+1,"café"\nNext line' for row in rows)
        else:
            assert rows[-1]["question"] == "Original location"
    assert client.post(root + "/close", json={"revision": live2["revision"]}, headers=headers).status_code == 200
    assert client.get(participant).status_code == 410
    assert client.post(participant + "/responses", json=attempt(v2, {"room": "a"})).status_code == 410
    assert client.post(participant + "/responses", json=first).status_code == 200
    assert client.request("DELETE", root, json={"revision": live2["revision"] + 1}, headers=headers).status_code == 409

    with TestClient(create_app(), base_url="https://testserver") as restarted:
        admin(restarted)
        surveys = restarted.get("/api/admin/surveys").json()
        assert len([row for row in surveys if row["is_demo"]]) == 1
        assert restarted.get(root + "/results").json()["survey"]["response_count"] == 4

    engine = create_engine(url, hide_parameters=True)
    try:
        with engine.connect() as db:
            assert db.scalar(select(func.count(Response.id)).where(Response.survey_id == UUID(draft["id"]))) == 4
        with pytest.raises(IntegrityError), engine.begin() as db:
            db.execute(Response.__table__.insert().values(
                survey_id=UUID(other["id"]), version_id=UUID(v1), submission_key=uuid4(), answers={},
            ))
    finally:
        engine.dispose()


def test_placeholder_credentials_fail_closed(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ADMIN_PASSWORD", "replace-with-a-local-password")
    monkeypatch.setenv("SESSION_SECRET", "synthetic-session-secret-for-integration")
    with pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
        create_app()
