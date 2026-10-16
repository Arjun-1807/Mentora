"""
Offline evaluation of the mentor-matching pipeline against the graded eval
set in tests/fixtures/eval_set.json.

Runs the REAL pipeline (BGE query embedding + Atlas $vectorSearch + the
re-rank in app/services/mentor_matching.py) for every profile in the set
and prints P@5, graded nDCG@5, MRR and the top-1 to top-5 score spread,
next to the committed baseline in tests/fixtures/eval_baseline.json.

Usage (from mentora-backend/, with MONGODB_DB_NAME pointing at a staging
copy of the mentors collection):

    venv/bin/python scripts/eval_matching.py                 # compare to baseline
    venv/bin/python scripts/eval_matching.py --save-baseline # overwrite the baseline
    venv/bin/python scripts/eval_matching.py --record final  # store a named run next to it
    venv/bin/python scripts/eval_matching.py -v              # per-profile rankings

Only reads from the database. It refuses to run against the shared
`mentora` database unless --allow-prod-db is given.

Metric definitions (see the fixture's `rubric` and app/services/evaluation.py):
  * Mentors not in the fixture's `judged_mentors` (real accounts) are dropped
    from the ranking before scoring (condensed-list evaluation).
  * P@5   - share of the top 5 judged mentors with grade >= 1.
  * nDCG@5 - graded, gain 2^grade - 1.
  * MRR   - 1 / rank of the first grade-2 mentor (grade >= 1 when a profile
            has no grade-2 mentor).
  * spread - top-1 minus top-5 match_score of what the user actually sees
            (unjudged mentors included); reported as mean and std over
            profiles.
"""
import argparse
import json
import os
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import settings  # noqa: E402
from app.db.mongo import get_mentors_collection  # noqa: E402
from app.models.schemas import StartupProfile  # noqa: E402
from app.services import mentor_matching  # noqa: E402
from app.services.evaluation import (  # noqa: E402
    graded_ndcg_at_k,
    precision_at_k,
    reciprocal_rank,
    score_spread,
)

EVAL_SET_PATH = BACKEND_ROOT / "tests" / "fixtures" / "eval_set.json"
BASELINE_PATH = BACKEND_ROOT / "tests" / "fixtures" / "eval_baseline.json"
K = 5
PROTECTED_DB_NAMES = {"mentora"}
METRICS = ("p_at_5", "ndcg_at_5", "mrr", "spread_mean", "spread_std")


def _load_eval_set() -> dict:
    with open(EVAL_SET_PATH) as fh:
        return json.load(fh)


def _mentor_emails() -> Dict[str, str]:
    """mentor _id (str) -> lower-cased email for every mentor in the DB."""
    return {
        str(doc["_id"]): (doc.get("email") or "").strip().lower()
        for doc in get_mentors_collection().find({}, {"email": 1})
    }


def _full_ranking(profile: StartupProfile):
    """Every candidate the pipeline scores, best first (not just the top 5)."""
    original = mentor_matching.TOP_K_RESULTS
    mentor_matching.TOP_K_RESULTS = 10_000
    try:
        return mentor_matching.find_matching_mentors(profile)
    finally:
        mentor_matching.TOP_K_RESULTS = original


def evaluate(verbose: bool = False) -> dict:
    eval_set = _load_eval_set()
    judged = {email.lower() for email in eval_set["judged_mentors"]}
    emails = _mentor_emails()
    missing = judged - set(emails.values())
    if missing:
        print(f"WARNING: judged mentors missing from the database: {sorted(missing)}", file=sys.stderr)

    per_profile = []
    for item in eval_set["profiles"]:
        profile = StartupProfile.model_validate(item["profile"])
        grades = {email.lower(): grade for email, grade in item["relevance"].items()}
        ranking = _full_ranking(profile)
        shown = ranking[:K]
        condensed = [emails.get(m.mentor_id, "") for m in ranking]
        condensed = [email for email in condensed if email in judged][:K]

        relevant = [email for email, grade in grades.items() if grade >= 1]
        best = [email for email, grade in grades.items() if grade >= 2] or relevant
        row = {
            "id": item["id"],
            "p_at_5": precision_at_k(condensed, relevant, K),
            "ndcg_at_5": graded_ndcg_at_k(condensed, grades, K),
            "mrr": reciprocal_rank(condensed, best),
            "spread": score_spread([m.match_score for m in shown], K),
            "top1": shown[0].name if shown else None,
            "top1_domain": shown[0].domain if shown else None,
            "top5_scores": [m.match_score for m in shown],
            "top5_judged": [(email.split("@")[0], grades.get(email, 0)) for email in condensed],
        }
        per_profile.append(row)
        if verbose:
            print(
                f"{row['id']:13s} P@5={row['p_at_5']:.2f} nDCG={row['ndcg_at_5']:.3f} MRR={row['mrr']:.2f} "
                f"spread={row['spread']:.3f} top1={row['top1']} ({row['top1_domain']})"
            )
            print("    ", " ".join(f"{name}:{g}" for name, g in row["top5_judged"]),
                  " scores:", [round(s, 3) for s in row["top5_scores"]])
            for m in shown:
                if getattr(m, "reasons", None):
                    print("      ", m.name, "|", "; ".join(m.reasons))

    spreads = [row["spread"] for row in per_profile]
    metrics = {
        "p_at_5": statistics.fmean(row["p_at_5"] for row in per_profile),
        "ndcg_at_5": statistics.fmean(row["ndcg_at_5"] for row in per_profile),
        "mrr": statistics.fmean(row["mrr"] for row in per_profile),
        "spread_mean": statistics.fmean(spreads),
        "spread_std": statistics.pstdev(spreads),
    }
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "db": settings.MONGODB_DB_NAME,
        "profiles": len(per_profile),
        "metrics": {key: round(value, 4) for key, value in metrics.items()},
        "per_profile": [
            {
                "id": row["id"],
                "p_at_5": round(row["p_at_5"], 4),
                "ndcg_at_5": round(row["ndcg_at_5"], 4),
                "mrr": round(row["mrr"], 4),
                "spread": round(row["spread"], 4),
                "top1": row["top1"],
                "top1_domain": row["top1_domain"],
            }
            for row in per_profile
        ],
    }


def _load_baseline_file() -> dict:
    if BASELINE_PATH.exists():
        with open(BASELINE_PATH) as fh:
            return json.load(fh)
    return {}


def _write_baseline_file(data: dict) -> None:
    with open(BASELINE_PATH, "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")


def _print_table(result: dict, stored: dict) -> None:
    columns = []
    if stored.get("baseline"):
        columns.append(("baseline", stored["baseline"]["metrics"]))
    for name, run in (stored.get("runs") or {}).items():
        columns.append((name, run["metrics"]))
    columns.append(("current", result["metrics"]))

    header = f"{'metric':12s}" + "".join(f"{name:>16s}" for name, _ in columns)
    print(header)
    print("-" * len(header))
    for metric in METRICS:
        print(f"{metric:12s}" + "".join(f"{values.get(metric, float('nan')):>16.4f}" for _, values in columns))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--save-baseline", action="store_true", help="store this run as the baseline")
    parser.add_argument("--record", metavar="NAME", help="store this run under runs[NAME] next to the baseline")
    parser.add_argument("--allow-prod-db", action="store_true", help="allow running against the `mentora` DB")
    parser.add_argument("-v", "--verbose", action="store_true", help="print per-profile results")
    args = parser.parse_args()

    if settings.MONGODB_DB_NAME in PROTECTED_DB_NAMES and not args.allow_prod_db:
        print(
            f"Refusing to run against the shared {settings.MONGODB_DB_NAME!r} database; set "
            "MONGODB_DB_NAME=mentora_staging (or pass --allow-prod-db).",
            file=sys.stderr,
        )
        return 2

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    result = evaluate(verbose=args.verbose)
    stored = _load_baseline_file()

    if args.save_baseline:
        stored["baseline"] = result
        stored.setdefault("runs", {})
        _write_baseline_file(stored)
        print(f"Baseline written to {BASELINE_PATH.relative_to(BACKEND_ROOT)}")
    if args.record:
        stored.setdefault("runs", {})[args.record] = result
        _write_baseline_file(stored)
        print(f"Run {args.record!r} written to {BASELINE_PATH.relative_to(BACKEND_ROOT)}")

    print(f"\n{result['profiles']} profiles, db={result['db']}\n")
    _print_table(result, stored)
    return 0


if __name__ == "__main__":
    sys.exit(main())
