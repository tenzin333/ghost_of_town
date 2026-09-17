# Go / no-go (2026-09-14)

Measured from `data/candidates.csv` (44 rows). All 48 source and media URLs returned HTTP 200.

| Gate | Target | Result | |
|---|---|---|---|
| Items with verified sources | ≥ 30 | **37** verified (+6 likely, 1 legend) | ✅ |
| Building/street precision | ≥ 60 % | **84 %** (27 exact/building, 10 street, 7 area) | ✅ |
| Items with reusable images | ≥ 15 | **21** (PD / CC BY-SA) | ✅ |
| Places with 3+ layers | ≥ 8 | **6** (MG Road metro ×4, Attara Kacheri ×4, Freedom Park, Bangalore Club, St Mark's, Rex) | ⚠️ short by 2 |
| Differentiation | clear | Yes: place biographies vs photo-first competitors (see competitors.md) | ✅ |

Time coverage per 25 years: 1800s 2 · 1825 2 · 1850 6 · 1875 3 · 1900 6 · 1925 9 · 1950 4 · 1975 3 · 2000 6. The whole timeline is populated, and the 1975–2000 stretch is thinnest.

## Verdict: **CONDITIONAL GO**
The data is good enough for a compelling 2×2 km experience, and the stacks that exist are strong (Plaza → metro, jail → Freedom Park, lake → stadium).

### Findings that change the plan
1. **Photos alone can't carry this.** Historic images cluster in 1839–1923; 1930–2005 (cinemas, hotels, cafés) is text + link only. Layers must work well **without an image**, e.g. typographic "story cards" rather than empty photo frames.
2. **Geolocation is fully manual.** None of the historic Commons images had coordinates, but all show named landmarks, so building-level placement is easy. Lost businesses (Galaxy, Imperial, Blu Moon) are the hard ones; they need addresses from news archives.
3. **Wikipedia/Wikidata are weak exactly where the "wow" is**: demolished and forgotten places. News features fill that gap, but only as citations.
4. **Data conflicts exist** (St Mark's 1808 vs 1812; Cubbon statue moved 2019 vs 2020). The UI should show "sources disagree" honestly.
5. **Lore needs its own label** (Victoria Hotel / Churchill reading room).
6. **Time Portal** is a real global competitor; **BLR Yesterday** is a local map-layer ally.

## Before building (≈ 1 evening)
- [ ] Get 2 more places to 3+ layers. Best bets: Kanteerava Stadium (renaming date), Cubbon Park (Cubbon statue arrival 2020), Victoria Hotel/Bangalore Central (hotel opening year).
- [ ] Resolve the two date conflicts, and add a 2nd source for the Churchill Rs 13 debt and the first KFC.
- [ ] Pin exact addresses for Rex, Victoria Hotel, Galaxy, Imperial.
- [ ] Manual competitor checks: Time Portal in-app coverage of Bengaluru; BLR Yesterday owner + map licence.

## Kill / pivot triggers during validation
- Testers open fewer than 3 layers per session on average → the stack concept isn't pulling.
- Most pins land > 300 m from any place → density is too low; shrink the area or pivot to curated "journeys".
