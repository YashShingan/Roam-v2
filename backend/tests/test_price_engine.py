# ─── Tests for Price Intelligence Engine ──────────────────────────────────────
from __future__ import annotations

import pytest
from services.price_engine import parse_price_snippets, aggregate_price_hint

FIXTURES = [
    # 1. Clear meal with range
    ("The thali at Krishna Cafe costs ₹150–250 per person and includes unlimited roti.", 150.0, 250.0, "meal"),
    # 2. Free entry fort
    ("Durgadi Fort in Kalyan has free entry and opens at sunrise.", 0.0, 0.0, "entry"),
    # 3. Entry fee
    ("The museum charges an entry fee of ₹50 for adults and ₹20 for children.", 50.0, None, "entry"),
    # 4. Cost for two
    ("Famous biryani house in Pune, cost for two is around ₹600 with drinks.", 300.0, None, "meal"),
    # 5. Item price
    ("Special cutting chai is just ₹15 at this corner stall.", 15.0, None, "item"),
    # 6. Vada pav item
    ("Hot batata vada served with chutney for Rs. 20 per plate.", 20.0, None, "item"),
    # 7. Range with 'to'
    ("Expect to spend Rs 300 to 500 for a hearty dinner here.", 300.0, 500.0, "meal"),
    # 8. Adventure category
    ("Paragliding in Kamshet charges ₹3000 per jump with video.", 3000.0, None, "meal"),
    # 9. No entry fee keyword
    ("Shivaji Park is a public ground with no entry fee for visitors.", 0.0, 0.0, "entry"),
    # 10. Multi-item snack
    ("Samosa pav costs ₹25 while filter coffee is ₹30.", 25.0, None, "item"),
    # 11. Per person thali
    ("Pure veg unlimited Gujarati thali at ₹350 per head.", 350.0, None, "meal"),
    # 12. INR prefix
    ("Ticket price: INR 100 per visitor at the science park.", 100.0, None, "entry"),
    # 13. 'k' suffix
    ("Heritage resort weekend buffet is 1.5k per person.", 1500.0, None, "meal"),
    # 14. Slash hyphen
    ("Entry ticket is 40/- per person at the gate.", 40.0, None, "entry"),
    # 15. Rupees word
    ("A plate of pav bhaji costs 120 rupees near the station.", 120.0, None, "item"),
    # 16. Temple free admission
    ("Ganpati Temple offers free admission to all devotees daily.", 0.0, 0.0, "entry"),
    # 17. Street food range
    ("Street food stalls here range between ₹50–150 per dish.", 50.0, 150.0, "item"),
    # 18. Dinner buffet
    ("Grand lunch buffet costs ₹799 per person plus taxes.", 799.0, None, "meal"),
    # 19. Historical year reject test
    ("Built in 1947 by the local municipality.", None, None, None),
    # 20. Rating reject test
    ("Rated 4.5 stars on community travel forums.", None, None, None),
    # 21. Timing reject test
    ("Open from 9 am to 5 pm every Tuesday.", None, None, None),
    # 22. Distance reject test
    ("Located 5 km from Kalyan junction.", None, None, None),
    # 23. Rs prefix
    ("Breakfast combo with idli and dosa is Rs. 90.", 90.0, None, "item"),
    # 24. Admission pass
    ("Botanical garden entry pass is ₹30.", 30.0, None, "entry"),
    # 25. Cafe for two
    ("Cozy cafe ambience, dinner for two comes around ₹800.", 400.0, None, "meal"),
]


def test_25_fixtures():
    correct = 0
    total = len(FIXTURES)
    for text, expected_min, expected_max, expected_context in FIXTURES:
        samples = parse_price_snippets(text, source="test")
        if expected_min is None:
            # Noise test: expect 0 samples
            if len(samples) == 0:
                correct += 1
            else:
                print(f"FAILED (expected noise): '{text}' -> got {samples}")
        else:
            if len(samples) > 0:
                s = samples[0]
                val_ok = (s.value == expected_min)
                ctx_ok = (s.context == expected_context)
                if val_ok and ctx_ok:
                    correct += 1
                else:
                    print(f"MISMATCH in '{text}': got val={s.value}, ctx={s.context}; expected val={expected_min}, ctx={expected_context}")
            else:
                print(f"FAILED (no sample extracted): '{text}'")

    accuracy = correct / total
    print(f"\nAccuracy: {correct}/{total} = {accuracy * 100:.1f}%")
    assert accuracy >= 0.90, f"Accuracy {accuracy * 100:.1f}% is below required 90%"


def test_aggregation():
    text = "Meals are ₹150–250 per person. Buffet is around ₹300."
    samples = parse_price_snippets(text, source="reddit")
    hint = aggregate_price_hint(samples, category="food")
    assert hint is not None
    assert hint.min >= 150
    assert hint.max <= 300
    assert hint.per_person is not None
    assert hint.confidence > 0
