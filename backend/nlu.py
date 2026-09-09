# ─── Rule-based slot-filling NLU ──────────────────────────────────────────────
from __future__ import annotations

import re
from typing import Any


def parse_actions(transcript: str, session_id: str = "") -> dict:
    """Rule-based NLU: parse user transcript → Action JSON."""
    text = transcript.strip().lower()
    actions: list[dict[str, Any]] = []
    reply = ""

    # set_city
    city_m = re.search(r"\b(?:in|to|for|explore|switch to|change to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)", transcript)
    if city_m:
        actions.append({"type": "set_city", "city": city_m.group(1)})
        reply = f"Switching to {city_m.group(1)}!"

    # plan_trip
    plan_m = re.search(r"plan\s+(?:a\s+)?(\d+)?\s*(?:day|days)?\s*(?:trip|plan)?", text)
    if plan_m or "plan" in text:
        days = int(plan_m.group(1)) if plan_m and plan_m.group(1) else 1
        hours = 8
        hours_m = re.search(r"(\d+)\s*(?:hour|hours|h)", text)
        if hours_m:
            hours = int(hours_m.group(1))

        budget = None
        budget_m = re.search(r"(?:under|budget|below|max)\s*(?:₹|rs\.?|inr)?\s*(\d+)", text)
        if budget_m:
            budget = int(budget_m.group(1))

        interests = []
        for cat in ["food", "culture", "nature", "market", "nightlife", "adventure", "workshop"]:
            if cat in text:
                interests.append(cat)
        if "foodie" in text or "food" in text:
            interests = interests or ["food"]

        vibe = None
        if "chill" in text or "relax" in text:
            vibe = "chill"
        elif "packed" in text or "full" in text:
            vibe = "packed"
        elif "food" in text or "foodie" in text:
            vibe = "foodie"
        elif "heritage" in text or "history" in text:
            vibe = "heritage"

        # Multi-turn: "make it two days"
        days_m = re.search(r"(?:make it|change to|switch to)\s+(\d+)\s*(?:day|days)", text)
        if days_m:
            days = int(days_m.group(1))

        actions.append({
            "type": "plan_trip",
            "days": days,
            "hoursPerDay": hours,
            "interests": interests or None,
            "budget": budget,
            "vibe": vibe,
        })
        reply = reply or f"Planning a {days}-day trip!"

    # apply_filters
    filter_action: dict[str, Any] = {"type": "apply_filters"}
    has_filter = False

    cats = []
    for cat in ["food", "culture", "nature", "market", "nightlife", "adventure", "workshop", "hidden_gem"]:
        if cat.replace("_", " ") in text or cat in text:
            cats.append(cat)
    if cats:
        filter_action["categories"] = cats
        has_filter = True

    budget_m = re.search(r"(?:under|below|budget|max)\s*(?:₹|rs\.?|inr)?\s*(\d+)", text)
    if budget_m and "plan" not in text:
        filter_action["budget"] = int(budget_m.group(1))
        has_filter = True

    if "open now" in text or "open right now" in text:
        filter_action["openNow"] = True
        has_filter = True

    if "hidden gem" in text:
        filter_action["hiddenGem"] = True
        has_filter = True

    time_m = re.search(r"\b(morning|afternoon|evening|night)\b", text)
    if time_m:
        filter_action["timeOfDay"] = time_m.group(1)
        has_filter = True

    if has_filter and not any(a["type"] == "plan_trip" for a in actions):
        actions.append(filter_action)
        reply = reply or "Filters updated!"

    # surprise_me
    if re.search(r"surprise|random|pick|lucky", text):
        actions.append({"type": "surprise_me"})
        reply = reply or "Here's a surprise pick for you! 🎉"

    # compare
    compare_m = re.search(r"compare\s+(.+?)(?:\s+and\s+|\s+vs\.?\s+|\s+with\s+)(.+?)(?:\s*$|\.)", text)
    if compare_m:
        actions.append({"type": "compare", "names": [compare_m.group(1).strip(), compare_m.group(2).strip()]})
        reply = reply or "Let's compare those!"

    # read_day_plan
    if re.search(r"read\s+(?:my\s+)?plan|read aloud|what's my plan", text):
        actions.append({"type": "read_day_plan"})
        reply = reply or "Here's your plan!"

    # navigate_to
    nav_m = re.search(r"(?:navigate|directions?|go)\s+to\s+(.+?)(?:\s*$|\.)", text)
    if nav_m:
        actions.append({"type": "navigate_to", "name": nav_m.group(1).strip()})
        reply = reply or f"Getting directions to {nav_m.group(1).strip()}!"

    # answer
    if re.search(r"weather|temperature|rain", text):
        actions.append({"type": "answer", "topic": "weather"})
        reply = reply or "Let me check the weather!"
    elif re.search(r"price|cost|expensive|cheap|budget", text) and not any(a["type"] in ("plan_trip", "apply_filters") for a in actions):
        actions.append({"type": "answer", "topic": "price"})
        reply = reply or "Here's what I know about prices!"
    elif re.search(r"crowd|busy|packed|rush", text) and not has_filter:
        actions.append({"type": "answer", "topic": "crowd"})
        reply = reply or "Let me check crowd conditions!"
    elif re.search(r"best time|when.*visit|when.*go", text):
        actions.append({"type": "answer", "topic": "best_time"})
        reply = reply or "Here's the best time info!"

    # add/remove stops
    add_m = re.search(r"add\s+(.+?)(?:\s+to.*plan|\s*$)", text)
    if add_m and "stop" not in text[:add_m.start()]:
        actions.append({"type": "add_stop", "name": add_m.group(1).strip()})
        reply = reply or f"Adding {add_m.group(1).strip()} to your plan!"

    remove_m = re.search(r"(?:remove|drop|delete|take out)\s+(.+?)(?:\s+from.*|\s*$)", text)
    if remove_m:
        actions.append({"type": "remove_stop", "name": remove_m.group(1).strip()})
        reply = reply or f"Removing {remove_m.group(1).strip()}!"

    # swap
    swap_m = re.search(r"swap\s+(\w+(?:\s+\w+)?)", text)
    if swap_m:
        reply = reply or "To swap, tell me which stop to remove and what to add instead!"

    if not actions:
        reply = "I didn't quite catch that. Try 'Plan a day in Pune' or 'Show me food places under ₹500'."

    return {
        "actions": actions,
        "reply": reply,
        "nlu": "rules",
        "sessionId": session_id,
    }
