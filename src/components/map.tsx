"use client";

import { useEffect, useRef, useState } from "react";
import { Layers, Mountain, Map as MapIcon, Globe } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Experience, ItineraryStop } from "@/lib/types";
import { CATEGORY_EMOJI } from "./cards";
import { cn } from "./ui";

const CAT_COLORS: Record<Experience["category"], string> = {
  food: "#D96B43",
  culture: "#8C5BA8",
  nature: "#5B9E63",
  market: "#D9A441",
  nightlife: "#5460C8",
  adventure: "#3F8FA8",
  workshop: "#A8683F",
  hidden_gem: "#7A9A7B",
};

// Rock-solid 100% keyless open styles with instant loading
const BASE_STYLES = {
  osm: {
    version: 8,
    sources: {
      "osm-standard": {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      {
        id: "base-layer",
        type: "raster",
        source: "osm-standard",
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  },
  satellite: {
    version: 8,
    sources: {
      "esri-satellite": {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
      },
    },
    layers: [
      {
        id: "base-layer",
        type: "raster",
        source: "esri-satellite",
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  },
};

type StyleKey = keyof typeof BASE_STYLES;

export function MapView({
  places,
  center,
  selectedId,
  onSelect,
  planStops,
  startAnchor,
  fitRouteBounds = false,
  compact = false,
  savedIds,
  height = "72vh",
}: {
  places: Experience[];
  center: { lat: number; lon: number };
  selectedId?: string | null;
  onSelect: (exp: Experience) => void;
  planStops: ItineraryStop[];
  startAnchor?: { label: string; lat: number; lon: number } | null;
  fitRouteBounds?: boolean;
  compact?: boolean;
  savedIds: string[];
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markersRef = useRef<import("maplibre-gl").Marker[]>([]);
  const routeMarkersRef = useRef<import("maplibre-gl").Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [terrainOn, setTerrainOn] = useState(false);
  const [currentStyle, setCurrentStyle] = useState<StyleKey>("osm");
  const [error, setError] = useState<string | null>(null);
  const [showHeat, setShowHeat] = useState(false);
  const [showAllPins, setShowAllPins] = useState(false);

  const safeLat = Number.isFinite(center?.lat) ? center.lat : 19.2437;
  const safeLon = Number.isFinite(center?.lon) ? center.lon : 73.1355;

  // init MapLibre with local embedded style definition
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !containerRef.current || mapRef.current) return;

        const map = new maplibre.Map({
          container: containerRef.current,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          style: BASE_STYLES[currentStyle] as any,
          center: [safeLon, safeLat],
          zoom: 12.5,
          pitch: compact ? 0 : 25,
        });

        map.addControl(new maplibre.NavigationControl({ visualizePitch: !compact }), "top-right");

        map.on("error", () => {
          /* non-fatal tile errors */
        });

        map.on("load", () => {
          if (cancelled) return;
          mapRef.current = map;
          setReady(true);
          setTimeout(() => map.resize(), 100);
        });

        mapRef.current = map;

        // Fallback: If "load" doesn't trigger within 1.2s, mark ready anyway
        const readyTimer = setTimeout(() => {
          if (!cancelled && !ready) {
            setReady(true);
            map.resize();
          }
        }, 1200);

        return () => clearTimeout(readyTimer);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Map failed to initialize (WebGL not supported) — grid view still works.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensure map canvas resizes smoothly whenever container dimensions change
  useEffect(() => {
    if (!containerRef.current || !mapRef.current) return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [ready]);

  // Center change flyTo (only when no route bounds fitting is active)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || (planStops.length > 0 && (fitRouteBounds || compact))) return;
    map.flyTo({ center: [safeLon, safeLat], zoom: 12.5, duration: 1200 });
  }, [safeLat, safeLon, ready, planStops.length, fitRouteBounds, compact]);

  // Style switcher
  const handleStyleChange = (styleKey: StyleKey) => {
    setCurrentStyle(styleKey);
    const map = mapRef.current;
    if (!map) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.setStyle(BASE_STYLES[styleKey] as any);
  };

  // 3D terrain (AWS Terrarium DEM — keyless)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      if (terrainOn && !map.getSource("terrain-dem")) {
        map.addSource("terrain-dem", {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          encoding: "terrarium",
          tileSize: 256,
          maxzoom: 13,
        });
        map.setTerrain({ source: "terrain-dem", exaggeration: 1.3 });
      } else if (!terrainOn && map.getSource("terrain-dem")) {
        map.setTerrain(null);
        map.removeSource("terrain-dem");
      }
    } catch {
      /* terrain optional */
    }
  }, [terrainOn, ready]);

  // Markers for discovery places (hidden when a trip route is active unless showAllPins is toggled on)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    // In compact mode (PlanSheet mini-map) or when a route is active and showAllPins is off, show ONLY the route markers!
    const hasRoute = planStops.length > 0;
    if (compact || (hasRoute && !showAllPins)) {
      return;
    }

    const routeStopIds = new Set(planStops.map((s) => s.experienceId));

    (async () => {
      const maplibreMod = await import("maplibre-gl");
      if (!mapRef.current) return;

      for (const p of places) {
        if (p.lat === undefined || p.lon === undefined) continue;
        // Skip places that already have a numbered route marker so two pins don't overlap
        if (routeStopIds.has(p.id)) continue;

        // Untransformed root wrapper so MapLibre's inline translate3d() is never overwritten by :hover CSS transform
        const wrapper = document.createElement("div");
        wrapper.className = "map-marker-root";

        const el = document.createElement("button");
        el.type = "button";
        el.className = "map-pin";
        el.style.setProperty("--pin", CAT_COLORS[p.category] || "#D96B43");
        el.setAttribute("aria-label", p.name);
        el.title = p.name;
        el.innerHTML = `<span>${CATEGORY_EMOJI[p.category] || "📍"}</span>`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelect(p);
        });

        wrapper.appendChild(el);

        const marker = new maplibreMod.Marker({ element: wrapper, anchor: "bottom" })
          .setLngLat([p.lon, p.lat])
          .addTo(map);

        markersRef.current.push(marker);

        if (p.id === selectedId) {
          map.flyTo({ center: [p.lon, p.lat], zoom: 15.5, speed: 1.1 });
          el.classList.add("map-pin-selected");
        }
      }
    })();

    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
    };
  }, [places, planStops, showAllPins, compact, ready, selectedId, onSelect]);

  // Planned-day polyline + numbered route markers (1, 2, 3...)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    for (const rm of routeMarkersRef.current) rm.remove();
    routeMarkersRef.current = [];

    const validStops = planStops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));

    // Build continuous coordinate array from startAnchor + legGeometries
    const coords: [number, number][] = [];
    if (startAnchor && Number.isFinite(startAnchor.lat) && Number.isFinite(startAnchor.lon)) {
      coords.push([startAnchor.lat, startAnchor.lon]);
    }
    for (const s of validStops) {
      if (s.legGeometry && s.legGeometry.length > 1) {
        for (const pt of s.legGeometry) {
          if (Number.isFinite(pt[0]) && Number.isFinite(pt[1])) coords.push(pt);
        }
      } else if (s.lat !== undefined && s.lon !== undefined) {
        coords.push([s.lat, s.lon]);
      }
    }

    try {
      const src = map.getSource("plan-line") as import("maplibre-gl").GeoJSONSource | undefined;
      const geoData = {
        type: "FeatureCollection" as const,
        features:
          coords.length >= 2
            ? [
                {
                  type: "Feature" as const,
                  properties: {},
                  geometry: {
                    type: "LineString" as const,
                    coordinates: coords.map(([lat, lon]) => [lon, lat]),
                  },
                },
              ]
            : [],
      };
      if (!src) {
        map.addSource("plan-line", { type: "geojson", data: geoData });
        map.addLayer({
          id: "plan-line-casing",
          type: "line",
          source: "plan-line",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.85 },
        });
        map.addLayer({
          id: "plan-line-layer",
          type: "line",
          source: "plan-line",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#D96B43", "line-width": 4, "line-dasharray": [1.5, 1.2] },
        });
      } else {
        src.setData(geoData);
      }
    } catch {
      /* layer optional */
    }

    // Add numbered route markers & start anchor marker wrapped in untransformed root divs
    (async () => {
      const maplibreMod = await import("maplibre-gl");
      if (!mapRef.current) return;

      if (startAnchor && Number.isFinite(startAnchor.lat) && Number.isFinite(startAnchor.lon)) {
        const anchorWrapper = document.createElement("div");
        anchorWrapper.className = "map-marker-root";

        const anchorEl = document.createElement("div");
        anchorEl.className =
          "flex items-center gap-1 rounded-full bg-emerald-600 text-white px-2 py-0.5 text-[10px] font-bold shadow-md border-2 border-white";
        anchorEl.title = `Start: ${startAnchor.label}`;
        anchorEl.innerHTML = `<span>🏁 Start</span>`;

        anchorWrapper.appendChild(anchorEl);
        const m = new maplibreMod.Marker({ element: anchorWrapper, anchor: "bottom" })
          .setLngLat([startAnchor.lon, startAnchor.lat])
          .addTo(map);
        routeMarkersRef.current.push(m);
      }

      validStops.forEach((s, idx) => {
        const wrapper = document.createElement("div");
        wrapper.className = "map-marker-root";

        const el = document.createElement("button");
        el.type = "button";
        el.className =
          "flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2.5 py-0.5 text-[11px] font-extrabold shadow-lg border-2 border-white transition-transform hover:scale-110";
        el.title = `Stop ${idx + 1}: ${s.name} (${s.slotStart}–${s.slotEnd})`;
        el.innerHTML = `<span>${idx + 1}</span><span>${CATEGORY_EMOJI[s.category] || "📍"}</span>`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const match = places.find((p) => p.id === s.experienceId);
          if (match) onSelect(match);
        });

        wrapper.appendChild(el);
        const m = new maplibreMod.Marker({ element: wrapper, anchor: "center" })
          .setLngLat([s.lon as number, s.lat as number])
          .addTo(map);
        routeMarkersRef.current.push(m);
      });

      if ((fitRouteBounds || compact) && coords.length >= 2) {
        const lats = coords.map((c) => c[0]);
        const lons = coords.map((c) => c[1]);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        if (maxLat - minLat > 0.0002 || maxLon - minLon > 0.0002) {
          map.fitBounds(
            [
              [minLon, minLat],
              [maxLon, maxLat],
            ],
            { padding: compact ? 36 : 64, maxZoom: 15, duration: 700 },
          );
        }
      }
    })();

    return () => {
      for (const rm of routeMarkersRef.current) rm.remove();
      routeMarkersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planStops, startAnchor?.lat, startAnchor?.lon, startAnchor?.label, fitRouteBounds, compact, ready]);

  // Saved heatmap
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || compact) return;
    const savedPts = places
      .filter((p) => savedIds.includes(p.id) && p.lat !== undefined && p.lon !== undefined)
      .map((p) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point" as const, coordinates: [p.lon as number, p.lat as number] },
      }));

    try {
      const src = map.getSource("saved-heat") as import("maplibre-gl").GeoJSONSource | undefined;
      const data = { type: "FeatureCollection" as const, features: savedPts };
      if (!src && showHeat) {
        map.addSource("saved-heat", { type: "geojson", data });
        map.addLayer({
          id: "saved-heat-layer",
          type: "heatmap",
          source: "saved-heat",
          paint: {
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(217,107,67,0)",
              0.6,
              "rgba(217,107,67,0.45)",
              1,
              "rgba(217,107,67,0.8)",
            ],
            "heatmap-radius": 44,
            "heatmap-opacity": 0.85,
          },
        });
      } else if (src) {
        src.setData(data);
        map.setLayoutProperty("saved-heat-layer", "visibility", showHeat ? "visible" : "none");
      }
    } catch {
      /* heatmap optional */
    }
  }, [showHeat, savedIds, places, compact, ready]);

  if (error) {
    return (
      <div className="clay-raised flex h-96 flex-col items-center justify-center gap-2 p-8 text-center">
        <span className="text-3xl">🗺️</span>
        <p className="font-semibold">Map unavailable</p>
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[22px] border border-border/40 shadow-sm" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" aria-label="Interactive map of places" />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/60 backdrop-blur-sm">
          <p className="clay-raised-sm px-4 py-2 text-sm font-medium animate-pulse">
            Loading MapLibre — OpenStreetMap tiles…
          </p>
        </div>
      )}

      {/* Layer switcher & toggles (hidden in compact PlanSheet preview so the route is unobstructed) */}
      {!compact && (
        <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4 flex flex-wrap items-center gap-2 max-w-[calc(100%-80px)] z-10">
          {planStops.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAllPins((v) => !v)}
              className={cn(
                "clay-raised-sm flex h-9 items-center gap-1.5 px-3 text-xs font-bold rounded-xl bg-card/95 backdrop-blur transition-all",
                !showAllPins ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground hover:text-primary",
              )}
            >
              {showAllPins ? `🎯 Route pins only (${planStops.length})` : `📍 Show all city pins (${places.length})`}
            </button>
          )}

          <div className="clay-raised-sm flex items-center p-1 gap-1 rounded-xl bg-card/90 backdrop-blur text-xs font-semibold">
            <button
              onClick={() => handleStyleChange("osm")}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-all",
                currentStyle === "osm" ? "clay-pressed text-primary font-bold shadow-sm" : "hover:text-foreground text-muted-foreground",
              )}
              title="OpenStreetMap standard style"
            >
              OSM
            </button>
            <button
              onClick={() => handleStyleChange("satellite")}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-all flex items-center gap-1",
                currentStyle === "satellite" ? "clay-pressed text-primary font-bold shadow-sm" : "hover:text-foreground text-muted-foreground",
              )}
              title="Satellite imagery"
            >
              <Globe size={12} /> Sat
            </button>
          </div>

          <button
            onClick={() => setTerrainOn(!terrainOn)}
            className={cn(
              "clay-raised-sm flex h-9 items-center gap-1.5 px-3 text-xs font-semibold rounded-xl bg-card/90 backdrop-blur",
              terrainOn && "clay-pressed text-primary",
            )}
            aria-pressed={terrainOn}
          >
            <Mountain size={14} /> 3D terrain
          </button>

          <button
            onClick={() => setShowHeat(!showHeat)}
            className={cn(
              "clay-raised-sm flex h-9 items-center gap-1.5 px-3 text-xs font-semibold rounded-xl bg-card/90 backdrop-blur",
              showHeat && "clay-pressed text-primary",
            )}
            aria-pressed={showHeat}
          >
            <Layers size={14} /> Heatmap
          </button>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 right-3 sm:bottom-4 sm:right-4 hidden xs:block rounded-xl bg-card/85 px-2.5 py-1 text-[9px] sm:text-[10px] text-muted-foreground backdrop-blur z-10">
        © OpenStreetMap · CARTO
      </div>
    </div>
  );
}
