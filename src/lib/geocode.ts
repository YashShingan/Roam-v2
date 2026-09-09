// ─── Geocoding: Nominatim (primary) + Photon (autocomplete) — keyless ───────
import { getJson, cached } from "./net";

export interface GeoPlace {
  label: string;
  city: string;
  lat: number;
  lon: number;
  bbox?: [number, number, number, number]; // w,s,e,n
  type?: string;
  country?: string;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  addresstype?: string;
  boundingbox?: [string, string, string, string];
  address?: Record<string, string>;
}

interface PhotonFeature {
  properties: { name?: string; city?: string; state?: string; country?: string; countrycode?: string; osm_value?: string };
  geometry: { coordinates: [number, number] };
}

function cityFromNominatim(r: NominatimResult): string {
  const a = r.address ?? {};
  return a.city || a.town || a.village || a.county || a.state_district || r.display_name.split(",")[0];
}

export async function geocodeCity(q: string): Promise<GeoPlace | null> {
  const query = q.trim();
  if (!query) return null;
  return cached(`geocode:${query.toLowerCase()}`, async () => {
    try {
      const rs = await getJson<NominatimResult[]>(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&addressdetails=1&accept-language=en`,
        { timeoutMs: 15000, headers: { "Accept-Language": "en" } },
      );
      if (rs.length > 0) {
        const r = rs[0];
        const bb = r.boundingbox?.map(Number) as [number, number, number, number] | undefined;
        return {
          label: r.display_name,
          city: cityFromNominatim(r),
          lat: Number(r.lat),
          lon: Number(r.lon),
          bbox: bb ? [bb[2], bb[0], bb[3], bb[1]] : undefined, // nominatim s,n,w,e → w,s,e,n
          type: r.type,
        };
      }
    } catch {
      /* fall through to Photon */
    }
    try {
      const ph = await getJson<{ features: PhotonFeature[] }>(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=en`,
        { timeoutMs: 12000 },
      );
      const f = ph.features[0];
      if (f) {
        const p = f.properties;
        return {
          label: [p.name ?? p.city, p.state, p.country].filter(Boolean).join(", "),
          city: p.name ?? p.city ?? query,
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          type: p.osm_value,
        };
      }
    } catch {
      /* both down */
    }
    return null;
  });
}

export async function suggestCities(q: string, limit = 6): Promise<GeoPlace[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const out: GeoPlace[] = [];
  const seen = new Set<string>();
  try {
    const ph = await getJson<{ features: PhotonFeature[] }>(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit}&lang=en`,
      { timeoutMs: 8000 },
    );
    for (const f of ph.features) {
      const p = f.properties;
      const label = [p.name ?? p.city, p.state, p.country].filter(Boolean).join(", ");
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      out.push({
        label,
        city: p.name ?? p.city ?? label,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        type: p.osm_value,
        country: p.country,
      });
    }
  } catch {
    /* Photon down */
  }
  if (out.length < limit) {
    try {
      const rs = await getJson<NominatimResult[]>(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=${limit}&addressdetails=1`,
        { timeoutMs: 10000, headers: { "Accept-Language": "en" } },
      );
      for (const r of rs) {
        const label = r.display_name;
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          label,
          city: cityFromNominatim(r),
          lat: Number(r.lat),
          lon: Number(r.lon),
          type: r.type,
        });
      }
    } catch {
      /* Nominatim down */
    }
  }
  return out.slice(0, limit);
}

interface PhotonReverseResult {
  features?: {
    properties: {
      name?: string;
      street?: string;
      housenumber?: string;
      locality?: string;
      district?: string;
      city?: string;
      state?: string;
      postcode?: string;
    };
  }[];
}

const revCache = new Map<string, string>();

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = revCache.get(cacheKey);
  if (hit) return hit;

  // 1. Try Photon reverse (ultra fast, keyless, zero rate limit)
  try {
    const data = await getJson<PhotonReverseResult>(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`,
      { timeoutMs: 3500 },
    );
    const p = data.features?.[0]?.properties;
    if (p) {
      const parts = [
        p.street || (p.name !== p.city ? p.name : undefined),
        p.locality || p.district,
        p.city,
      ].filter((x): x is string => !!x && x.trim().length > 0);
      const unique = [...new Set(parts)];
      if (unique.length > 0) {
        const addr = unique.join(", ");
        revCache.set(cacheKey, addr);
        return addr;
      }
    }
  } catch {
    /* fallback to Nominatim */
  }

  // 2. Nominatim fallback
  try {
    const r = await getJson<NominatimResult>(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=18&addressdetails=1&accept-language=en`,
      { timeoutMs: 4000 },
    );
    const a = r.address ?? {};
    const road = a.road || a.pedestrian || a.suburb || a.neighbourhood;
    const city = cityFromNominatim(r);
    const addr = [road, city].filter(Boolean).join(", ") || r.display_name.split(",").slice(0, 3).join(", ");
    if (addr) {
      revCache.set(cacheKey, addr);
      return addr;
    }
  } catch {
    /* non-fatal */
  }

  return "";
}

// India fallback list used by the rule-based NLU when geocoders are down.
export const POPULAR_CITIES: { city: string; label: string; lat: number; lon: number }[] = [
  { city: "Mumbai", label: "Mumbai, Maharashtra, India", lat: 19.076, lon: 72.8777 },
  { city: "Pune", label: "Pune, Maharashtra, India", lat: 18.5204, lon: 73.8567 },
  { city: "Kalyan", label: "Kalyan, Maharashtra, India", lat: 19.2403, lon: 73.1305 },
  { city: "Thane", label: "Thane, Maharashtra, India", lat: 19.2183, lon: 72.9781 },
  { city: "Delhi", label: "Delhi, India", lat: 28.6139, lon: 77.209 },
  { city: "Bengaluru", label: "Bengaluru, Karnataka, India", lat: 12.9716, lon: 77.5946 },
  { city: "Hyderabad", label: "Hyderabad, Telangana, India", lat: 17.385, lon: 78.4867 },
  { city: "Chennai", label: "Chennai, Tamil Nadu, India", lat: 13.0827, lon: 80.2707 },
  { city: "Kolkata", label: "Kolkata, West Bengal, India", lat: 22.5726, lon: 88.3639 },
  { city: "Jaipur", label: "Jaipur, Rajasthan, India", lat: 26.9124, lon: 75.7873 },
  { city: "Ahmedabad", label: "Ahmedabad, Gujarat, India", lat: 23.0225, lon: 72.5714 },
  { city: "Nashik", label: "Nashik, Maharashtra, India", lat: 19.9975, lon: 73.7898 },
  { city: "Kochi", label: "Kochi, Kerala, India", lat: 9.9312, lon: 76.2673 },
  { city: "Varanasi", label: "Varanasi, Uttar Pradesh, India", lat: 25.3176, lon: 82.9739 },
  { city: "Udaipur", label: "Udaipur, Rajasthan, India", lat: 24.5854, lon: 73.7125 },
  { city: "Mysuru", label: "Mysuru, Karnataka, India", lat: 12.2958, lon: 76.6394 },
];
