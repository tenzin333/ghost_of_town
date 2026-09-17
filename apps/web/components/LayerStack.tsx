"use client";

import type { Place, PlaceSummary } from "@wwh/schema";
import { layerInEra, spanLabel, yearLabel, type EraId } from "@/lib/data";
import { formatDistance } from "@/lib/geo";

type Props = {
  place: Place;
  era: EraId;
  onOpen: (index: number) => void;
  /** Opens Street View of the spot today. `external` = it leaves the app (no Google key configured). */
  onToday: () => void;
  todayExternal: boolean;
  /** For a place with no recorded history: nearby places that have some. */
  nearby?: { place: PlaceSummary; metres: number }[];
  onOpenPlace?: (id: string) => void;
};

export default function LayerStack({ place, era, onOpen, onToday, todayExternal, nearby = [], onOpenPlace }: Props) {
  const n = place.layers.length;
  const info = place.info;
  return (
    <section className="stack">
      <header className="stack-head">
        <p className="eyebrow">
          {n ? `${n} ${n === 1 ? "layer" : "layers"}` : "No recorded history yet"}
          {spanLabel(place) && ` · ${spanLabel(place)}`}
        </p>
        <h2>{place.name}</h2>
        {info && (info.category || info.address) && (
          <p className="place-info">
            {info.category && <span className="place-category">{info.category}</span>}
            {info.address && <span>{info.address}</span>}
          </p>
        )}
        {info?.osmUrl && (
          <p className="place-links">
            <a href={info.osmUrl} target="_blank" rel="noopener">OpenStreetMap ↗</a>
            {info.website && (
              <a href={info.website} target="_blank" rel="noopener">Website ↗</a>
            )}
          </p>
        )}
        {place.live && n > 0 && <p className="live-note">History from Wikidata, Wikipedia, Commons and OpenStreetMap · not reviewed by us</p>}
        {place.geoPrecision !== "building" && place.geoPrecision !== "exact" && (
          <p className="precision">Located to {place.geoPrecision} level</p>
        )}
      </header>

      <ol className="strata">
        <li className="stratum surface">
          <button onClick={onToday}>
            <span className="stratum-year">Today</span>
            <span className="stratum-title">
              See it today at street level
              <span className="stratum-hook">{n ? "Then dig down through what was here" : "Street photos of this spot"}</span>
            </span>
            <span className="stratum-icons" aria-hidden>{todayExternal ? "↗" : "◉"}</span>
          </button>
        </li>
        {place.layers.map((l, i) => {
          const depth = n > 1 ? i / (n - 1) : 0;
          const dim = era !== "all" && !layerInEra(l, era);
          return (
            <li key={l.id} className={`stratum${dim ? " dim" : ""}`} style={{ "--depth": depth } as React.CSSProperties}>
              <button onClick={() => onOpen(i)}>
                <span className="stratum-year">{yearLabel(l)}</span>
                <span className="stratum-title">
                  {l.title}
                  {l.hook && <span className="stratum-hook">{l.hook}</span>}
                </span>
                <span className="stratum-icons">
                  {l.media && <span title="Has image">▣</span>}
                  {l.confidence === "legend" && <span title="Local legend">✦</span>}
                  {l.confidence === "disputed" && <span title="Sources disagree">?</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {n === 0 && (
        <div className="no-history">
          <p>Nothing about this place&apos;s past is recorded in Wikidata or OpenStreetMap yet.</p>
          {nearby.length > 0 && (
            <>
              <h3>History nearby</h3>
              <ul>
                {nearby.map(({ place: p, metres }) => (
                  <li key={p.id}>
                    <button className="link" onClick={() => onOpenPlace?.(p.id)}>
                      {p.name}, {formatDistance(metres)} →
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
