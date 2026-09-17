"use client";

import { useEffect, useRef } from "react";
import { LngLat as LngLatClass, Map as MapLibre, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Point } from "geojson";
import { AREA, AREA_CENTER, AREA_NAME, layerInEra, type EraId, type PlaceSummary } from "@/lib/data";
import type { LngLat } from "@/lib/geo";
import { COVERAGE_TILES, MAPILLARY } from "@/lib/mapillary";
import { CLICKABLE_SOURCE_LAYERS, type MapFeature } from "@/lib/osm";

/** `panel: false` centres the view without leaving room for the side panel / bottom sheet. */
export type FlyTarget = LngLat & { key: number; zoom?: number; atLeast?: number; panel?: boolean };

type Props = {
  places: PlaceSummary[];
  era: EraId;
  pin?: LngLat & { key: number };
  flyTo?: FlyTarget;
  onClick: (point: LngLat, pixelNearestId?: string, feature?: MapFeature) => void;
  onHotspot: () => void;
};

// See scripts/vendor-maplibre.mjs.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

// OpenFreeMap "Liberty": a free, keyless, bright OSM street map (GeoGuessr-like). Attribution comes from the style.
const STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** Below this zoom the dig site collapses into one clickable hotspot. */
const DETAIL_ZOOM = 10;

/**
 * The map still loops sideways forever, but never zooms out so far that two copies of the world fit on screen
 * (which showed the Bengaluru hotspot twice). MapLibre's world is 512·2^zoom px wide; the margin covers the label.
 */
const minZoomFor = (widthPx: number) => Math.max(0, Math.log2((widthPx + 260) / 512));

const point = (lng: number, lat: number, properties: Record<string, unknown>): Feature => ({
  type: "Feature",
  properties,
  geometry: { type: "Point", coordinates: [lng, lat] },
});

function densityData(places: PlaceSummary[], era: EraId): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.flatMap((p) => p.layers.filter((l) => layerInEra(l, era)).map((l) => point(p.lng, p.lat, { wow: l.wow }))),
  };
}

function emberData(places: PlaceSummary[], era: EraId): FeatureCollection {
  return {
    type: "FeatureCollection",
    // Clicked map places without any history get no dot.
    features: places.filter((p) => p.layers.length).map((p) => point(p.lng, p.lat, { id: p.id, live: p.live ? 1 : 0, active: p.layers.some((l) => layerInEra(l, era)) ? 1 : 0 })),
  };
}

function hotspotData(places: PlaceSummary[], era: EraId): FeatureCollection {
  const n = places.filter((p) => !p.live).filter((p) => p.layers.some((l) => layerInEra(l, era))).length;
  return { type: "FeatureCollection", features: [point(AREA_CENTER.lng, AREA_CENTER.lat, { label: `${AREA_NAME}\n${n} places to dig` })] };
}

// World polygon with the curated area cut out; its outline draws the dig site's dashed edge.
const mask: Feature = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]],
      [[AREA.west, AREA.south], [AREA.west, AREA.north], [AREA.east, AREA.north], [AREA.east, AREA.south], [AREA.west, AREA.south]],
    ],
  },
};

function pinElement() {
  const el = document.createElement("div");
  el.className = "red-pin";
  el.innerHTML = `<div class="red-pin-drop"><svg viewBox="0 0 30 42" width="30" height="42" aria-hidden="true">
    <path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.4 15 41 15 41s14-15.6 14-26.1C29 7.2 22.7 1 15 1z" fill="#e0312b" stroke="#8f1510" stroke-width="1.5"/>
    <circle cx="15" cy="14.5" r="5.2" fill="#fff"/></svg></div><div class="red-pin-shadow"></div>`;
  return el;
}

export default function MapView({ places, era, pin, flyTo, onClick, onHotspot }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const marker = useRef<Marker | null>(null);
  const ready = useRef(false);
  const handlers = useRef({ onClick, onHotspot });
  handlers.current = { onClick, onHotspot };
  const eraRef = useRef(era);
  eraRef.current = era;
  const placesRef = useRef(places);
  placesRef.current = places;

  useEffect(() => {
    const minZoom = minZoomFor(container.current!.clientWidth);
    const m = new MapLibre({
      container: container.current!,
      style: STYLE,
      center: [60, 22],
      zoom: Math.max(minZoom, window.innerWidth < 760 ? 0.6 : 1.6),
      minZoom,
      maxZoom: 18.5,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-left");
    m.on("resize", () => m.setMinZoom(minZoomFor(m.getContainer().clientWidth)));
    map.current = m;
    if (location.search.includes("debug")) (window as unknown as { __wwhMap: MapLibre }).__wwhMap = m;

    m.on("load", () => {
      // Dashed outline of the hand-researched dig site. (No dimming outside it: live history works anywhere.)
      m.addSource("mask", { type: "geojson", data: mask });
      m.addLayer({
        id: "area-edge", type: "line", source: "mask", minzoom: DETAIL_ZOOM,
        paint: { "line-color": "#c2410c", "line-opacity": 0.7, "line-width": 1.5, "line-dasharray": [3, 2] },
      });

      // Where street-level photos exist (like Google's blue Street View lines), under the history glow.
      if (MAPILLARY) {
        m.addSource("mapillary", {
          type: "vector", tiles: [COVERAGE_TILES], minzoom: 6, maxzoom: 14,
          attribution: '<a href="https://www.mapillary.com" target="_blank" rel="noopener">© Mapillary</a>',
        });
        m.addLayer({
          id: "mapillary-sequences", type: "line", source: "mapillary", "source-layer": "sequence", minzoom: 13,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#0aa36b",
            "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 17, 3],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.55],
          },
        });
      }

      m.addSource("density", { type: "geojson", data: densityData(placesRef.current, eraRef.current) });
      m.addLayer({
        id: "density", type: "heatmap", source: "density", minzoom: DETAIL_ZOOM,
        paint: {
          "heatmap-weight": ["/", ["get", "wow"], 5],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 1.4],
          "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 11, 10, 15, 60, 18, 260],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], DETAIL_ZOOM, 0, 11, 0.8, 17, 0.55],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)", 0.15, "rgba(251,146,60,0.25)", 0.45, "rgba(249,115,22,0.45)",
            0.75, "rgba(234,88,12,0.6)", 1, "rgba(194,65,12,0.7)",
          ],
        },
      });

      m.addSource("embers", { type: "geojson", data: emberData(placesRef.current, eraRef.current) });
      m.addLayer({
        id: "embers", type: "circle", source: "embers", minzoom: DETAIL_ZOOM,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 5.5],
          // Live (unreviewed) places in slate blue, matching their "Not reviewed" badge.
          "circle-color": ["case", ["==", ["get", "live"], 1], "#3b6ea5", "#c2410c"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 2],
          "circle-opacity": ["case", ["==", ["get", "active"], 1], 0.95, 0.2],
          "circle-stroke-opacity": ["case", ["==", ["get", "active"], 1], 1, 0.2],
        },
      });

      m.addSource("hotspot", { type: "geojson", data: hotspotData(placesRef.current, eraRef.current) });
      m.addLayer({
        id: "hotspot-halo", type: "circle", source: "hotspot", maxzoom: DETAIL_ZOOM,
        paint: { "circle-radius": 22, "circle-color": "#f97316", "circle-opacity": 0.28, "circle-blur": 0.4 },
      });
      m.addLayer({
        id: "hotspot", type: "circle", source: "hotspot", maxzoom: DETAIL_ZOOM,
        paint: { "circle-radius": 8, "circle-color": "#c2410c", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 },
      });
      m.addLayer({
        id: "hotspot-label", type: "symbol", source: "hotspot", maxzoom: DETAIL_ZOOM,
        layout: {
          "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 13,
          "text-anchor": "left", "text-offset": [1.4, 0], "text-justify": "left", "text-allow-overlap": true,
        },
        paint: { "text-color": "#7c2d12", "text-halo-color": "#ffffff", "text-halo-width": 2 },
      });

      ready.current = true;
      syncEra();
    });

    /** Basemap label layers that name something clickable (shops, stations, parks, streets, towns…). Set on load. */
    let basemapLayers: string[] = [];
    m.on("load", () => {
      basemapLayers = (m.getStyle().layers ?? [])
        .filter((l) => l.type === "symbol" && "source-layer" in l && l["source-layer"] && l["source-layer"] in CLICKABLE_SOURCE_LAYERS)
        .map((l) => l.id);
    });

    /** The named basemap feature closest to a screen point, if any. */
    const featureAt = (x: number, y: number): MapFeature | undefined => {
      if (!basemapLayers.length) return undefined;
      const box: [[number, number], [number, number]] = [[x - 10, y - 10], [x + 10, y + 10]];
      const hits = m.queryRenderedFeatures(box, { layers: basemapLayers }).filter((f) => f.properties.name);
      const best = hits
        .map((f) => {
          // Labels are points for POIs and places, lines for streets and rivers: use the clicked spot for lines.
          const [lng, lat] = f.geometry.type === "Point" ? (f.geometry as Point).coordinates : [m.unproject([x, y]).lng, m.unproject([x, y]).lat];
          const p = m.project([lng, lat]);
          return { f, lng, lat, d: Math.hypot(p.x - x, p.y - y) };
        })
        .sort((a, b) => a.d - b.d)[0];
      if (!best) return undefined;
      const props = best.f.properties;
      const at = new LngLatClass(best.lng, best.lat).wrap();
      return {
        name: String(props["name:en"] ?? props.name_en ?? props.name),
        kind: CLICKABLE_SOURCE_LAYERS[best.f.sourceLayer!],
        subclass: String(props.subclass ?? props.class ?? ""),
        lng: at.lng,
        lat: at.lat,
      };
    };

    m.on("click", (e) => {
      // The flat map repeats sideways forever; a click on a repeated copy reports e.g. lng 437, so normalise to ±180.
      const clicked = e.lngLat.wrap();
      const at = { lng: clicked.lng, lat: clicked.lat };
      const box: [[number, number], [number, number]] = [[e.point.x - 18, e.point.y - 18], [e.point.x + 18, e.point.y + 18]];
      if (m.getZoom() < DETAIL_ZOOM && m.queryRenderedFeatures(box, { layers: ["hotspot", "hotspot-halo", "hotspot-label"] }).length) {
        return handlers.current.onHotspot();
      }
      // 1. A history dot. Accept taps visually on a marker even where metres alone would be too strict.
      const nearest =
        m.getZoom() >= DETAIL_ZOOM
          ? m
              .queryRenderedFeatures(box, { layers: ["embers"] })
              .map((f) => {
                const [lng, lat] = (f.geometry as Point).coordinates;
                const p = m.project([lng, lat]);
                return { id: f.properties.id as string, d: Math.hypot(p.x - e.point.x, p.y - e.point.y) };
              })
              .sort((a, b) => a.d - b.d)[0]
          : undefined;
      if (nearest) return handlers.current.onClick(at, nearest.id);
      // 2. A named thing on the map itself. 3. Otherwise an empty spot.
      handlers.current.onClick(at, undefined, featureAt(e.point.x, e.point.y));
    });

    for (const layer of ["embers", "hotspot", "hotspot-halo", "hotspot-label"]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = "crosshair"));
    }
    // Pointer over any clickable label on the basemap, like a real map.
    let hoverFrame = 0;
    m.on("mousemove", (e) => {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const overDot = m.getLayer("embers") && m.queryRenderedFeatures(e.point, { layers: ["embers", "hotspot"] }).length;
        m.getCanvas().style.cursor = overDot || featureAt(e.point.x, e.point.y) ? "pointer" : "crosshair";
      });
    });
    m.getCanvas().style.cursor = "crosshair";

    return () => {
      ready.current = false;
      marker.current?.remove();
      m.remove();
    };
  }, []);

  function syncEra() {
    const m = map.current;
    if (!m || !ready.current) return;
    m.getSource<GeoJSONSource>("density")?.setData(densityData(placesRef.current, eraRef.current));
    m.getSource<GeoJSONSource>("embers")?.setData(emberData(placesRef.current, eraRef.current));
    m.getSource<GeoJSONSource>("hotspot")?.setData(hotspotData(placesRef.current, eraRef.current));
  }
  useEffect(syncEra, [era, places]);

  // Red pin: moved (and re-dropped with its bounce) every time a new pin key arrives.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pin) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) marker.current = new Marker({ element: pinElement(), anchor: "bottom" });
    marker.current.setLngLat([pin.lng, pin.lat]).addTo(m);
    const drop = marker.current.getElement().querySelector<HTMLElement>(".red-pin-drop")!;
    drop.classList.remove("dropping");
    void drop.offsetWidth; // restart the CSS animation
    drop.classList.add("dropping");
  }, [pin]);

  useEffect(() => {
    if (!flyTo || !map.current) return;
    const m = map.current;
    const mobile = window.innerWidth < 760;
    const none = { top: 0, left: 0, right: 0, bottom: 0 };
    // Head for the copy of the target nearest the current view, so the camera takes the short way round the loop.
    const here = m.getCenter().lng;
    const lng = flyTo.lng + 360 * Math.round((here - flyTo.lng) / 360);
    m.flyTo({
      center: [lng, flyTo.lat],
      zoom: flyTo.zoom ?? Math.max(m.getZoom(), flyTo.atLeast ?? 16),
      padding: flyTo.panel === false ? none : mobile ? { ...none, bottom: window.innerHeight * 0.55 } : { ...none, right: 440 },
      speed: 1.6,
      curve: 1.6,
      essential: true,
    });
  }, [flyTo]);

  return <div ref={container} className="map" aria-label="World map. Drop a pin anywhere to see what was there." />;
}
