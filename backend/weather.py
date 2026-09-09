# ─── Weather + sunrise/sunset via Open-Meteo ─────────────────────────────────
from __future__ import annotations

from net import fetch_json, cached


async def get_weather(lat: float, lon: float) -> dict:
    """Fetch current weather + sunrise/sunset from Open-Meteo (keyless)."""

    async def _fetch():
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,weather_code"
            f"&daily=sunrise,sunset"
            f"&timezone=auto&forecast_days=1"
        )
        data = await fetch_json(url, timeout_ms=8000)
        current = data.get("current", {})
        daily = data.get("daily", {})

        temp = current.get("temperature_2m", 0)
        code = current.get("weather_code", 0)

        sunrise_raw = (daily.get("sunrise") or [""])[0]
        sunset_raw = (daily.get("sunset") or [""])[0]
        sunrise = sunrise_raw.split("T")[1][:5] if "T" in sunrise_raw else ""
        sunset = sunset_raw.split("T")[1][:5] if "T" in sunset_raw else ""

        label, emoji = _weather_label(code)

        # Golden hour: within 1h of sunset
        golden = False
        if sunset:
            try:
                sh, sm = map(int, sunset.split(":"))
                from datetime import datetime, timezone, timedelta
                # Approximate: check if current UTC hour is close
                # In practice, the frontend handles this with local time
                golden = False  # Conservative default; frontend computes exact
            except Exception:
                pass

        return {
            "tempC": round(temp),
            "label": label,
            "emoji": emoji,
            "sunrise": sunrise,
            "sunset": sunset,
            "goldenHour": golden,
        }

    return await cached(f"weather:{lat:.2f}:{lon:.2f}", _fetch)


WMO_CODES: dict[int, tuple[str, str]] = {
    0: ("Clear sky", "☀️"),
    1: ("Mainly clear", "🌤"),
    2: ("Partly cloudy", "⛅"),
    3: ("Overcast", "☁️"),
    45: ("Fog", "🌫"),
    48: ("Rime fog", "🌫"),
    51: ("Light drizzle", "🌦"),
    53: ("Moderate drizzle", "🌦"),
    55: ("Dense drizzle", "🌧"),
    61: ("Slight rain", "🌦"),
    63: ("Moderate rain", "🌧"),
    65: ("Heavy rain", "🌧"),
    71: ("Slight snow", "🌨"),
    73: ("Moderate snow", "🌨"),
    75: ("Heavy snow", "❄️"),
    80: ("Rain showers", "🌦"),
    81: ("Moderate showers", "🌧"),
    82: ("Violent showers", "⛈"),
    95: ("Thunderstorm", "⛈"),
    96: ("Thunderstorm + hail", "⛈"),
    99: ("Thunderstorm + heavy hail", "⛈"),
}


def _weather_label(code: int) -> tuple[str, str]:
    return WMO_CODES.get(code, ("Unknown", "🌡"))
