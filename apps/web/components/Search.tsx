"use client";

import { useEffect, useRef, useState } from "react";
import { searchPlaces, type SearchHit } from "@/lib/search";

/** Nominatim allows one request a second, so wait for a pause in typing before asking. */
const DEBOUNCE_MS = 450;

type Props = { onPick: (hit: SearchHit) => void };

export default function Search({ onPick }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(0);
  /** The name written into the box by picking a result, so the search effect can tell it apart from typing. */
  const pickedName = useRef<string | null>(null);

  useEffect(() => {
    // Picking a result puts its name in the box. That is not someone searching for it, so don't search again —
    // doing so reopened the list on top of the place they had just opened.
    if (pickedName.current !== null && query === pickedName.current) return;
    pickedName.current = null;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setBusy(false);
      setFailed(false);
      return;
    }
    setBusy(true);
    setFailed(false);
    const mine = ++latest.current;
    const timer = setTimeout(() => {
      searchPlaces(q)
        .then((found) => {
          if (latest.current !== mine) return; // a later keystroke won
          setHits(found);
          setActive(0);
          setOpen(true);
        })
        .catch(() => {
          if (latest.current !== mine) return;
          setFailed(true);
          setOpen(true); // otherwise a failed search shows nothing at all
        })
        .finally(() => latest.current === mine && setBusy(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Clicking anywhere else closes the results.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const choose = (hit: SearchHit) => {
    latest.current++; // discard any search still in flight, so it can't reopen the list after the pick
    pickedName.current = hit.name;
    setOpen(false);
    setBusy(false);
    setQuery(hit.name);
    onPick(hit);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (!open || !hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(hits[active]);
    }
  };

  const showList = open && (hits.length > 0 || failed || (!busy && query.trim().length >= 2));

  return (
    <div className="search" ref={box}>
      <input
        type="search"
        value={query}
        placeholder="Search anywhere — France, Palais-Royal…"
        aria-label="Search for a place"
        role="combobox"
        aria-expanded={showList}
        aria-controls="search-results"
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {busy && <span className="search-busy" aria-hidden />}
      {showList && (
        <ul className="search-results" id="search-results" role="listbox">
          {failed && <li className="search-empty">Couldn&apos;t reach the search service.</li>}
          {!failed && hits.length === 0 && <li className="search-empty">Nothing found.</li>}
          {hits.map((hit, i) => (
            <li key={hit.id} role="option" aria-selected={i === active}>
              <button className={i === active ? "on" : ""} onMouseEnter={() => setActive(i)} onClick={() => choose(hit)}>
                <span className="search-name">{hit.name}</span>
                {hit.kind && <span className="search-kind">{hit.kind}</span>}
                {hit.detail && <span className="search-detail">{hit.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
