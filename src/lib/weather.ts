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

export interface WeatherHourlyItem {
  time: string;
  tempC: number;
  apparentC: number;
  precipMm: number;
  precipProb: number;
  windKmh: number;
  code: number;
  uvIndex?: number;
}

export interface WeatherDailyItem {
  date: string;
  maxTempC: number;
  minTempC: number;
  totalPrecipMm: number;
  maxWindKmh: number;
  dominantCode: number;
}

export interface WeatherVector extends WeatherInfo {
  hourlyForecast: WeatherHourlyItem[];
  dailyForecast: WeatherDailyItem[];
}

export async function getWeatherVector(lat: number, lon: number): Promise<WeatherVector> {
  return cached(`weather-vector:${lat.toFixed(2)}:${lon.toFixed(2)}`, async () => {
    const base = await getWeather(lat, lon);
    const j = await cached(`open-meteo-extended:${lat.toFixed(2)}:${lon.toFixed(2)}`, async () => {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,uv_index&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code&forecast_days=7&timezone=auto`,
        { signal: AbortSignal.timeout(12000) },
      );
      if (!res.ok) throw new Error(`Open-Meteo Extended HTTP ${res.status}`);
      return (await res.json()) as {
        hourly?: {
          time: string[];
          temperature_2m: number[];
          apparent_temperature: number[];
          precipitation: number[];
          precipitation_probability: number[];
          weather_code: number[];
          wind_speed_10m: number[];
          uv_index: number[];
        };
        daily?: {
          time: string[];
          temperature_2m_max: number[];
          temperature_2m_min: number[];
          precipitation_sum: number[];
          wind_speed_10m_max: number[];
          weather_code: number[];
        };
      };
    });

    const hourly: WeatherHourlyItem[] = [];
    if (j.hourly && Array.isArray(j.hourly.time)) {
      const len = Math.min(j.hourly.time.length, 48); // next 48 hours
      for (let i = 0; i < len; i++) {
        hourly.push({
          time: j.hourly.time[i],
          tempC: Math.round(j.hourly.temperature_2m[i] ?? base.tempC),
          apparentC: Math.round(j.hourly.apparent_temperature[i] ?? base.apparentC),
          precipMm: j.hourly.precipitation[i] ?? 0,
          precipProb: j.hourly.precipitation_probability[i] ?? 0,
          windKmh: Math.round(j.hourly.wind_speed_10m[i] ?? base.windKmh),
          code: j.hourly.weather_code[i] ?? base.code,
          uvIndex: j.hourly.uv_index ? Math.round(j.hourly.uv_index[i] ?? 0) : undefined,
        });
      }
    }

    const daily: WeatherDailyItem[] = [];
    if (j.daily && Array.isArray(j.daily.time)) {
      for (let i = 0; i < j.daily.time.length; i++) {
        daily.push({
          date: j.daily.time[i],
          maxTempC: Math.round(j.daily.temperature_2m_max[i] ?? base.tempC),
          minTempC: Math.round(j.daily.temperature_2m_min[i] ?? base.tempC - 5),
          totalPrecipMm: j.daily.precipitation_sum[i] ?? 0,
          maxWindKmh: Math.round(j.daily.wind_speed_10m_max[i] ?? base.windKmh),
          dominantCode: j.daily.weather_code[i] ?? base.code,
        });
      }
    }

    return {
      ...base,
      hourlyForecast: hourly,
      dailyForecast: daily,
    };
  });
}

