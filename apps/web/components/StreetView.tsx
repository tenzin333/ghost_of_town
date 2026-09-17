"use client";

import { useEffect, useState } from "react";
import type { PlaceSummary } from "@wwh/schema";
import { embedUrl as googleEmbedUrl, GOOGLE_KEYLESS_DEV, GOOGLE_STREET_VIEW, googleMapsUrl, imageryDate } from "@/lib/streetview";
import { appUrl as mapillaryUrl, embedUrl as mapillaryEmbedUrl, MAPILLARY } from "@/lib/mapillary";
import { findToday, type Today } from "@/lib/today";
import { formatDistance } from "@/lib/geo";
import { track } from "@/lib/analytics";

type Props = {
  place: Pick<PlaceSummary, "id" | "name" | "lat" | "lng">;
  onBack: () => void;
};

/** The "Today" surface: street-level imagery of the spot as it is now (Google Street View or Mapillary). */
export default function StreetView({ place, onBack }: Props) {
  const [today, setToday] = useState<Today | null | "failed">();
  const [attempt, setAttempt] = useState(0);
  // Local development only: Google's keyless embed as a tab beside the official sources (see GOOGLE_KEYLESS_DEV).
  const [tab, setTab] = useState<"google-dev" | "sources">(GOOGLE_KEYLESS_DEV ? "google-dev" : "sources");
  const hasSources = GOOGLE_STREET_VIEW || MAPILLARY;

  useEffect(() => {
    if (tab !== "sources" || !hasSources) return;
    let current = true;
    setToday(undefined);
    findToday(place)
      .then((t) => {
        if (!current) return;
        setToday(t);
        const metres = t?.source === "google" ? t.pano.metres : t?.source === "mapillary" ? t.image.metres : -1;
        track("street_view_result", { place: place.id, source: t?.source ?? "none", metres: Math.round(metres) });
      })
      .catch(() => {
        if (!current) return;
        setToday("failed");
        track("data_error", { what: "street_view", place: place.id });
      });
    return () => {
      current = false;
    };
  }, [place, attempt, tab, hasSources]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const external = (source: string) => () => track("street_view_external", { place: place.id, source });

  return (
    <article className="today">
      <button className="link back" onClick={onBack}>
        ← {place.name}
      </button>
      <div className="today-head">
        <p className="eyebrow">Today · {tab === "sources" && today && typeof today === "object" && today.source === "mapillary" ? "Street photos" : "Street View"}</p>
        <p className="today-note">How this spot looks now. The layers below are what was here before.</p>
        {GOOGLE_KEYLESS_DEV && hasSources && (
          <div className="today-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "google-dev"} className={tab === "google-dev" ? "on" : ""} onClick={() => setTab("google-dev")}>
              Google (dev)
            </button>
            <button role="tab" aria-selected={tab === "sources"} className={tab === "sources" ? "on" : ""} onClick={() => setTab("sources")}>
              {GOOGLE_STREET_VIEW ? "Street View" : "Mapillary"}
            </button>
          </div>
        )}
      </div>

      {GOOGLE_KEYLESS_DEV && tab === "google-dev" && (
        <>
          <iframe
            className="today-frame"
            src={`https://maps.google.com/maps?layer=c&cbll=${place.lat},${place.lng}&cbp=11,0,0,0,0&output=svembed`}
            title={`Google Street View near ${place.name} (development only)`}
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
          <p className="today-credit">
            Google Street View · <strong>local development only</strong>: unofficial keyless embed, nearest panorama (may be indoors) ·{" "}
            <a href={googleMapsUrl(place)} target="_blank" rel="noopener" onClick={external("google")}>Open in Google Maps ↗</a>
          </p>
        </>
      )}

      {tab === "sources" && today === undefined && <div className="today-frame today-empty" aria-busy>Looking for street-level photos…</div>}

      {tab === "sources" && today === null && (
        <div className="today-frame today-empty">
          <span>No street-level photos near this spot yet.</span>
          <a href={googleMapsUrl(place)} target="_blank" rel="noopener" onClick={external("google")}>Look around in Google Maps ↗</a>
        </div>
      )}

      {tab === "sources" && today === "failed" && (
        <div className="today-frame today-empty">
          <span>Couldn&apos;t load street-level photos.</span>
          <button className="link" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          <a href={googleMapsUrl(place)} target="_blank" rel="noopener" onClick={external("google")}>Open in Google Maps ↗</a>
        </div>
      )}

      {tab === "sources" && today && typeof today === "object" && today.source === "google" && (
        <>
          <iframe
            className="today-frame"
            src={googleEmbedUrl(today.pano)}
            title={`Street View near ${place.name}`}
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
          <p className="today-credit">
            Imagery © Google{today.pano.date && `, ${imageryDate(today.pano.date)}`}
            {today.pano.metres >= 15 && ` · taken ${formatDistance(today.pano.metres)} away`} ·{" "}
            <a href={googleMapsUrl(place, today.pano)} target="_blank" rel="noopener" onClick={external("google")}>
              Open in Google Maps ↗
            </a>
          </p>
        </>
      )}

      {tab === "sources" && today && typeof today === "object" && today.source === "mapillary" && (
        <>
          <iframe
            className="today-frame"
            src={mapillaryEmbedUrl(today.image)}
            title={`Mapillary street photo near ${place.name}`}
            loading="lazy"
            allowFullScreen
          />
          <p className="today-credit">
            Photo {today.image.creator ? `by ${today.image.creator} ` : ""}via{" "}
            <a href={mapillaryUrl(today.image)} target="_blank" rel="noopener" onClick={external("mapillary")}>Mapillary ↗</a>,{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>
            {today.image.capturedAt && `, ${new Date(today.image.capturedAt).toLocaleString("en", { month: "short", year: "numeric" })}`}
            {today.image.metres >= 15 && ` · taken ${formatDistance(today.image.metres)} away`}
          </p>
        </>
      )}
    </article>
  );
}
