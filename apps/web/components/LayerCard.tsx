"use client";

import { useEffect } from "react";
import type { Layer, Place } from "@wwh/schema";
import { yearLabel } from "@/lib/data";
import { track } from "@/lib/analytics";

const BADGE: Record<Layer["confidence"], { label: string; title: string }> = {
  verified: { label: "Sourced", title: "Every fact here comes from the sources below." },
  disputed: { label: "Sources disagree", title: "Our sources give different details; the story says how." },
  legend: { label: "Local legend", title: "Reported lore. Not independently verified." },
  unreviewed: {
    label: "Not reviewed",
    title: "Pulled live from Wikidata, Wikipedia and Wikimedia Commons for this spot. Shown in the sources' own words; not checked by us.",
  },
};

type Props = {
  place: Place;
  index: number;
  onIndex: (i: number) => void;
  onBack: () => void;
};

export default function LayerCard({ place, index, onIndex, onBack }: Props) {
  const layer = place.layers[index];
  const newer = index > 0 ? index - 1 : undefined;
  const deeper = index < place.layers.length - 1 ? index + 1 : undefined;
  const badge = BADGE[layer.confidence];
  const depth = place.layers.length > 1 ? index / (place.layers.length - 1) : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" && deeper !== undefined) onIndex(deeper);
      if (e.key === "ArrowUp" && newer !== undefined) onIndex(newer);
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deeper, newer, onIndex, onBack]);

  return (
    <article className="card" style={{ "--depth": depth } as React.CSSProperties}>
      <button className="link back" onClick={onBack}>
        ← {place.name}
      </button>

      {layer.media ? (
        <figure className="card-media">
          <img src={layer.media.src} width={layer.media.width} height={layer.media.height} alt={layer.title} />
          <figcaption>
            <a href={layer.media.sourceUrl} target="_blank" rel="noopener">
              {layer.media.credit}
            </a>{" "}
            ·{" "}
            {layer.media.licenceUrl ? (
              <a href={layer.media.licenceUrl} target="_blank" rel="noopener">
                {layer.media.licence}
              </a>
            ) : (
              layer.media.licence
            )}
          </figcaption>
        </figure>
      ) : (
        <div className="card-plate" aria-hidden>
          <span className="plate-type">{layer.type}</span>
          <span className="plate-year">{yearLabel(layer)}</span>
        </div>
      )}

      <div className="card-body">
        <div className="card-meta">
          <span className="year">{yearLabel(layer)}</span>
          <span className={`badge badge-${layer.confidence}`} title={badge.title}>
            {badge.label}
          </span>
        </div>
        <h2>{layer.title}</h2>
        <p className="story">{layer.story}</p>

        <div className="sources">
          <h3>Sources</h3>
          <ul>
            {layer.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener" onClick={() => track("source_click", { layer: layer.id })}>
                  {s.label} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <nav className="card-nav">
        <button disabled={newer === undefined} onClick={() => newer !== undefined && onIndex(newer)}>
          ↑ {newer !== undefined ? yearLabel(place.layers[newer]) : "Surface"}
        </button>
        <span>
          Layer {index + 1} of {place.layers.length}
        </span>
        <button disabled={deeper === undefined} onClick={() => deeper !== undefined && onIndex(deeper)}>
          {deeper !== undefined ? yearLabel(place.layers[deeper]) : "Bedrock"} ↓
        </button>
      </nav>
    </article>
  );
}
