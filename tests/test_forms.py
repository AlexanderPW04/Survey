import csv
import io
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from backend.exports import export_codebook, export_rows, summaries
from backend.forms import Definition, Question, definition_errors, demo_definition, validate_answers


def choice(key, kind):
    return {
        "id": key, "key": key, "type": kind, "label": 'A "label", with quotes',
        "options": [{"id": "a", "label": "Kitchen"}, {"id": "b", "label": "Hall"}], "other": True,
    }


def example():
    return Definition.model_validate({
        "title": "Example", "questions": [
            {"id": "note", "key": "note", "type": "long", "label": "Note"},
            {"id": "count", "key": "count", "type": "integer", "min": -5, "max": 10, "label": "Count"},
            {"id": "area", "key": "area", "type": "decimal", "unit": "cm²", "min": 0, "label": "Area"},
            {"id": "date", "key": "date", "type": "date", "label": "Date"},
            {"id": "yesno", "key": "yesno", "type": "yesno", "required": True, "label": "Yes or no"},
            {"id": "section", "key": "section", "type": "section", "label": "Section"},
            choice("room", "single"), choice("surfaces", "multiple"),
        ],
    }).model_dump()


def test_demo_is_publishable_and_repeatable():
    first, second = demo_definition(), demo_definition()
    assert first == second
    assert not definition_errors(first, publish=True)
    assert first.questions[3].min == 0


def test_unfinished_draft_and_distinct_options():
    definition = Definition(title="Draft", questions=[Question(id="q", key="q", type="dropdown", label="A")])
    assert not definition_errors(definition)
    assert "q" in definition_errors(definition, publish=True)


def test_answers_conditions_and_types():
    answers, errors = validate_answers(example(), {
        "note": 'First line, "quoted": café\nSecond line', "count": 0, "area": 0.25, "date": "2024-02-29",
        "yesno": False, "room": {"other": " Entry "}, "surfaces": ["b", "a"],
    })
    assert not errors
    assert answers == {
        "note": 'First line, "quoted": café\nSecond line', "count": 0, "area": 0.25, "date": "2024-02-29",
        "yesno": False, "room": {"other": "Entry"}, "surfaces": ["a", "b"],
    }


@pytest.mark.parametrize("answers, keys", [
    ({}, {"yesno"}),
    ({"yesno": 0, "count": False, "extra": 2}, {"yesno", "count", "extra"}),
    ({"yesno": True, "count": 1.5, "area": "2", "date": "2026-02-29"}, {"count", "area", "date"}),
    ({"yesno": False, "count": -6, "area": -1, "room": "unknown"}, {"count", "area", "room"}),
    ({"yesno": True, "area": float("inf"), "room": {"other": " "}}, {"area", "room"}),
    ({"yesno": True, "area": float("nan"), "surfaces": ["a", "a"], "section": "no"}, {"area", "surfaces", "section"}),
    ({"yesno": True, "note": "bad\x00value", "room": []}, {"note", "room"}),
])
def test_invalid_answers(answers, keys):
    assert validate_answers(example(), answers)[1].keys() == keys


def test_missing_and_checkbox_counts_with_zero_and_negative():
    data, total = summaries(example(), iter([
        {"yesno": False, "count": -4, "surfaces": ["a", "b"], "room": "a"},
        {"yesno": True, "count": 0, "surfaces": ["a", {"other": "Entry"}]},
        {"yesno": False},
    ]))
    by_id = {item["id"]: item for item in data}
    assert total == 3
    assert by_id["count"] == {"id": "count", "count": 2, "missing": 1, "minimum": -4, "maximum": 0, "mean": -2}
    assert by_id["area"]["mean"] is None
    assert [item["count"] for item in by_id["surfaces"]["choices"]] == [2, 1, 1]
    assert [item["count"] for item in by_id["yesno"]["choices"]] == [1, 2]


def test_csv_round_trip_and_formula_protection():
    definition = example()
    definition["questions"][0]["label"] = "=1+1"
    version = SimpleNamespace(id=uuid4(), survey_id=uuid4(), number=2, definition=definition)
    first = SimpleNamespace(
        id=uuid4(), submitted_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
        answers={"note": '=2+2,"café"\nsecond line', "count": -3, "yesno": False, "surfaces": ["a", "b"]},
    )
    second = SimpleNamespace(id=uuid4(), submitted_at=first.submitted_at, answers={"note": 'Regular, "quoted"\nline'})
    first_row, second_row = list(csv.DictReader(io.StringIO("".join(export_rows(version, [first, second])))))
    assert first_row["note"] == '\'=2+2,"café"\nsecond line'
    assert second_row["note"] == 'Regular, "quoted"\nline'
    assert first_row["count"] == "-3"
    assert first_row["yesno"] == "false"
    assert first_row["surfaces"] == '["Kitchen", "Hall"]'
    assert first_row["submitted_at_utc"] == "2026-01-02T03:04:05Z"
    assert first_row["area"] == second_row["count"] == ""
    codebook = {row["variable_key"]: row for row in csv.DictReader(io.StringIO(export_codebook(version)))}
    assert codebook["note"]["question"] == "'=1+1"
    assert codebook["room"]["question"] == 'A "label", with quotes'
    assert codebook["area"]["unit"] == "cm²"
    assert "section" not in codebook
