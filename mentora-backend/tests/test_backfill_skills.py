"""Tests for scripts/backfill_mentor_skills.py (pure planning logic)."""
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "backfill_mentor_skills.py"


@pytest.fixture
def backfill(monkeypatch):
    spec = importlib.util.spec_from_file_location("backfill_mentor_skills", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    texts = []
    monkeypatch.setattr(module, "embed_passage", lambda text: texts.append(text) or [0.1] * 4)
    monkeypatch.setattr(module, "embed_passages", lambda items: [[0.2] * 4 for _ in items])
    module.embedded_texts = texts
    return module


def _seed(backfill, name="Ava Chen"):
    return next(m for m in backfill.MENTORS if m["name"] == name)


def test_unclaimed_seeded_mentor_gets_seed_skills_and_is_reembedded_with_them(backfill):
    seed = _seed(backfill)
    doc = {"name": seed["name"], "email": seed["email"], "domain": "Fintech", "stage_focus": "idea",
           "expertise": seed["expertise"], "skills": ["stale"], "seeded": True}
    update = backfill.planned_update(doc, backfill._seed_by_email())
    assert update["skills"] == seed["skills"]
    assert update["skill_embeddings"] == [[0.2] * 4] * len(seed["skills"])
    assert update["embedding"] == [0.1] * 4
    assert "Skills: " + ", ".join(seed["skills"]) in backfill.embedded_texts[0]


def test_seeded_mentor_with_changed_email_is_found_by_name(backfill):
    seed = _seed(backfill, "Priya Nair")
    doc = {"name": "Priya Nair", "email": "demo@smoke.dev", "seeded": True, "user_id": "u1", "domain": "HealthTech"}
    assert backfill.planned_update(doc, backfill._seed_by_email())["skills"] == seed["skills"]


def test_registered_mentor_keeps_own_skills_or_none(backfill):
    seeds = backfill._seed_by_email()
    own = {"name": "Mentor 1", "email": "m1@example.com", "user_id": "u", "skills": [" Hiring ", ""]}
    assert backfill.planned_update(own, seeds)["skills"] == ["Hiring"]
    none = {"name": "Mentor 2", "email": "m2@example.com", "user_id": "u2", "bio": "Operator."}
    update = backfill.planned_update(none, seeds)
    assert update["skills"] == [] and update["skill_embeddings"] == []
    assert "Bio: Operator." in backfill.embedded_texts[-1]
