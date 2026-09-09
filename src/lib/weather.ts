// ─── Weather + sunrise/sunset via Open-Meteo (keyless) ──────────────────────
import { cached } from "./net";

export interface WeatherInfo {
  tempC: number;
  apparentC: number;
  humidity: number;
  windKmh: number;
  precipMm: number;
  code: number;
  label: string;
  emoji: string;
  isDay: boolean;
  sunrise: string; // "06:12"
  sunset: string; // "18:47"
  sunsetMin: number; // minutes from midnight
  goldenHour: boolean; // within 90 min of sunset
}

const WMO: Record<number, [string, string]> = {
  0: ["Clear sky", "☀️"],
  1: ["Mostly clear", "🌤️"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"],
  48: ["Fog", "🌫️"],
  51: ["Light drizzle", "🌦️"],
  53: ["Drizzle", "🌦️"],
  55: ["Heavy drizzle", "🌧️"],
  61: ["Light rain", "🌦️"],
  63: ["Rain", "🌧️"],
  65: ["Heavy rain", "🌧️"],
  71: ["Light snow", "🌨️"],
  73: ["Snow", "🌨️"],
  80: ["Rain showers", "🌦️"],
  81: ["Showers", "🌧️"],
  82: ["Violent showers", "⛈️"],
  95: ["Thunderstorm", "⛈️"],
  96: ["Thunderstorm + hail", "⛈️"],
};

export async function getWeather(lat: number, lon: number): Promise<WeatherInfo> {
  return cached(`weather:${lat.toFixed(2)}:${lon.toFixed(2)}`, async () => {
    const j = await cached(`wmo-raw:${lat.toFixed(2)}:${lon.toFixed(2)}`, async () => {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=sunrise,sunset&forecast_days=1&timezone=auto`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
      return (await res.json()) as {
        current: {
          temperature_2m: number;
          relative_humidity_2m: number;
          apparent_temperature: number;
          is_day: number;
          precipitation: number;
          weather_code: number;
          wind_speed_10m: number;
        };
        daily: { sunrise: string[]; sunset: string[] };
      };
    });
    const c = j.current;
    const [label, emoji] = WMO[c.weather_code] ?? ["Mixed skies", "🌥️"];
    const sunsetTime = j.daily.sunset[0]?.split("T")[1] ?? "18:30";
    const sunriseTime = j.daily.sunrise[0]?.split("T")[1] ?? "06:15";
    const toMin = (s: string): number => Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const sunsetMin = toMin(sunsetTime);
    return {
      tempC: Math.round(c.temperature_2m),
      apparentC: Math.round(c.apparent_temperature),
      humidity: Math.round(c.relative_humidity_2m),
      windKmh: Math.round(c.wind_speed_10m),
      precipMm: c.precipitation,
      code: c.weather_code,
      label,
      emoji,
      isDay: c.is_day === 1,
      sunrise: sunriseTime,
      sunset: sunsetTime,
      sunsetMin,
      goldenHour: nowMin >= sunsetMin - 90 && nowMin <= sunsetMin,
    };
  });
}
