# 8-Bit Character Head Avatar Research

Primary-source evaluation of free, open-source 8-bit and pixel-art character head avatar libraries, asset packs, and in-repo component architectures for `idle-smoke-break`.

## Existing Avatar Touchpoints in the Codebase

Today, player avatars are rendered as 2-letter callsign initials (`getInitials(callsign)`) across three UI surfaces, plus a static line icon in the top-right HUD trigger:

- [`src/smokebreak/UserProfileMenu.tsx`](../src/smokebreak/UserProfileMenu.tsx): Top-right `UserCircleTrigger` (`24x24` SVG button) and the Quick User Profile Card popover (`.proto-discord-avatar`).
- [`src/smokebreak/ScoreboardScreen.tsx`](../src/smokebreak/ScoreboardScreen.tsx): Top-3 podium figures (`.proto-sb-podium-avatar`), challenger list rows (`.proto-sb-avatar`), Smoke Session standings, and the sticky personal rank bar.
- [`src/smokebreak/ScoreboardPrototype.tsx`](../src/smokebreak/ScoreboardPrototype.tsx): Scoreboard variants A, B, and C (podium, telemetry table, and head-to-head rivalry comparator).
- [`src/smokebreak/SmokeSessionLobby.tsx`](../src/smokebreak/SmokeSessionLobby.tsx): Pre-shift 2-digit crew waiting room roster.

### Architectural Constraints

Any avatar solution in this repository must satisfy:

1. **Offline & Capacitor Native Support:** Must render with zero external HTTP calls so offline shifts and iOS/Android Capacitor builds work identically to web ([`docs/mobile.md`](./mobile.md)).
2. **Strict Security & CSP Compatibility:** No `eval()` or `new Function()`, and ideally rendered as native React `<svg>` elements rather than raw HTML strings ([`SECURITY.md`](../SECURITY.md)).
3. **Zero Dead Code / Minimal Dependencies:** Checked by `npm run knip` and `npm run typecheck` in CI.
4. **Brand & Token Alignment:** Pure Obsidian surfaces (`--as-bg-base: #0a0a0c`, `--as-bg-elevated: #18181f`) and Radioactive Lime accents (`--as-accent-primary: #84cc16`), with no emojis anywhere in UI or docs.

---

## Candidate Comparison Matrix

| Candidate | Visual Style | Code License | Artwork License | Runtime Bundle (Min / Gzip / Brotli) | Transitive Deps | Browser & Capacitor Safe? | Verdict |
|---|---|---|---|---|---|---|---|
| **In-Repo 16x16 SVG Component** *(with CC0 DiceBear `pixel-art` base paths + custom props)* | 8-bit shift-worker heads (hard hat, beanie, shades, stubble, lit cigarette + ember, high-vis collar) | Project license | **CC0 1.0** + First-party | **~4-8 KB raw / ~1.5-2.5 KB gzip** | **0** | Yes (native React `<svg shapeRendering="crispEdges">`) | **Recommended (#1)** |
| **DiceBear v9 LTS** (`@dicebear/core@9.4.3` + `@dicebear/pixel-art@9.4.3`) | 16x16 8-bit character head & shoulders (45 hairs, 14 glasses, 10 hats, 8 beards, 23 clothes) | MIT | **CC0 1.0** (No attribution required) | **39.1 KB raw / 9.2 KB gzip / 7.7 KB brotli** | 1 types-only (`@types/json-schema`) | Yes (pure JS string, 0 network calls) | **Best turnkey npm package (#2)** |
| **DiceBear v10** (`@dicebear/core@10.7.0` + `@dicebear/styles@10.6.0/pixel-art.json`) | Identical 16x16 `pixel-art` output + new `voxel-art` (128x128) & `pixelbot` (100x100) | MIT | **CC0 1.0** (`pixel-art`, `voxel-art`, `pixelbot`) | **199.9 KB raw / 30.6 KB gzip / 24.7 KB brotli** | **0** | Yes (uses precompiled `@exodus/schemasafe`) | 3.3x heavier gzip than v9 LTS due to bundled JSON schema validator |
| **`minidenticons@4.2.1`** | 5x5 symmetric blocky identicon (GitHub style, not a face) | MIT | N/A (algorithmic) | **1.2 KB raw / 0.8 KB gzip / 0.7 KB brotli** | **0** | Yes | Tiny retro fallback, but abstract blocks rather than character heads |
| **`pixel-avatar-lib@1.0.0`** | 8-bit pixel character face on `<canvas>` via DNA string (`"0-1-2-3-4-5"`) | Apache-2.0 | Apache-2.0 | ~108.9 KB unpacked | **0** (peer: `react >=16.8`) | Yes (`<canvas>`) | Weak maintenance (single v1.0.0 release), `<canvas>` only |
| **`boring-avatars@2.0.4`** | Geometric flat SVG (`pixel`, `beam`, `bauhaus`, `ring`, `sunset`, `marble`) | MIT | MIT | **11.3 KB raw / 3.1 KB gzip / 2.6 KB brotli** | **0** (peer: `react >=18`) | Yes | Not 8-bit character heads (`pixel` variant is an abstract color grid) |
| **`jdenticon@3.3.0`** | Geometric vector polygons | MIT | MIT | **8.1 KB raw / 4.0 KB gzip / 3.6 KB brotli** | `canvas-renderer` | Yes | Abstract geometric polygons, not pixel art |
| **`react-nice-avatar@1.5.0`** | Smooth flat vector illustration | MIT | MIT / Figma CC | **50.4 KB raw / 18.0 KB gzip** (+ `chroma-js`) | `chroma-js`, `prop-types`, `@babel/runtime` | Yes | Wrong aesthetic (SaaS vector), pulls in legacy CJS deps |
| **`avataaars@2.0.0`** | Flat vector cartoon (Pablo Stanley style) | MIT | MIT | **1,062 KB unpacked** | `lodash`, `prop-types` (peer: `react ^17.0.0`) | Peer dep conflict on React 18 | Unmaintained, peer-dep conflict with React 18, heavy `lodash` dependency |
| **`pixel-avatars@0.0.3` / `avatar-generator@2.0.4`** | Node CLI/server PNG sprite combiners | MIT | MIT | Node-only | **`sharp`** (native C++ libvips) | **No** | Disqualified — native Node `sharp` dependency cannot run in browser or Capacitor |
| **Kenney.nl CC0 Packs** (`roguelike-characters`, `1-bit-pack`, `monochrome-rpg`) | 16x16 / 8x8 PNG sprite sheets | N/A | **CC0 1.0 Universal** | ~5-25 KB PNG sheet | **0** | Yes (local PNG + `image-rendering: pixelated`) | Good static sprite source, but full-body RPG sprites rather than head portraits |

---

## 1. DiceBear (`@dicebear/*`)

### Primary Sources
- **Main Monorepo:** <https://github.com/dicebear/dicebear> ([MIT License](https://github.com/dicebear/dicebear/blob/10.x/LICENSE))
- **Styles Repository:** <https://github.com/dicebear/styles>
- **License Overview:** <https://www.dicebear.com/licenses/>
- **Style Documentation:**
  - `pixel-art`: <https://www.dicebear.com/styles/pixel-art/>
  - `pixel-art-neutral`: <https://www.dicebear.com/styles/pixel-art-neutral/>
  - `adventurer`: <https://www.dicebear.com/styles/adventurer/>
  - `lorelei`: <https://www.dicebear.com/styles/lorelei/>
  - `bottts`: <https://www.dicebear.com/styles/bottts/>
- **npm Packages:**
  - `@dicebear/core`: <https://www.npmjs.com/package/@dicebear/core>
  - `@dicebear/styles`: <https://www.npmjs.com/package/@dicebear/styles>
  - `@dicebear/pixel-art`: <https://www.npmjs.com/package/@dicebear/pixel-art>
  - `@dicebear/pixel-art-neutral`: <https://www.npmjs.com/package/@dicebear/pixel-art-neutral>

### Version Architecture: v9 LTS vs. v10
Inspecting the npm registry artifacts and GitHub `9.x` vs `10.x` branches reveals an important bundle tradeoff:

1. **DiceBear v9 LTS (`@dicebear/core@9.4.3` + `@dicebear/pixel-art@9.4.3`):**
   - Each style is a standalone ES module with SVG paths compiled into JS functions.
   - `@dicebear/core@9.4.3` ESM is **7.5 KB raw / 3.1 KB gzip**, and `@dicebear/pixel-art@9.4.3` ESM is **31.6 KB raw / 6.1 KB gzip** (**39.1 KB raw / 9.2 KB gzip combined**).
2. **DiceBear v10 (`@dicebear/core@10.7.0` + `@dicebear/styles@10.6.0`):**
   - Replaces per-style JS packages with cross-language JSON definitions (`@dicebear/styles/pixel-art.json` -> `43.8 KB raw / 4.9 KB gzip`).
   - Bundles precompiled `@exodus/schemasafe` JSON Schema validators inside `@dicebear/core@10.7.0` (`156.1 KB raw / 25.7 KB gzip`).
   - Verified CSP-safe (zero `eval()` or `new Function()` calls in `lib/index.js`), but totals **199.9 KB raw / 30.6 KB gzip** — **3.3x larger** than v9 LTS for identical `pixel-art` SVG output.

### Style Licenses & Trait Inventory
Verified directly against `https://github.com/dicebear/styles/tree/main/src`:

| Style | Grid ViewBox | Code License | Artwork License | Attribution Required? | Traits & Variants |
|---|---|---|---|---|---|
| **`pixel-art`** | `16x16` (`shape-rendering="crispEdges"`) | MIT | **CC0 1.0 Universal** ([Figma](https://www.figma.com/community/file/1198754108850888330)) | **No** | `hair` (45: `short01`-`24`, `long01`-`21`), `mouth` (23: `happy01`-`13`, `sad01`-`10`), `clothes` (23), `glasses` (14: `dark01`-`07`, `light01`-`07`), `eyes` (12), `hat` (10), `beard` (8), `accessories` (4) |
| **`pixel-art-neutral`** | `14x14` (`shape-rendering="crispEdges"`) | MIT | **CC0 1.0 Universal** | **No** | Cropped face-only (`eyes` 12, `glasses` 14, `mouth` 23) |
| **`voxel-art`** *(v10)* | `128x128` | MIT | **CC0 1.0 Universal** | **No** | `top` (21), `mouth` (10), `outfit` (10), `eyes` (8), `glasses` (5), `beard` (4), `eyebrows` (4), `nose` (4), `cheeks` (3) |
| **`pixelbot`** *(v10)* | `100x100` | MIT | **CC0 1.0 Universal** | **No** | `eyes` (7), `mouth` (5) |
| **`lorelei`** | `980x980` (smooth vector) | MIT | **CC0 1.0 Universal** | **No** | Smooth vector portrait by Lisa Wischofsky; not 8-bit |
| **`adventurer`** | `762x762` (smooth vector) | MIT | **CC BY 4.0** | **Yes** (Lisa Wischofsky) | Smooth vector illustration; requires UI attribution under CC BY 4.0 |
| **`bottts`** | `180x180` (smooth vector) | MIT | Custom free license (<https://bottts.com/>) | No | Smooth vector robots by Pablo Stanley; not 8-bit |

---

## 2. Other npm / GitHub Pixel-Art & Avatar Libraries

- **`matveyco/8biticon` ([GitHub](https://github.com/matveyco/8biticon)) & `avatar-generator@2.0.4` ([npm](https://www.npmjs.com/package/avatar-generator) | [GitHub](https://github.com/arusanov/avatar-generator)):**
  - `matveyco/8biticon` has no `LICENSE` file in its repository (all rights reserved by default).
  - `avatar-generator` (MIT) wraps PNG sprite layers using **`sharp@^0.25.2`** (native Node C++ bindings), making it unusable in browser and Capacitor client bundles.
- **`pixel-avatars@0.0.3` ([npm](https://www.npmjs.com/package/pixel-avatars) | [GitHub](https://github.com/meitrix8208/pixel-avatars)):**
  - Depends on native **`sharp@0.33.5`** and `citty@0.1.6` as a Node CLI tool; cannot run in the browser.
- **`pixel-avatar-lib@1.0.0` ([npm](https://www.npmjs.com/package/pixel-avatar-lib) | [GitHub](https://github.com/snjyor/pixel_avator)):**
  - Apache-2.0, zero runtime dependencies, renders a pixel character onto an HTML5 `<canvas>` from a 6-part numeric DNA string (`"0-1-2-3-4-5"`). Single `1.0.0` release with minimal maintenance and no native SVG output.
- **`minidenticons@4.2.1` ([npm](https://www.npmjs.com/package/minidenticons) | [GitHub](https://github.com/laurentpayot/minidenticons)):**
  - MIT, zero dependencies, **1.2 KB raw / 0.8 KB gzip**. Pure deterministic SVG generator, but outputs a 5x5 symmetric geometric block grid rather than a character head.
- **`boring-avatars@2.0.4` ([npm](https://www.npmjs.com/package/boring-avatars) | [GitHub](https://github.com/boringdesigners/boring-avatars)):**
  - MIT, React 18 compatible, **11.3 KB raw / 3.1 KB gzip**. Its `pixel` variant is an abstract grid of colored squares rather than a character portrait.

---

## 3. Curated CC0 Asset Packs & In-Repo 16x16 SVG Builder

### 3.1 Kenney.nl (CC0 1.0 Universal)
All Kenney assets are dedicated to the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/):
- **Roguelike Characters (`16x16` modular sprite sheet):** <https://kenney.nl/assets/roguelike-characters>
- **1-Bit Pack (`16x16` monochrome pixel sprites):** <https://kenney.nl/assets/1-bit-pack>
- **Monochrome RPG (`16x16` single-channel sprites):** <https://kenney.nl/assets/monochrome-rpg>
- **Micro Roguelike (`8x8` sprites):** <https://kenney.nl/assets/micro-roguelike>

While CC0 and lightweight (~5-25 KB PNG), these packs are full-body RPG tiles rather than close-up operator head portraits, and recoloring PNG layers dynamically requires `<canvas>` manipulation rather than CSS variables.

### 3.2 OpenGameArt (CC0 1.0 Universal)
- **32x32 Portraits:** <https://opengameart.org/content/32-x-32-portraits>
- **CC0 Portraits:** <https://opengameart.org/content/cc0-portraits>
- **32x32 Fantasy Portrait Set:** <https://opengameart.org/content/32x32-fantasy-portrait-set>

These provide true 32x32 bust portraits under CC0, but depict medieval/fantasy archetypes (knights, elves, wizards) that clash with `idle-smoke-break`'s industrial shift-break setting.

### 3.3 In-Repo 16x16 SVG Pixel-Art Operator Head Component (`OperatorAvatar.tsx`)
Because `@dicebear/pixel-art` is released under **CC0 1.0 Universal** ([source JSON](https://github.com/dicebear/styles/blob/main/src/pixel-art.json)), we can build a self-contained ~220-line React component (`src/smokebreak/OperatorAvatar.tsx`) that renders a `<svg viewBox="0 0 16 16" shapeRendering="crispEdges">` directly in JSX:

1. **Zero npm dependencies & ~2 KB gzipped:** Keeps `package.json` and `knip` clean with no JSON schema validator overhead.
2. **Native React JSX `<svg>`:** No `dangerouslySetInnerHTML` and no `data:` URI needed; scales crisply with `shapeRendering="crispEdges"` from `24x24` (`UserCircleTrigger`) to `36x36` (scoreboard rows) and `64x64` (podium & profile card).
3. **Deterministic from `callsign` (or customizable in Profile Settings):** Uses a 10-line FNV-1a hash of `callsign` to pick a consistent 8-bit operator face for every player on the leaderboard.
4. **On-Theme Industrial & Smoke-Break Traits:**
   - **Headgear / Hair:** Hard hat (amber/lime), dockworker knit beanie, backwards cap, buzzcut, messy shift hair, mohawk, welder visor.
   - **Eyewear / Eyes:** Dark pixel shades (`dark01`-`07`), amber safety glasses, tired shift eyes, squint, radioactive-lime visor.
   - **Facial Hair:** Clean, 5-o'clock shadow stubble, heavy beard, mustache.
   - **Mouth & Smoke Prop:** Lit cigarette (white paper pixels + glowing ember pixel + rising smoke pixel wisp), smirk, grimace, cigar.
   - **Collar:** High-vis safety vest (`--as-accent-primary`), coveralls, hoodie, bomber jacket.

---

## Recommendation

1. **Best Overall Fit — Build an in-repo `OperatorAvatar.tsx` (16x16 crisp SVG component using CC0 `pixel-art` head/hair/shades geometry + custom cigarette/hard-hat/beanie layers):**
   - **0 dependencies**, **~2 KB gzipped**, **CC0 1.0 / first-party**, native React `<svg>`, and gives every operator on the Podium, Challenger List, Smoke Session Roster, and Profile Menu an unmistakable 8-bit shift-break character head.
2. **Best Off-the-Shelf Package — `@dicebear/core@9.4.3` + `@dicebear/pixel-art@9.4.3`:**
   - If you prefer installing an npm package rather than maintaining an SVG trait table in-repo, pin `@dicebear/core@^9.4.3` and `@dicebear/pixel-art@^9.4.3` (**9.2 KB gzipped**, **MIT + CC0 1.0**) and wrap it in a small `<OperatorAvatar seed={callsign} />` component.

