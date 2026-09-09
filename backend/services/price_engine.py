# ─── Price Intelligence Engine ───────────────────────────────────────────────
from __future__ import annotations

import re
import statistics
from typing import Any, Optional
from pydantic import BaseModel, Field

# ─── Pydantic Models ─────────────────────────────────────────────────────────
class PriceSample(BaseModel):
    value: float
    value_max: Optional[float] = None
    unit: Optional[str] = "INR"
    context: str = "meal"  # meal | entry | item | range
    source: str = "web"
    url: Optional[str] = None
    date: Optional[str] = None
    raw_snippet: Optional[str] = None
    confidence: float = 0.5


class PriceHint(BaseModel):
    mode: str = "meal"  # meal | entry | item | mixed
    min: float
    max: float
    per_person: Optional[float] = None  # median of normalized samples
    samples: list[PriceSample] = Field(default_factory=list)
    confidence: float = 0.0  # 0..1


# ─── Plausibility Gates ──────────────────────────────────────────────────────
PLAUSIBILITY_GATES: dict[str, tuple[float, float]] = {
    "item": (5.0, 400.0),
    "meal": (30.0, 3500.0),
    "entry": (0.0, 600.0),
    "adventure": (200.0, 10000.0),
    "nature": (0.0, 1000.0),
    "culture": (0.0, 1000.0),
    "workshop": (100.0, 5000.0),
    "market": (5.0, 3000.0),
    "default": (0.0, 8000.0),
}


# ─── Regex Patterns ──────────────────────────────────────────────────────────
FREE_PATTERNS = [
    r"\bfree\s+entry\b",
    r"\bentry\s+free\b",
    r"\bno\s+entry\s+fees?\b",
    r"\bno\s+entry\s+charges?\b",
    r"\bentry\s+is\s+(?:typically\s+)?free\b",
    r"\bfree\s+of\s+charge\b",
    r"\bno\s+tickets?\s+required\b",
    r"\bno\s+tickets?\b",
    r"\bno\s+entrance\s*fees?\b",
    r"\badmission\s+free\b",
    r"\bfree\s+admission\b",
    r"\bentry\b[^\.\n]{0,30}\bfree\b",
    r"\bfree\b[^\.\n]{0,30}\b(entry|visit|admission)\b",
]

# Number pattern matching 500, 1,200, 1.5k, 2k
NUM_PATTERN = r"(?:\d+(?:\.\d+)?k|\d+(?:,\d+)*(?:\.\d+)?)"

# Range regex: e.g. ₹200–300, ₹200-300, ₹200 to 300, Rs. 150 to 250
RANGE_RE = re.compile(
    rf"(?:₹|rs\.?|inr)\s*({NUM_PATTERN})\s*(?:[-–—]|to)\s*(?:₹|rs\.?|inr)?\s*({NUM_PATTERN})(?:\s*/-|\s*rupees)?",
    re.IGNORECASE,
)

# Single price regex:
# Pattern 1: ₹500, Rs. 500, Rs 500/-, INR 500, ₹ 1.5k
# Pattern 2: 500/-, 500 rupees, 500 rs, 500rs, 1.5k per person
PRICE_PREFIX_RE = re.compile(
    rf"(?:₹|rs\.?|inr)\s*({NUM_PATTERN})(?:\s*/-)?",
    re.IGNORECASE,
)
PRICE_SUFFIX_RE = re.compile(
    rf"({NUM_PATTERN})\s*(?:/-|rupees|rs\.?|₹)",
    re.IGNORECASE,
)

# Reject words: years without currency, ratings, timings, distances, lakh/crore
REJECT_WORDS_RE = re.compile(r"\b(lakhs?|crores?|km|kms|meters?|am|pm|o'clock|stars?|rating)\b", re.IGNORECASE)


def _clean_number(val_str: str) -> Optional[float]:
    """Parse string representation of number, handling 'k' and commas."""
    s = val_str.strip().lower().replace(",", "")
    if s.endswith("k"):
        try:
            return float(s[:-1]) * 1000.0
        except ValueError:
            return None
    try:
        return float(s)
    except ValueError:
        return None


def _classify_context(window_text: str) -> str:
    """Classify the context (±120 chars) into entry, meal, item, or general."""
    text = window_text.lower()

    # Entry cues
    entry_score = 0
    for cue in ["entry", "ticket", "entrance", "admission", "pass", "entry fee", "entry ticket", "adult", "child ticket"]:
        if cue in text:
            entry_score += 2 if cue in ["entry fee", "entry ticket", "entrance fee", "admission"] else 1

    # Meal cues
    meal_score = 0
    for cue in ["per person", "per head", "pp", "for two", "thali", "meal", "dinner", "lunch", "buffet", "cost for two", "dinner for", "food for", "buffet is"]:
        if cue in text:
            meal_score += 2 if cue in ["per person", "per head", "for two", "cost for two", "thali", "buffet"] else 1

    # Item cues
    item_score = 0
    for cue in ["chai", "tea", "coffee", "plate", "vada", "samosa", "snack", "per cup", "per plate", "dosa", "pav", "dish", "bowl", "drink"]:
        if cue in text:
            item_score += 2 if cue in ["per plate", "per cup", "chai", "samosa", "vada", "dosa"] else 1

    if entry_score > meal_score and entry_score > item_score:
        return "entry"
    if item_score > entry_score and item_score > meal_score:
        return "item"
    if meal_score >= entry_score:
        return "meal"
    return "meal"


def parse_price_snippets(
    text: str,
    source: str = "web",
    url: Optional[str] = None,
    category: Optional[str] = None,
) -> list[PriceSample]:
    """Extract and validate price samples from a piece of text."""
    if not text:
        return []

    samples: list[PriceSample] = []
    text_lower = text.lower()
    matched_spans: list[tuple[int, int]] = []

    # 1. Explicit free entry check
    for fp in FREE_PATTERNS:
        match = re.search(fp, text_lower)
        if match:
            start, end = match.span()
            window = text[max(0, start - 100) : min(len(text), end + 100)]
            samples.append(
                PriceSample(
                    value=0.0,
                    value_max=0.0,
                    unit="INR",
                    context="entry",
                    source=source,
                    url=url,
                    raw_snippet=window.strip()[:140],
                    confidence=0.9,
                )
            )
            matched_spans.append((start, end))

    # 2. Price ranges (₹200–300, Rs 150 to 250)
    for m in RANGE_RE.finditer(text):
        start, end = m.span()
        window = text[max(0, start - 120) : min(len(text), end + 120)]

        if REJECT_WORDS_RE.search(window):
            continue

        v1 = _clean_number(m.group(1))
        v2 = _clean_number(m.group(2))
        if v1 is None or v2 is None or v1 < 0 or v2 < 0:
            continue

        vmin, vmax = min(v1, v2), max(v1, v2)

        # Reject years without currency symbol
        if 1900 <= vmin <= 2099 and 1900 <= vmax <= 2099 and "₹" not in m.group(0) and "rs" not in m.group(0).lower():
            continue

        context = _classify_context(window)
        if "for two" in window.lower() or "cost for two" in window.lower():
            vmin = round(vmin / 2.0)
            vmax = round(vmax / 2.0)
            context = "meal"

        gate_cat = category or context
        min_g, max_g = PLAUSIBILITY_GATES.get(gate_cat, PLAUSIBILITY_GATES["default"])
        if not (min_g <= vmin <= max_g) and not (min_g <= vmax <= max_g * 1.5):
            continue

        samples.append(
            PriceSample(
                value=vmin,
                value_max=vmax,
                unit="INR",
                context=context,
                source=source,
                url=url,
                raw_snippet=window.strip()[:140],
                confidence=0.85,
            )
        )
        matched_spans.append((start, end))

    # Helper: check if a span overlaps already matched spans
    def is_overlapping(s: int, e: int) -> bool:
        for ms, me in matched_spans:
            if not (e <= ms or s >= me):
                return True
        return False

    # 3. Single prices: Prefix (₹500, Rs. 500)
    for m in PRICE_PREFIX_RE.finditer(text):
        start, end = m.span()
        if is_overlapping(start, end):
            continue

        window = text[max(0, start - 120) : min(len(text), end + 120)]
        if REJECT_WORDS_RE.search(window):
            continue

        v = _clean_number(m.group(1))
        if v is None:
            continue

        if 1900 <= v <= 2099 and "₹" not in m.group(0) and "rs" not in m.group(0).lower():
            continue

        context = _classify_context(window)
        if "for two" in window.lower() or "cost for two" in window.lower():
            v = round(v / 2.0)
            context = "meal"

        gate_cat = category or context
        min_g, max_g = PLAUSIBILITY_GATES.get(gate_cat, PLAUSIBILITY_GATES["default"])
        if not (min_g <= v <= max_g):
            continue

        samples.append(
            PriceSample(
                value=v,
                value_max=None,
                unit="INR",
                context=context,
                source=source,
                url=url,
                raw_snippet=window.strip()[:140],
                confidence=0.75,
            )
        )
        matched_spans.append((start, end))

    # 4. Single prices: Suffix (500/-, 500 rupees, 500 rs)
    for m in PRICE_SUFFIX_RE.finditer(text):
        start, end = m.span()
        if is_overlapping(start, end):
            continue

        window = text[max(0, start - 120) : min(len(text), end + 120)]
        if REJECT_WORDS_RE.search(window):
            continue

        v = _clean_number(m.group(1))
        if v is None:
            continue

        context = _classify_context(window)
        if "for two" in window.lower() or "cost for two" in window.lower():
            v = round(v / 2.0)
            context = "meal"

        gate_cat = category or context
        min_g, max_g = PLAUSIBILITY_GATES.get(gate_cat, PLAUSIBILITY_GATES["default"])
        if not (min_g <= v <= max_g):
            continue

        samples.append(
            PriceSample(
                value=v,
                value_max=None,
                unit="INR",
                context=context,
                source=source,
                url=url,
                raw_snippet=window.strip()[:140],
                confidence=0.7,
            )
        )
        matched_spans.append((start, end))

    # 5. Bare 'k' after number with explicit per person / buffet cue (e.g. "1.5k per person")
    bare_k_match = re.finditer(r"(\d+(?:\.\d+)?k)\s*(?:per\s+person|per\s+head|pp|buffet)", text, re.IGNORECASE)
    for m in bare_k_match:
        start, end = m.span()
        if is_overlapping(start, end):
            continue
        v = _clean_number(m.group(1))
        if v is not None:
            window = text[max(0, start - 100) : min(len(text), end + 100)]
            context = _classify_context(window)
            samples.append(
                PriceSample(
                    value=v,
                    value_max=None,
                    unit="INR",
                    context=context,
                    source=source,
                    url=url,
                    raw_snippet=window.strip()[:140],
                    confidence=0.75,
                )
            )
            matched_spans.append((start, end))

    return samples


def aggregate_price_hint(
    samples: list[PriceSample],
    category: Optional[str] = None,
) -> Optional[PriceHint]:
    """Aggregate parsed price samples into a robust PriceHint or None."""
    if not samples:
        return None

    valid_samples = [s for s in samples if s.value >= 0]
    if not valid_samples:
        return None

    values: list[float] = []
    for s in valid_samples:
        values.append(s.value)
        if s.value_max is not None:
            values.append(s.value_max)

    if not values:
        return None

    contexts = [s.context for s in valid_samples]
    unique_contexts = set(contexts)
    if len(unique_contexts) == 1:
        mode = list(unique_contexts)[0]
    elif "meal" in contexts and "entry" not in contexts:
        mode = "meal"
    elif "entry" in contexts and "meal" not in contexts:
        mode = "entry"
    else:
        mode = "mixed"

    min_val = round(min(values) / 10.0) * 10.0
    max_val = round(max(values) / 10.0) * 10.0
    if max_val < min_val:
        max_val = min_val

    median_val = round(statistics.median(values) / 10.0) * 10.0

    sources = {s.source for s in valid_samples}
    sample_count = len(valid_samples)
    source_count = len(sources)

    if sample_count >= 3 and source_count >= 2:
        conf = 0.85
    elif sample_count >= 2 or source_count >= 2:
        conf = 0.65
    elif sample_count == 1:
        conf = 0.4
    else:
        conf = 0.2

    if max_val == 0.0:
        mode = "entry"
        median_val = 0.0

    return PriceHint(
        mode=mode,
        min=min_val,
        max=max_val,
        per_person=median_val,
        samples=valid_samples[:8],
        confidence=round(conf, 2),
    )
