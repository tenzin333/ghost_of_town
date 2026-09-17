# Data sources, tested against the Cantonment core (centre 12.9740, 77.6000, r = 2.5 km)

## What the queries actually returned

| Source | How queried | Result | Dated? | Geolocated? | Reusable? | Verdict |
|---|---|---|---|---|---|---|
| **Wikimedia Commons, geosearch** | `list=geosearch`, 2.5 km | 500+ files (capped), **almost all 2004–2026 photos** (aquarium, Lamborghinis…) | Modern | Yes | CC | Only useful for **"Now" photos** in Then/Now pairs |
| **Wikimedia Commons, categories** | Crawl of *Bangalore in the 19th century*, *…1900s*, *British India – Bangalore C&M Station* | **~55 historic images 1839–1923** of named landmarks (St Mark's, St Andrew's, Attara Kacheri, Cubbon Park, Museum, U.S. Club, Residency, Ulsoor Tank, Commercial St, South Parade) | Yes (year) | **No coordinates**, but the landmark is named, so manual placement at building precision | ~50 PD, a few CC BY-SA 3.0 | **Primary image source.** |
| **Commons, Mythic Society** | Category crawl | ~690 CC BY-SA 4.0 scans of inscriptions and hero stones from **400–1800 CE** across greater Bengaluru | Yes (in title) | Some | CC BY-SA 4.0 | **Deep-time layer.** Mostly outside the 2×2 km box; Wikidata coordinates for several are a placeholder (77.5958, 12.9748). |
| **Wikidata SPARQL** | `wikibase:around` 2.5 km, with P571/P576 | 314 items, ~90 with inception dates (1812 St Mark's … 2011 metro). Few *dissolved/demolished* dates. | Yes | Yes | CC0 | **Backbone for coordinates + founding years.** Weak on lost places. |
| **English Wikipedia** | Extracts API for 38 articles | Rich for institutions; gives the "what was here before" facts (Central Jail → Freedom Park, Sampangi Lake → stadium, Plaza → metro) | Yes | Mostly | CC BY-SA text; we write our own summaries and cite | **Primary fact source for 1800s–2000s.** Nearly empty for mid-century businesses (no Galaxy or Rex articles). |
| **News features** (The News Minute, Citizen Matters, Deccan Herald, Homegrown) | Web search | The only source for **lost cinemas, hotels, cafés** (Rex, Galaxy, Imperial, Blu Moon, Victoria Hotel) | Yes | Street-level at best | **Copyrighted**: cite and link only, no images | **Essential for 1930–2005**, but always as text + link. |
| **OSM Nominatim** | Name search inside bbox | Present-day coordinates for 16/18 landmarks | — | Yes | ODbL | Used for placement. |
| **BLR Yesterday maps** | Visual | 1854 / 1920 / 1940 / 1960 map layers | Yes | Georeferenced | Unknown | Potential partner for a map layer. |
| **Commons PD maps** | Found in crawl | *Bangalore cantonment* plan (1854), *Bangalore Cantonment* view (1895) | Yes | Needs georeferencing | PD | Good "Historical map" layer. |

## Not yet queried (next pass)
- British Library Online Gallery and David Rumsey (georeferenced Survey of India sheets)
- Internet Archive: *Picturesque Bangalore* (Doveton, 1900), Rice's *Mysore Gazetteer*, Maya Jayapal's *Bangalore: The Story of a City* (a book to buy, not copy)
- OpenHistoricalMap, and OSM `historic=*` / `was:*` tags
- indianculture.gov.in, Karnataka State Archives

## Ranking by "dated + geolocatable + reusable"
1. Commons historic categories (images) + Wikipedia/Wikidata (facts + coordinates)
2. News features (the only source for mid-century lost places, text only)
3. Mythic Society (deep time, but outside the area)
4. Map archives (one layer per era, not per place)

**Pipeline reality:** found → dated was easy. **Geolocated is manual** (no historic image had coordinates). **Verified** means two independent sources for the headline claim. **Normalized** is the CSV in `data/candidates.csv`.
