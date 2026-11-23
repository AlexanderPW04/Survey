from datetime import date
from math import isfinite
from typing import Annotated, Literal
from uuid import UUID, uuid5, NAMESPACE_URL

from pydantic import BaseModel, ConfigDict, Field, field_validator

IDENTIFIER = r"^[a-zA-Z0-9_-]{1,80}$"
VARIABLE_KEY = r"^[a-z][a-z0-9_]{0,63}$"
Identifier = Annotated[str, Field(pattern=IDENTIFIER)]
OptionText = Annotated[str, Field(max_length=160)]
Kind = Literal["short", "long", "single", "dropdown", "multiple", "yesno", "integer", "decimal", "date", "section"]
CHOICES = {"single", "dropdown", "multiple"}
NUMBERS = {"integer", "decimal"}
OTHER = "__other__"
NUMBER_LIMIT = 1_000_000_000_000
EXPORT_METADATA = {"response_id", "submitted_at_utc", "survey_id", "version_id", "version"}


def safe_text(value):
    if "\x00" in value:
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


class FormModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    @field_validator("*")
    @classmethod
    def check_text(cls, value):
        if isinstance(value, str) and not safe_text(value):
            raise ValueError("Enter valid text.")
        return value


class Option(FormModel):
    id: Identifier
    label: OptionText


class Question(FormModel):
    id: Identifier
    key: Annotated[str, Field(pattern=VARIABLE_KEY)]
    type: Kind
    label: Annotated[str, Field(max_length=240)] = ""
    help: Annotated[str, Field(max_length=500)] = ""
    required: bool = False
    options: list[Option] = Field(default_factory=list, max_length=30)
    other: bool = False
    unit: Annotated[str, Field(max_length=40)] = ""
    min: float | None = Field(default=None, ge=-NUMBER_LIMIT, le=NUMBER_LIMIT)
    max: float | None = Field(default=None, ge=-NUMBER_LIMIT, le=NUMBER_LIMIT)


class Definition(FormModel):
    title: Annotated[str, Field(max_length=160)] = ""
    description: Annotated[str, Field(max_length=2000)] = ""
    questions: list[Question] = Field(default_factory=list, max_length=60)


class DraftSave(FormModel):
    revision: int = Field(ge=1)
    definition: Definition


class Revision(FormModel):
    revision: int = Field(ge=1)


class Password(FormModel):
    password: str = Field(min_length=1, max_length=1024)


class Submission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_id: UUID
    submission_key: UUID
    answers: dict[Identifier, object] = Field(max_length=60)


class PreviewSubmission(FormModel):
    definition: Definition
    answers: dict[Identifier, object] = Field(max_length=60)


def definition_errors(definition: Definition, publish: bool = False) -> dict[str, str]:
    errors = {}
    if not definition.title.strip():
        errors["title"] = "Enter a survey name."
    questions = definition.questions
    if publish and not any(q.type != "section" for q in questions):
        errors["questions"] = "Add at least one question."
    ids = {q.id for q in questions}
    keys = {q.key for q in questions}
    if len(ids) != len(questions) or len(keys) != len(questions) or keys & EXPORT_METADATA:
        errors["questions"] = "Each question needs a unique variable key."
    for question in questions:
        option_ids = {option.id for option in question.options}
        if (
            len(option_ids) != len(question.options) or OTHER in option_ids
            or (question.options or question.other) and question.type not in CHOICES
            or (question.unit or question.min is not None or question.max is not None)
            and question.type not in NUMBERS
            or question.type == "section" and question.required
        ):
            errors[question.id] = "Check this question's settings."
            continue
        has_text = question.label.strip() or (question.type == "section" and question.help.strip())
        if publish and not has_text:
            errors[question.id] = "Enter the wording for this question."
        elif publish and question.type in CHOICES and (
            len(question.options) + int(question.other) < 2
            or any(not option.label.strip() for option in question.options)
            or len({option.label.strip().casefold() for option in question.options}) != len(question.options)
            or (question.other and any(option.label.strip().casefold() == "other" for option in question.options))
        ):
            errors[question.id] = "Enter at least two distinct choices."
        elif question.min is not None and question.max is not None and question.min > question.max:
            errors[question.id] = "The minimum must be less than or equal to the maximum."
        elif question.type == "integer" and any(
            bound is not None and not bound.is_integer() for bound in (question.min, question.max)
        ):
            errors[question.id] = "Enter whole numbers for the limits."
    return errors


def valid_choice(question: dict, answer, ids: set[str]):
    if isinstance(answer, str) and answer in ids:
        return answer
    if question["other"] and isinstance(answer, dict) and set(answer) == {"other"}:
        text = answer["other"]
        if isinstance(text, str) and 0 < len(text.strip()) <= 500 and safe_text(text):
            return {"other": text.strip()}
    raise ValueError("Choose an option and fill in Other if selected.")


def validate_value(question: dict, value):
    kind = question["type"]
    if kind in {"short", "long"}:
        max_length = 300 if kind == "short" else 3000
        if isinstance(value, str) and len(value.strip()) <= max_length and safe_text(value):
            return value.strip()
        raise ValueError(f"Enter text of {max_length} characters or fewer.")
    if kind in CHOICES:
        ids = {option["id"] for option in question["options"]}
        if kind != "multiple":
            return valid_choice(question, value, ids)
        if not isinstance(value, list) or len(value) > len(ids) + int(question["other"]):
            raise ValueError("Choose one or more options.")
        selected = {}
        for item in value:
            option = valid_choice(question, item, ids)
            key = option if isinstance(option, str) else OTHER
            if key in selected:
                raise ValueError("Choose each option only once.")
            selected[key] = option
        order = [option["id"] for option in question["options"]] + [OTHER]
        return [selected[key] for key in order if key in selected]
    if kind == "yesno":
        if type(value) is bool:
            return value
        raise ValueError("Choose Yes or No.")
    if kind == "date":
        if isinstance(value, str) and len(value) == 10:
            try:
                parsed = date.fromisoformat(value)
                if parsed.isoformat() == value:
                    return value
            except ValueError:
                pass
        raise ValueError("Enter a valid date.")
    if kind in NUMBERS:
        if (
            type(value) not in {int, float}
            or not -NUMBER_LIMIT <= value <= NUMBER_LIMIT
            or not isfinite(value)
        ):
            raise ValueError("Enter a whole number." if kind == "integer" else "Enter a valid number.")
        if kind == "integer" and value != int(value):
            raise ValueError("Enter a whole number.")
        if question["min"] is not None and value < question["min"]:
            raise ValueError(f"Enter a value of {question['min']:g} or more.")
        if question["max"] is not None and value > question["max"]:
            raise ValueError(f"Enter a value of {question['max']:g} or less.")
        return int(value) if kind == "integer" else value
    raise ValueError("This field does not collect an answer.")


def validate_answers(definition: dict, answers: dict):
    questions = {question["id"]: question for question in definition["questions"] if question["type"] != "section"}
    errors = {key: "This question is not in the survey." for key in answers if key not in questions}
    normalized = {}
    for key, question in questions.items():
        value = answers.get(key)
        absent = value is None or (isinstance(value, str) and not value.strip()) or value == []
        if absent:
            if question["required"]:
                errors[key] = "Answer this question." if question["type"] not in CHOICES else "Choose an option."
            elif value is not None and (
                isinstance(value, str) and question["type"] not in {"short", "long"}
                or value == [] and question["type"] != "multiple"
            ):
                errors[key] = "Enter a valid answer."
            continue
        try:
            normalized[key] = validate_value(question, value)
        except ValueError as exc:
            errors[key] = str(exc)
    return normalized, errors


def demo_definition():
    def uid(key):
        return str(uuid5(NAMESPACE_URL, f"dust-demo:{key}"))

    def question(key, kind, label, choices=(), **settings):
        return Question(
            id=uid(key), key=key, type=kind, label=label,
            options=[Option(id=uid(f"{key}:{label}"), label=label) for label in choices],
            **settings,
        )

    return Definition(
        title="Dust Collection Location Survey — Demonstration",
        description="Tell us where the dust sample was collected. Please leave out names and addresses.",
        questions=[
            question("collection_code", "short", "Collection code", required=True),
            question("collection_area", "single", "Collection area",
                     ("Bedroom", "Living room", "Kitchen", "Hallway"), other=True, required=True),
            question("surface", "dropdown", "Collection surface",
                     ("Carpet", "Hard floor", "Furniture or shelf"), other=True, required=True),
            question("days_since_cleaning", "integer", "Days since the area was last cleaned", min=0, unit="days"),
            question("sampled_area", "decimal", "Approximate sampled area", min=0, unit="cm²"),
            question("collection_date", "date", "Collection date"),
            question("observations", "long", "Additional observations"),
        ],
    )
