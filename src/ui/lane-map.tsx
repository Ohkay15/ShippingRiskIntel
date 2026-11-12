"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MlMap, GeoJSONSource, MapMouseEvent, StyleSpecification } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The map behind every lane view: OpenStreetMap vector tiles (OpenFreeMap,
 * no key) with an animated NEXRAD radar layer, NWS warning polygons and
 * the lanes themselves. Everything is free public data; nothing here needs
 * an API key. Follows the OS light/dark setting like the rest of the app.
 */

export type LngLat = [number, number];
export type LaneTone = "low" | "elevated" | "high" | null;

export interface MapLane {
  id: string;
  label: string;
  path: LngLat[];
  tone: LaneTone;
  approximate?: boolean;
  href?: string;
  /** Draw on top and thicker (e.g. the lane hit by a warning). */
  emphasis?: boolean;
}

export interface MapAlert {
  id: string;
  event: string;
  severity: string;
  headline: string;
  geometry:
    | { type: "Polygon"; coordinates: LngLat[][] }
    | { type: "MultiPolygon"; coordinates: LngLat[][][] }
    | null;
}

export interface MapEndpoint {
  at: LngLat;
  label: string;
  kind: "origin" | "destination";
}

interface Props {
  lanes: MapLane[];
  alerts?: MapAlert[];
  endpoints?: MapEndpoint[];
  bounds?: [number, number, number, number] | null;
  radar?: boolean;
  height?: number | string;
  onLaneClick?: (laneId: string) => void;
  ariaLabel: string;
}

const STYLE = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

const RADAR_BASE = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913";
/** Oldest → newest. "" is the current composite. */
const RADAR_FRAMES = ["-m50m", "-m40m", "-m30m", "-m20m", "-m10m", ""] as const;
const frameLabel = (suffix: string) => (suffix ? `−${Number(suffix.slice(2, 4))} min` : "Now");

const PALETTE = {
  light: { low: "#2e7a6e", elevated: "#b5581c", high: "#b4402e", none: "#5f5d57", ring: "#ffffff" },
  dark: { low: "#5fb3a5", elevated: "#e08a4f", high: "#ef7a66", none: "#bfbdb4", ring: "#1f1e1c" },
};

const SEVERITY_COLOR: Record<string, string> = {
  Extreme: "#8f1d6b",
  Severe: "#c2410c",
  Moderate: "#b7791f",
  Minor: "#8a8880",
  Unknown: "#8a8880",
};

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function lanesGeoJson(lanes: MapLane[]) {
  return {
    type: "FeatureCollection" as const,
    features: lanes.map((lane) => ({
      type: "Feature" as const,
      id: lane.id,
      properties: {
        id: lane.id,
        label: lane.label,
        tone: lane.tone ?? "none",
        approximate: lane.approximate ? 1 : 0,
        emphasis: lane.emphasis ? 1 : 0,
      },
      geometry: { type: "LineString" as const, coordinates: lane.path },
    })),
  };
}

function endpointsGeoJson(endpoints: MapEndpoint[], lanes: MapLane[]) {
  const points = endpoints.length
    ? endpoints
    : lanes.flatMap((l) =>
        l.path.length
          ? [
              { at: l.path[0], label: "", kind: "origin" as const },
              { at: l.path[l.path.length - 1], label: "", kind: "destination" as const },
            ]
          : []
      );
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({
      type: "Feature" as const,
      properties: { label: p.label, kind: p.kind },
      geometry: { type: "Point" as const, coordinates: p.at },
    })),
  };
}

function alertsGeoJson(alerts: MapAlert[]) {
  return {
    type: "FeatureCollection" as const,
    features: alerts
      .filter((a) => a.geometry)
      .map((a) => ({
        type: "Feature" as const,
        properties: { id: a.id, event: a.event, severity: a.severity, color: SEVERITY_COLOR[a.severity] ?? "#8a8880" },
        geometry: a.geometry!,
      })),
  };
}

export function LaneMap({
  lanes,
  alerts = [],
  endpoints = [],
  bounds,
  radar: radarDefault = true,
  height = 360,
  onLaneClick,
  ariaLabel,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [dark, setDark] = useState(prefersDark);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [radarOn, setRadarOn] = useState(radarDefault);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(RADAR_FRAMES.length - 1);
  const loadedFrames = useRef(new Set<number>());
  const laneClick = useRef(onLaneClick);
  laneClick.current = onLaneClick;

  // Follow the OS theme.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const addOverlays = useCallback(
    (map: MlMap) => {
      const pal = dark ? PALETTE.dark : PALETTE.light;
      loadedFrames.current.clear();

      map.addSource("alerts", { type: "geojson", data: alertsGeoJson(alerts), attribution: "Alerts: NWS" });
      map.addLayer({
        id: "alerts-fill",
        type: "fill",
        source: "alerts",
        paint: { "fill-color": ["get", "color"], "fill-opacity": dark ? 0.16 : 0.12 },
      });
      map.addLayer({
        id: "alerts-line",
        type: "line",
        source: "alerts",
        paint: { "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0.7 },
      });

      map.addSource("lanes", { type: "geojson", data: lanesGeoJson(lanes) });
      const toneColor = [
        "match",
        ["get", "tone"],
        "low", pal.low,
        "elevated", pal.elevated,
        "high", pal.high,
        pal.none,
      ] as unknown as string;
      map.addLayer({
        id: "lanes-casing",
        type: "line",
        source: "lanes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": pal.ring, "line-width": ["case", ["==", ["get", "emphasis"], 1], 7, 5], "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "lanes-line",
        type: "line",
        source: "lanes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": toneColor,
          "line-width": ["case", ["==", ["get", "emphasis"], 1], 3.5, 2.25],
          "line-dasharray": [2, 1.5],
        },
        filter: ["==", ["get", "approximate"], 1],
      });
      map.addLayer({
        id: "lanes-line-solid",
        type: "line",
        source: "lanes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": toneColor, "line-width": ["case", ["==", ["get", "emphasis"], 1], 3.5, 2.25] },
        filter: ["==", ["get", "approximate"], 0],
      });

      map.addSource("endpoints", { type: "geojson", data: endpointsGeoJson(endpoints, lanes) });
      map.addLayer({
        id: "endpoints",
        type: "circle",
        source: "endpoints",
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "destination"], 5, 4],
          "circle-color": ["case", ["==", ["get", "kind"], "destination"], pal.none, pal.ring],
          "circle-stroke-color": pal.none,
          "circle-stroke-width": 1.75,
        },
      });
      map.addLayer({
        id: "endpoint-labels",
        type: "symbol",
        source: "endpoints",
        filter: ["!=", ["get", "label"], ""],
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-font": ["Noto Sans Regular"],
        },
        paint: { "text-color": pal.none, "text-halo-color": pal.ring, "text-halo-width": 1.5 },
      });
    },
    // Overlay data is pushed via setData below; this only rebuilds on theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dark]
  );

  const addOverlaysRef = useRef(addOverlays);
  addOverlaysRef.current = addOverlays;

  const ensureRadarFrame = useCallback((map: MlMap, index: number) => {
    if (loadedFrames.current.has(index)) return;
    const suffix = RADAR_FRAMES[index];
    const id = `radar${index}`;
    if (!map.getSource(id)) {
      map.addSource(id, {
        type: "raster",
        tiles: [`${RADAR_BASE}${suffix}/{z}/{x}/{y}.png`],
        tileSize: 256,
        maxzoom: 10,
        attribution: "Radar: NOAA NEXRAD via Iowa Environmental Mesonet",
      });
    }
    if (!map.getLayer(id)) {
      map.addLayer(
        { id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-fade-duration": 0 } },
        "alerts-fill"
      );
    }
    loadedFrames.current.add(index);
  }, []);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    (async () => {
      try {
        const maplibre = (await import("maplibre-gl")).default;
        if (cancelled || !container.current) return;
        map = new maplibre.Map({
          container: container.current,
          style: dark ? STYLE.dark : STYLE.light,
          center: [-96, 38.5],
          zoom: 3.2,
          attributionControl: { compact: true },
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.touchZoomRotate.disableRotation();
        mapRef.current = map;
        map.on("error", (e) => {
          // A missing tile is normal; a failed style means no basemap.
          if (String(e?.error?.message ?? "").includes("style")) setFailed(true);
        });
        map.on("style.load", () => {
          if (!map) return;
          addOverlaysRef.current(map);
          setReady(true);
        });
        map.on("click", "lanes-casing", (e: MapMouseEvent & { features?: { properties: { id?: string } }[] }) => {
          const id = e.features?.[0]?.properties?.id;
          if (id && laneClick.current) laneClick.current(id);
        });
        map.on("mouseenter", "lanes-casing", () => map && (map.getCanvas().style.cursor = laneClick.current ? "pointer" : ""));
        map.on("mouseleave", "lanes-casing", () => map && (map.getCanvas().style.cursor = ""));
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme switch: swap basemap, overlays are re-added on style.load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setReady(false);
    map.setStyle((dark ? STYLE.dark : STYLE.light) as unknown as StyleSpecification);
  }, [dark]);

  // Push data updates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("lanes") as GeoJSONSource | undefined)?.setData(lanesGeoJson(lanes));
    (map.getSource("endpoints") as GeoJSONSource | undefined)?.setData(endpointsGeoJson(endpoints, lanes));
    (map.getSource("alerts") as GeoJSONSource | undefined)?.setData(alertsGeoJson(alerts));
  }, [lanes, endpoints, alerts, ready]);

  // Frame the lanes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !bounds) return;
    const [w, s, e, n] = bounds;
    const pad = Math.max(0.6, Math.max(e - w, n - s) * 0.08);
    map.fitBounds(
      [
        [w - pad, s - pad],
        [e + pad, n + pad],
      ],
      { padding: 36, maxZoom: 8, duration: 0 }
    );
  }, [bounds, ready]);

  // Radar visibility + frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (radarOn) ensureRadarFrame(map, frame);
    for (const index of loadedFrames.current) {
      if (map.getLayer(`radar${index}`)) {
        map.setPaintProperty(`radar${index}`, "raster-opacity", radarOn && index === frame ? 0.62 : 0);
      }
    }
  }, [radarOn, frame, ready, ensureRadarFrame]);

  // Animation: preload every frame, then step through them.
  useEffect(() => {
    const map = mapRef.current;
    if (!playing || !map || !ready) return;
    RADAR_FRAMES.forEach((_, i) => ensureRadarFrame(map, i));
    const timer = setInterval(() => setFrame((f) => (f + 1) % RADAR_FRAMES.length), 700);
    return () => clearInterval(timer);
  }, [playing, ready, ensureRadarFrame]);

  const alertCount = alerts.filter((a) => a.geometry).length;

  return (
    <div className="lane-map" style={{ height }}>
      <div ref={container} className="lane-map-canvas" role="region" aria-label={ariaLabel} />
      {!ready && !failed && <div className="lane-map-loading" aria-hidden="true" />}
      {failed && (
        <div className="lane-map-fallback">
          The map couldn&apos;t load. Alerts and news below are still current.
        </div>
      )}
      {!failed && (
      <div className="lane-map-controls">
        <button
          type="button"
          className="map-chip"
          aria-pressed={radarOn}
          onClick={() => {
            setRadarOn((v) => !v);
            if (radarOn) setPlaying(false);
          }}
        >
          <span className="map-chip-dot radar" aria-hidden="true" />
          Radar
        </button>
        {radarOn && (
          <>
            <button
              type="button"
              className="map-chip"
              aria-label={playing ? "Pause radar loop" : "Play last hour of radar"}
              onClick={() => {
                if (playing) {
                  setPlaying(false);
                  setFrame(RADAR_FRAMES.length - 1);
                } else {
                  setPlaying(true);
                }
              }}
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <span className="map-frame" aria-live="polite">
              {frameLabel(RADAR_FRAMES[frame])}
            </span>
          </>
        )}
        {alertCount > 0 && (
          <span className="map-legend">
            <span className="map-chip-dot warn" aria-hidden="true" />
            {alertCount} warning{alertCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      )}
    </div>
  );
}
