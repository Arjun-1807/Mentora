"""
Startup health score.

After a mentor meeting either side logs an outcome (POST /health/log),
stored in the `meeting_notes` collection. The startup's health score is
recomputed from its **last 5** meeting notes:

    health_score = (avg_momentum / 5 × 0.5
                    + avg_engagement / 5 × 0.3
                    + resolved_rate × 0.2) × 100

where `avg_momentum` / `avg_engagement` are the mean 1-5 ratings and
`resolved_rate` is the share (0-1) of notes with `blockers_resolved`.

This is the *normalised* form of the spec's
`(avg_momentum × 0.5 + avg_engagement × 0.3 + resolved_rate × 0.2) × 20`,
which mixes 1-5 averages with a 0-1 rate so that a perfect 5/5/100 %
scores only 84. Dividing the averages by 5 makes every factor 0-1, so the
weights sum to 1 and a perfect record scores exactly 100. (The minimum
reachable score is 16: ratings of 1/5 with no blockers resolved.)

Trend compares the new score with the previous `health_history` entry:
"up" if it rose by >= 5 points, "down" if it fell by >= 5, else "stable".
"""
from typing import Any, Dict, Iterable, Optional

MOMENTUM_WEIGHT = 0.5
ENGAGEMENT_WEIGHT = 0.3
RESOLVED_WEIGHT = 0.2
NOTES_WINDOW = 5
TREND_THRESHOLD = 5.0
HISTORY_LIMIT = 10           # entries returned by the API
HISTORY_STORE_LIMIT = 100    # entries kept on the user document


def compute_health_score(notes: Iterable[Dict[str, Any]]) -> Optional[float]:
    """Normalised 0-100 health score from meeting notes (None if there are none)."""
    notes = list(notes)
    if not notes:
        return None
    count = len(notes)
    avg_momentum = sum(float(n.get("momentum_score") or 0) for n in notes) / count
    avg_engagement = sum(float(n.get("mentor_engagement") or 0) for n in notes) / count
    resolved_rate = sum(1 for n in notes if n.get("blockers_resolved") is True) / count

    score = (
        (avg_momentum / 5.0) * MOMENTUM_WEIGHT
        + (avg_engagement / 5.0) * ENGAGEMENT_WEIGHT
        + resolved_rate * RESOLVED_WEIGHT
    ) * 100.0
    return round(min(100.0, max(0.0, score)), 1)


def compute_trend(new_score: Optional[float], previous_score: Optional[float]) -> str:
    if new_score is None or previous_score is None:
        return "stable"
    delta = float(new_score) - float(previous_score)
    if delta >= TREND_THRESHOLD:
        return "up"
    if delta <= -TREND_THRESHOLD:
        return "down"
    return "stable"
