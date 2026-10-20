"""Sanity checks on the offline eval fixture used by scripts/eval_matching.py."""
import json
from pathlib import Path

from app.models.schemas import StartupProfile

FIXTURE = Path(__file__).parent / "fixtures" / "eval_set.json"


def _load():
    with open(FIXTURE) as fh:
        return json.load(fh)


def test_eval_set_has_enough_valid_profiles():
    data = _load()
    profiles = data["profiles"]
    assert len(profiles) >= 30
    assert len({p["id"] for p in profiles}) == len(profiles)
    sources = {p["source"] for p in profiles}
    assert "deck:test_decks/GreenHaul.pdf" in sources and "deck:test_decks/SkillBridge.pdf" in sources
    for item in profiles:
        StartupProfile.model_validate(item["profile"])


def test_eval_set_grades_are_keyed_by_judged_emails():
    data = _load()
    judged = set(data["judged_mentors"])
    assert len(judged) == 15
    for item in data["profiles"]:
        assert item["relevance"], f"{item['id']} has no relevant mentor"
        for email, grade in item["relevance"].items():
            assert email in judged, (item["id"], email)
            assert grade in (1, 2), (item["id"], email, grade)
