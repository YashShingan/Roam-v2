# ─── Place Intelligence Engine (Python backend) ──────────────────────────────
from __future__ import annotations

import re

JUNK_ACCOMMODATION_RE = re.compile(
    r"\b(?:oyo|spot\s*on|capital\s*o|collection\s*o|townhouse|fabhotel|treebo)\b"
    r"|\b\d{3,6}\b.*(?:stay|inn|hotel|rooms?|residency)"
    r"|\b(?:hotel|lodge|lodging|rooms?|homestay|residency|pg|guest\s*house|dharamshala)\s+(?:rooms?|stay|deluxe|suite|executive|inn)"
    r"|\b(?:dormitory|pg\s+for\s+(?:men|women|gents|ladies)|paying\s*guest)\b",
    re.IGNORECASE,
)

CAMERA_OR_FILE_NOISE_RE = re.compile(
    r"^(?:img|dsc|photo|picture|panorama|pano|image|screenshot|file)[\s\d_-]*$",
    re.IGNORECASE,
)

TIMESTAMP_SUFFIX_RE = re.compile(
    r"\s*[-–—]\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}(?:\s*\(\d+\))?.*$",
    re.IGNORECASE,
)

NUMERIC_DATE_TIME_RE = re.compile(
    r"\s*[-–—]?\s*\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?:\s+\d{1,2}[-:]\d{2}(?:[-:]\d{2})?\s*(?:am|pm)?)?.*$",
    re.IGNORECASE,
)

TIME_ONLY_RE = re.compile(
    r"\s+\d{1,2}[-:]\d{2}(?:[-:]\d{2})?\s*(?:am|pm)?$",
    re.IGNORECASE,
)

PHOTO_SUFFIX_RE = re.compile(
    r"\s*(?:in\s+(?:the\s+)?(?:night|evening|morning|day|rain|fog|snow|sunset|sunrise)|near\s+building[\w\s-]*|view\s+from[\w\s-]*)\s*\d*$",
    re.IGNORECASE,
)

SEQUENCE_NOISE_RE = re.compile(
    r"(?:[-_\s]+\d{1,3}|\s*\(\d{1,3}\)|\s+#\d{1,3})$",
)

GEOGRAPHIC_SUFFIX_CLEAN_RE = re.compile(
    r"[-_\s]+(?:bangalore|bengaluru|mumbai|pune|delhi|india|karnataka|maharashtra)[-\w\s]*$",
    re.IGNORECASE,
)


def extract_canonical_landmark(raw_title: str) -> str:
    name = re.sub(r"^File:", "", raw_title, flags=re.IGNORECASE).strip()
    name = re.sub(r"\.(?:jpe?g|png|webp|tiff?|gif|svg)$", "", name, flags=re.IGNORECASE).strip()
    name = name.replace("_", " ")
    name = re.sub(r"\s+", " ", name)

    name = TIMESTAMP_SUFFIX_RE.sub("", name)
    name = NUMERIC_DATE_TIME_RE.sub("", name)
    name = TIME_ONLY_RE.sub("", name)
    name = PHOTO_SUFFIX_RE.sub("", name)
    name = GEOGRAPHIC_SUFFIX_CLEAN_RE.sub("", name)
    name = SEQUENCE_NOISE_RE.sub("", name)

    name = re.sub(r"\bVidhan\s+Soudha\b", "Vidhana Soudha", name, flags=re.IGNORECASE)

    # Title-case each word: "Cubbon park" -> "Cubbon Park"
    name = " ".join(w[0].upper() + w[1:] if w else "" for w in name.split())

    return name.strip()


def is_junk_place(name: str) -> bool:
    trimmed = name.strip()
    if len(trimmed) < 3 or trimmed.isdigit():
        return True
    if CAMERA_OR_FILE_NOISE_RE.match(trimmed):
        return True
    if JUNK_ACCOMMODATION_RE.search(trimmed):
        return True
    if re.search(r"^inscription\s+of\s+", trimmed, re.IGNORECASE) or re.search(
        r"^(?:hero\s*stone|nandi\s*stone|inscription\s*stone)\b", trimmed, re.IGNORECASE
    ):
        return True
    return False


def sanitize_category(category: str, name: str) -> str:
    if JUNK_ACCOMMODATION_RE.search(name) or re.search(
        r"\b(?:hotel|lodge|rooms?|inn|resort|homestay|stay)\b", name, re.IGNORECASE
    ):
        return "hidden_gem"
    return category
