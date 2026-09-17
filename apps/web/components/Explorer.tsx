"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import LayerStack from "./LayerStack";
import LayerCard from "./LayerCard";
import StreetView from "./StreetView";
import { googleMapsUrl } from "@/lib/streetview";
import { TODAY_IN_APP } from "@/lib/today";
import type { FlyTarget } from "./MapView";
import {
  AREA_CENTER, AREA_NAME, ERAS, SNAP_METRES, inArea, layerInEra, loadMapIndex, loadPlace, nearestPlaces,
  type EraId, type Place, type PlaceSummary,
} from "@/lib/data";
import { distance, formatDistance, type LngLat } from "@/lib/geo";
import { isLiveId, LIVE_RADIUS_KM, loadLiveSummary, searchLive } from "@/lib/live";
import { isOsmId, loadOsmPlace, lookupFeature, summaryOf, type MapFeature } from "@/lib/osm";
import { readLog, sessionSeconds, track } from "@/lib/analytics";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

/** "Dig nearby" never jumps further than this (e.g. from a live place in another city back to Bengaluru). */
const NEARBY_MAX_METRES = 20_000;

/** Opening a town or country label shouldn't dive to street level. */
function zoomForFeature(f: MapFeature): number | undefined {
  if (f.kind !== "place") return undefined;
  return ({ country: 5, state: 7, province: 7, city: 12, town: 13, village: 14.5 } as Record<string, number>)[f.subclass ?? ""] ?? 15;
}

type Via = "tap" | "hint" | "nearby" | "surprise" | "link";
type Notice =
  | { kind: "miss"; nearestId: string; metres: number; live?: number }
  | { kind: "outside"; metres: number }
  | { kind: "searching" }
  | { kind: "search-failed"; point: LngLat }
  | { kind: "looking"; name: string }
  | { kind: "lookup-failed"; feature: MapFeature }
  | { kind: "exhausted" }
  | { kind: "offline" };

export default function Explorer() {
  const [era, setEra] = useState<EraId>("all");
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const placesRef = useRef(places);
  placesRef.current = places;
  const [placeId, setPlaceId] = useState<string>();
  // Full stack for the open place; `failed` when loading it didn't work.
  const [detail, setDetail] = useState<Place | "failed">();
  const [detailTry, setDetailTry] = useState(0);
  const [layerIndex, setLayerIndex] = useState<number>();
  const [today, setToday] = useState(false);
  const [pin, setPin] = useState<LngLat & { key: number }>();
  const [fly, setFly] = useState<FlyTarget>();
  const [notice, setNotice] = useState<Notice>();
  const [copied, setCopied] = useState(false);
  const visited = useRef(new Set<string>());
  const layersOpened = useRef(0);
  const latestSearch = useRef(0);
  const [debug, setDebug] = useState(false);

  const summary = places.find((p) => p.id === placeId);
  const place = detail !== "failed" && detail?.id === placeId ? detail : undefined;

  useEffect(() => {
    if (!placeId) return;
    let current = true;
    setDetail(undefined);
    loadPlace(placeId)
      .then((p) => current && setDetail(p ?? "failed"))
      .catch(() => {
        if (!current) return;
        setDetail("failed");
        track("data_error", { what: "place", place: placeId });
      });
    return () => {
      current = false;
    };
  }, [placeId, detailTry]);

  /** Add live places to the map and the index (curated places always win). `replaces`: ids made redundant. */
  const addPlaces = useCallback((found: PlaceSummary[], replaces: string[] = []) => {
    const known = new Set(placesRef.current.map((p) => p.id));
    const fresh = found.filter((p) => !known.has(p.id));
    if (!fresh.length && !replaces.length) return;
    placesRef.current = [...placesRef.current.filter((p) => !replaces.includes(p.id)), ...fresh];
    setPlaces(placesRef.current);
  }, []);

  const openPlace = useCallback((id: string, via: Via, zoom?: number) => {
    const p = placesRef.current.find((x) => x.id === id);
    if (!p) return;
    const previous = visited.current.size;
    visited.current.add(id);
    setPlaceId(id);
    setLayerIndex(undefined);
    setToday(false);
    setPin({ lng: p.lng, lat: p.lat, key: Date.now() });
    setFly({ lng: p.lng, lat: p.lat, zoom, key: Date.now() });
    setNotice(undefined);
    setPlaceParam(id);
    // "self_directed" = user picked another spot on their own after already exploring one: the key signal.
    track("place_open", { place: id, via, n: visited.current.size, self_directed: via === "tap" && previous > 0 });
  }, []);

  // Map index, deep link, debug flag.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("place");
    loadMapIndex()
      .then(async (index) => {
        placesRef.current = [...index, ...placesRef.current.filter((p) => p.live)];
        setPlaces(placesRef.current);
        if (id && isLiveId(id)) {
          const live = await loadLiveSummary(id).catch(() => undefined);
          if (live) addPlaces([live]);
        }
        if (id && isOsmId(id)) {
          const osm = await loadOsmPlace(id).catch(() => undefined);
          if (osm) addPlaces([summaryOf(osm)]);
        }
        if (id && placesRef.current.some((p) => p.id === id)) openPlace(id, "link");
      })
      .catch(() => {
        setNotice({ kind: "offline" });
        track("data_error", { what: "index" });
      });
    setDebug(params.has("debug"));
    track("session_start", { linked: Boolean(id) });
    const end = () => {
      if (document.visibilityState === "hidden") {
        track("session_end", { seconds: sessionSeconds(), places: visited.current.size, layers: layersOpened.current });
      }
    };
    document.addEventListener("visibilitychange", end);
    return () => document.removeEventListener("visibilitychange", end);
  }, [openPlace, addPlaces]);

  /** Outside the curated dig site: look up live history around the pin. */
  const digLive = useCallback(
    (point: LngLat) => {
      const search = Date.now();
      latestSearch.current = search;
      setNotice({ kind: "searching" });
      const started = performance.now();
      searchLive(point)
        .then((found) => {
          if (latestSearch.current !== search) return; // a newer pin superseded this one
          addPlaces(found);
          track("live_search", { results: found.length, ms: Math.round(performance.now() - started) });
          const ranked = nearestPlaces(found, point);
          const [nearest] = ranked;
          if (!nearest) return setNotice({ kind: "outside", metres: distance(point, AREA_CENTER) });
          if (nearest.metres <= SNAP_METRES) return openPlace(nearest.place.id, "tap");
          // Suggest the most interesting place among those about as close as the nearest one.
          const wow = (p: PlaceSummary) => Math.max(...p.layers.map((l) => l.wow));
          const reach = Math.max(nearest.metres * 1.5, nearest.metres + 1000);
          const best = ranked.filter((r) => r.metres <= reach).sort((a, b) => wow(b.place) - wow(a.place) || a.metres - b.metres)[0];
          setNotice({ kind: "miss", nearestId: best.place.id, metres: best.metres, live: found.length });
          // Zoom in far enough to show the places that were found.
          setFly({ ...point, atLeast: 13, panel: false, key: Date.now() });
        })
        .catch(() => {
          if (latestSearch.current !== search) return;
          setNotice({ kind: "search-failed", point });
          track("data_error", { what: "live_search" });
        });
    },
    [addPlaces, openPlace],
  );

  /** Empty spot: nearest curated place inside the dig site, live search outside it. */
  const digSpot = useCallback(
    (point: LngLat) => {
      if (!inArea(point)) {
        setPin({ ...point, key: Date.now() });
        setPlaceId(undefined);
        // Where people pin outside the dig site = demand for the next curated city.
        track("out_of_area_attempt", { lat: +point.lat.toFixed(1), lng: +point.lng.toFixed(1) });
        return digLive(point);
      }
      const [nearest] = nearestPlaces(placesRef.current, point);
      if (!nearest) return;
      if (nearest.metres <= SNAP_METRES) return openPlace(nearest.place.id, "tap");
      setPin({ ...point, key: Date.now() });
      setPlaceId(undefined);
      setNotice({ kind: "miss", nearestId: nearest.place.id, metres: nearest.metres });
      track("miss", { metres: Math.round(nearest.metres) });
    },
    [openPlace, digLive],
  );

  /** A named thing on the map (shop, temple, station, street, town): open it like a real map, with its history. */
  const openFeature = useCallback(
    (feature: MapFeature) => {
      // The label of a place we already have history for (e.g. the basemap's "Koshy's" next to our dot): open ours.
      const simplify = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      const known = nearestPlaces(placesRef.current, feature)
        .filter((n) => n.metres <= 80)
        .find((n) => simplify(n.place.name).includes(simplify(feature.name)) || simplify(feature.name).includes(simplify(n.place.name)));
      if (known) return openPlace(known.place.id, "tap");

      const lookup = Date.now();
      latestSearch.current = lookup;
      setPin({ lng: feature.lng, lat: feature.lat, key: lookup });
      setPlaceId(undefined);
      setNotice({ kind: "looking", name: feature.name });
      track("map_feature_click", { kind: feature.kind, subclass: feature.subclass ?? "" });
      lookupFeature(feature)
        .then((p) => {
          if (latestSearch.current !== lookup) return;
          if (!p) return digSpot(feature); // OpenStreetMap has nothing here: treat it as an empty spot
          // If this OSM place carries a Wikidata item's history, its separate live dot becomes redundant.
          const redundant = [...new Set(p.layers.map((l) => l.id.match(/^(wd-Q\d+)-/)?.[1]).filter((x): x is string => Boolean(x)))];
          addPlaces([summaryOf(p)], redundant);
          openPlace(p.id, "tap", zoomForFeature(feature));
          track("map_place_open", { kind: feature.kind, history: p.layers.length });
          // Around it, show other places with history (outside the curated dig site).
          if (!inArea(feature)) searchLive(feature).then((found) => addPlaces(found)).catch(() => {});
        })
        .catch(() => {
          if (latestSearch.current !== lookup) return;
          setNotice({ kind: "lookup-failed", feature });
          track("data_error", { what: "map_lookup" });
        });
    },
    [addPlaces, openPlace, digSpot],
  );

  const onMapClick = useCallback(
    (point: LngLat, pixelNearestId?: string, feature?: MapFeature) => {
      track("pin_drop", { inside: inArea(point), feature: Boolean(feature) });
      latestSearch.current = 0;
      if (pixelNearestId) return openPlace(pixelNearestId, "tap");
      if (feature) return openFeature(feature);
      digSpot(point);
    },
    [openPlace, openFeature, digSpot],
  );

  const flyToArea = (via: string) => {
    setNotice(undefined);
    setFly({ ...AREA_CENTER, zoom: window.innerWidth < 760 ? 13.6 : 14.2, panel: false, key: Date.now() });
    track("fly_to_area", { via });
  };

  const digNearby = () => {
    const from = summary ?? pin ?? places[0];
    if (!from) return;
    const next = nearestPlaces(places, from, { exclude: visited.current, era: era === "all" ? undefined : era })[0];
    if (next && next.metres <= NEARBY_MAX_METRES) openPlace(next.place.id, "nearby");
    else setNotice({ kind: "exhausted" });
  };

  const surprise = () => {
    // Only hand-researched places: the best stories we have.
    const pool = places.filter((p) => !p.live && p.layers.some((l) => l.wow >= 4 && layerInEra(l, era)));
    if (!pool.length) return;
    const fresh = pool.filter((p) => !visited.current.has(p.id) && p.id !== placeId);
    const choices = fresh.length ? fresh : pool.filter((p) => p.id !== placeId);
    openPlace(choices[Math.floor(Math.random() * choices.length)].id, "surprise");
  };

  const openLayer = (i: number) => {
    setLayerIndex(i);
    layersOpened.current++;
    track("layer_open", { place: placeId!, layer: place!.layers[i].id, depth: i });
  };

  const share = async () => {
    if (!summary) return;
    const url = `${location.origin}${location.pathname}?place=${summary.id}`;
    const text = `What was here? ${summary.name}${summary.live ? "" : ", Bengaluru"}`;
    track("share_click", { place: summary.id });
    try {
      if (navigator.share) await navigator.share({ title: text, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {}
  };

  const openToday = () => {
    if (!summary) return;
    track("street_view_open", { place: summary.id, embedded: TODAY_IN_APP });
    if (TODAY_IN_APP) setToday(true);
    else window.open(googleMapsUrl(summary), "_blank", "noopener");
  };
  const closeToday = useCallback(() => setToday(false), []);

  const close = () => {
    setPlaceId(undefined);
    setLayerIndex(undefined);
    setToday(false);
    setPlaceParam(undefined);
  };

  const nearestForNotice = notice?.kind === "miss" ? places.find((p) => p.id === notice.nearestId) : undefined;
  // For a clicked map place with no recorded history: the closest places that do have some.
  const nearbyHistory =
    place && place.layers.length === 0
      ? nearestPlaces(places, place, { exclude: new Set([place.id]) }).filter((n) => n.metres <= 3000).slice(0, 3)
      : [];

  return (
    <main className="app">
      <MapView places={places} era={era} pin={pin} flyTo={fly} onClick={onMapClick} onHotspot={() => flyToArea("hotspot")} />

      <header className="topbar">
        <div className="brand">
          <h1>What was here?</h1>
          <p>Now digging: {AREA_NAME}</p>
        </div>
        <button className="surprise" onClick={surprise}>
          Take me somewhere
        </button>
      </header>

      <div className="eras" role="radiogroup" aria-label="Time period">
        {ERAS.map((e) => (
          <button
            key={e.id}
            role="radio"
            aria-checked={era === e.id}
            className={era === e.id ? "on" : ""}
            onClick={() => {
              setEra(e.id);
              track("era_change", { era: e.id });
            }}
          >
            {e.label}
          </button>
        ))}
      </div>

      {!notice && !summary && visited.current.size === 0 && <p className="hint">Drop a pin anywhere on Earth</p>}

      {notice && !summary && (
        <div className="notice" role="status">
          {notice.kind === "miss" && nearestForNotice && (
            <>
              <span>
                Nothing recorded on this exact spot.
                {notice.live ? ` Found ${notice.live} ${notice.live === 1 ? "place" : "places"} with history nearby (not reviewed).` : ""}
              </span>
              <button onClick={() => openPlace(nearestForNotice.id, "hint")}>
                {nearestForNotice.name}, {formatDistance(notice.metres)} →
              </button>
            </>
          )}
          {notice.kind === "searching" && <span aria-busy>Digging through Wikidata and Wikipedia…</span>}
          {notice.kind === "looking" && <span aria-busy>Looking up {notice.name}…</span>}
          {notice.kind === "lookup-failed" && (
            <>
              <span>Couldn&apos;t look up {notice.feature.name}.</span>
              <button onClick={() => openFeature(notice.feature)}>Try again →</button>
            </>
          )}
          {notice.kind === "search-failed" && (
            <>
              <span>Couldn&apos;t search for history here.</span>
              <button onClick={() => digLive(notice.point)}>Try again →</button>
            </>
          )}
          {notice.kind === "outside" && (
            <>
              <strong>No recorded history found within {LIVE_RADIUS_KM} km.</strong>
              <span>
                Our hand-researched stories start in {AREA_NAME}, {formatDistance(notice.metres)} away.
              </span>
              <button onClick={() => flyToArea("outside_notice")}>Fly to {AREA_NAME} →</button>
            </>
          )}
          {notice.kind === "exhausted" && <span>You&apos;ve dug through every place we have so far.</span>}
          {notice.kind === "offline" && <span>Couldn&apos;t load the map&apos;s places. Check your connection and reload.</span>}
        </div>
      )}

      {summary && (
        <aside className="panel" aria-label={`History of ${summary.name}`}>
          <div className="panel-grip" aria-hidden />
          <button className="close" onClick={close} aria-label="Close">
            ×
          </button>
          <div className="panel-scroll">
            {today ? (
              <StreetView place={summary} onBack={closeToday} />
            ) : !place ? (
              <header className="stack-head" aria-busy={detail !== "failed"}>
                <p className="eyebrow">
                  {detail === "failed" ? (
                    <button className="link" onClick={() => setDetailTry((n) => n + 1)}>Couldn&apos;t dig this up. Try again</button>
                  ) : (
                    "Digging…"
                  )}
                </p>
                <h2>{summary.name}</h2>
              </header>
            ) : layerIndex === undefined ? (
              <LayerStack
                place={place}
                era={era}
                onOpen={openLayer}
                onToday={openToday}
                todayExternal={!TODAY_IN_APP}
                nearby={nearbyHistory}
                onOpenPlace={(id) => openPlace(id, "hint")}
              />
            ) : (
              <LayerCard place={place} index={layerIndex} onIndex={openLayer} onBack={() => setLayerIndex(undefined)} />
            )}
          </div>
          <footer className="panel-actions">
            <button onClick={digNearby}>Dig nearby →</button>
            <button onClick={share}>{copied ? "Link copied" : "Share"}</button>
          </footer>
          <p className="panel-credit">
            Map: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ©{" "}
            <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · Data ©{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>
          </p>
        </aside>
      )}

      {debug && <DebugLog />}
    </main>
  );
}

function setPlaceParam(id: string | undefined) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("place", id);
  else url.searchParams.delete("place");
  history.replaceState(null, "", url);
}

function DebugLog() {
  const [log, setLog] = useState(readLog());
  useEffect(() => {
    const t = setInterval(() => setLog(readLog()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <pre className="debug">
      {log.slice(-12).map((e) => `${e.t}s ${e.name} ${JSON.stringify({ ...e, name: undefined, t: undefined })}`).join("\n")}
    </pre>
  );
}
