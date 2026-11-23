import csv
import io
import json
from datetime import timezone

from backend.forms import CHOICES, NUMBERS, OTHER


def utc_time(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def choice_label(question, selection):
    if isinstance(selection, dict):
        return f"Other: {selection['other']}"
    return next(option["label"] for option in question["options"] if option["id"] == selection)


def answer_label(question, value):
    if value is None:
        return None
    if question["type"] == "multiple":
        return [choice_label(question, item) for item in value]
    if question["type"] in CHOICES:
        return choice_label(question, value)
    return value


def summaries(definition, rows):
    questions = {q["id"]: q for q in definition["questions"] if q["type"] != "section"}
    result = {key: {"id": key, "count": 0} for key in questions}
    choices, sums = {}, {}
    for key, question in questions.items():
        kind = question["type"]
        if kind in NUMBERS:
            result[key].update(minimum=None, maximum=None, mean=None)
            sums[key] = 0
        elif kind == "yesno":
            choices[key] = {True: {"label": "Yes", "count": 0}, False: {"label": "No", "count": 0}}
        elif kind in CHOICES:
            choices[key] = {
                option["id"]: {"label": option["label"], "count": 0} for option in question["options"]
            }
            if question["other"]:
                choices[key][OTHER] = {"label": "Other", "count": 0}

    total = 0
    for row in rows:
        total += 1
        for key, value in row.items():
            data = result[key]
            data["count"] += 1
            if key in sums:
                sums[key] += value
                data["minimum"] = min(value, data["minimum"]) if data["minimum"] is not None else value
                data["maximum"] = max(value, data["maximum"]) if data["maximum"] is not None else value
            elif key in choices:
                selected = value if isinstance(value, list) else [value]
                for item in selected:
                    choices[key][OTHER if isinstance(item, dict) else item]["count"] += 1

    for key, data in result.items():
        data["missing"] = total - data["count"]
        if key in sums and data["count"]:
            data["mean"] = sums[key] / data["count"]
        if key in choices:
            data["choices"] = list(choices[key].values())
    return list(result.values()), total


def safe_cell(value):
    if isinstance(value, str) and (
        value.startswith(("\t", "\r", "\n"))
        or value.lstrip().startswith(("=", "+", "-", "@", "＝", "＋", "－", "＠"))
    ):
        return "'" + value
    return value


def export_rows(version, responses):
    questions = [q for q in version.definition["questions"] if q["type"] != "section"]
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["response_id", "submitted_at_utc", "survey_id", "version_id", "version", *[q["key"] for q in questions]])
    for response in responses:
        values = []
        for question in questions:
            value = answer_label(question, response.answers.get(question["id"]))
            if isinstance(value, (list, bool)):
                value = json.dumps(value, ensure_ascii=False)
            values.append(safe_cell(value))
        writer.writerow([
            response.id, utc_time(response.submitted_at), version.survey_id, version.id,
            version.number, *values,
        ])
        yield output.getvalue()
        output.seek(0)
        output.truncate()
    if output.tell():
        yield output.getvalue()


def export_codebook(version):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["variable_key", "question", "type", "required", "options_json", "unit", "min", "max", "help"])
    for question in version.definition["questions"]:
        if question["type"] == "section":
            continue
        options = [option["label"] for option in question["options"]]
        if question["other"]:
            options.append("Other")
        if question["type"] == "yesno":
            options = ["true", "false"]
        writer.writerow([
            safe_cell(question["key"]), safe_cell(question["label"]), question["type"],
            "yes" if question["required"] else "no", json.dumps(options, ensure_ascii=False),
            safe_cell(question["unit"]), question["min"], question["max"], safe_cell(question["help"]),
        ])
    return output.getvalue()
