# ─── Public-domain books collector (Gutendex + Internet Archive) ─────────────
from __future__ import annotations

import re
from models import GeoCtx
from net import fetch_json, fetch_text


async def collect_books(ctx: GeoCtx) -> list[dict]:
    hits = []
    city = ctx.city

    # Gutendex full-text search
    try:
        data = await fetch_json(
            f"https://gutendex.com/books/?search={city}",
            timeout_ms=15000, retries=0,
        )
        for book in (data.get("results") or [])[:8]:
            title = book.get("title", "")
            authors = ", ".join(a.get("name", "") for a in book.get("authors", []))
            # Get text URL for sentence mining
            text_url = None
            for fmt, url in book.get("formats", {}).items():
                if "text/plain" in fmt:
                    text_url = url
                    break
            if text_url:
                try:
                    text = await fetch_text(text_url, timeout_ms=10000, retries=0)
                    # Mine sentences mentioning the city + landmarks
                    pattern = re.compile(
                        rf"\b{re.escape(city)}\b.{{0,200}}?\b(market|bazaar|fort|temple|ghat|cafe|bakery)\b",
                        re.I,
                    )
                    for m in pattern.finditer(text[:200000]):
                        start = max(0, m.start() - 40)
                        end = min(len(text), m.end() + 120)
                        sentence = text[start:end].strip()
                        sentence = re.sub(r"\s+", " ", sentence)
                        if len(sentence) > 30:
                            hits.append({
                                "name": f"Literary mention in {title[:40]}",
                                "description": sentence[:200],
                                "category": "culture",
                                "source": "Project Gutenberg",
                                "source_url": f"https://www.gutenberg.org/ebooks/{book.get('id', '')}",
                                "quotes": [{"text": sentence[:200]}],
                                "tags": ["book", "literature"],
                            })
                            if len(hits) >= 5:
                                break
                except Exception:
                    pass
    except Exception:
        pass

    # Google Books (keyless volumes endpoint)
    try:
        data = await fetch_json(
            f"https://www.googleapis.com/books/v1/volumes?q={city}+travel+heritage&maxResults=5",
            timeout_ms=10000, retries=0,
        )
        for item in (data.get("items") or [])[:5]:
            info = item.get("volumeInfo", {})
            title = info.get("title", "")
            desc = info.get("description", "")
            if desc and re.search(rf"\b{re.escape(city)}\b", desc, re.I):
                hits.append({
                    "name": f"Book: {title[:50]}",
                    "description": desc[:300],
                    "category": "culture",
                    "source": "Google Books",
                    "source_url": info.get("infoLink", ""),
                    "quotes": [{"text": desc[:200]}],
                    "tags": ["book"],
                })
    except Exception:
        pass

    return hits[:10]
