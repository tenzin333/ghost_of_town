# Simplest drop-a-pin UI

## 1. Map (first screen, no onboarding)
```
┌──────────────────────────────┐
│ What was here?     [🎲 Surprise]│
│                              │
│   ░░▒▒▓▓  ← warm glow where   │
│  ░▒▓██▓▒░   layers are dense   │
│   ░▒▓▓▒░                      │
│  - - - boundary (dimmed out) - │
│                              │
│  Tap anywhere to dig ↓        │
└──────────────────────────────┘
```
No markers, just the density glow, which keeps the mystery and never looks empty.

## 2. Pin dropped → snap
- A place within 150 m: the pin slides to it with a small "dig" animation.
- Nothing close: "Nothing recorded right here. **Plaza Theatre site, 120 m →**" (tap to jump).
- Outside the area: "We only dig in central Bengaluru for now. **Tell us where you want next**", which logs `out_of_area_attempt`.

## 3. Layer stack (bottom sheet): the core
```
┌──────────────────────────────┐
│ MG Road metro station          │
│ 4 layers · 1936 → today         │
│ ───────────────────────────── │
│ 2011  Metro station opens      │  ← surface
│ 2005  Last film: Meet the Fockers│
│ 1959  Ten Commandments, 44 wks │
│ 1936  Plaza Theatre opens  🖼   │  ← deepest
│ ───────────────────────────── │
│ [ Dig somewhere nearby → ]     │
└──────────────────────────────┘
```
Reads top→bottom as digging down. Each deeper row gets an older, more sepia tone. A 🖼 icon marks rows with an image.

## 4. Layer card
Image (or a typographic card when there's none) · year · headline hook · ≤ 80-word story · **Sources** (links) · licence/credit · badge: *Verified* / *Sources disagree* / *Local legend*. Swipe up or down to move between layers.
Then/Now slider appears only if a modern pair exists.

## 5. Exits (retention loop)
"Dig nearby" (nearest unvisited place) · "🎲 Surprise" (random wow ≥ 4) · a share button that deep-links `?place=plaza`.
