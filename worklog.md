# Worklog — Dune RTS Game

## Task 4-renderer: Rewrite multi-tile building renderer
**Agent:** general-purpose sub-agent
**File modified:** `src/lib/tile-renderer.ts` (only the building rendering section)

### Summary
Rewrote `renderBuilding` to support multi-tile building footprints (2x2, 3x2, 1x1) with much richer, Dune-aesthetic artwork. Updated `drawBuilding` and `getBuildingPreview` to thread the `w,h` footprint through to the renderer. Cache is now keyed by `type+faction+w+h`.

### Signature changes
- `renderBuilding(type, faction)` → `renderBuilding(type, faction, w, h)` (internal, required)
- `drawBuilding(ctx, type, faction, px_, py_)` → `drawBuilding(ctx, type, faction, px_, py_, w = 1, h = 1)` (defaults preserve backward compatibility with existing callers in `src/app/page.tsx` that don't yet pass footprints)
- `getBuildingPreview(type, faction, size = 40)` → `getBuildingPreview(type, faction, size = 40, w = 1, h = 1)` (preview canvas remains square; building image is scaled by `size / (max(w,h) * TILE_SIZE)` so multi-tile buildings fit)
- Cache key: `${type}_${faction}` → `${type}_${faction}_${w}x${h}`

### Building artwork details (all use `px`, `rrect`, `FACTION_COLORS`, `mulberry` RNG; linear/radial gradients throughout)
- **palace (2x2 / 80x80):** Thick gradient back wall with crenellated battlements, 4 corner towers (front pair taller, back pair recessed) each with conical roof + shadow side + finial + 2 rows of glowing windows, tall central keep with pyramidal roof + ridge highlight + 4 stained-glass windows + faction roundel emblem, large arched double gate with seam/bands/rivets, big central flag with stripe + finial, wall torch glows.
- **barracks (2x2 / 80x80):** Gradient wall + large triangular pediment roof (lit/shadow split, ridge, eave trim, skylight slit), military faction stripe with chevrons, tall antenna with crossbars + red beacon + flag, central double door with seam/handles, 4 glowing side windows, 2-row sandbag emplacements at corners, supply crates, roof vent pipes.
- **factory (3x2 / 120x80):** Wide gradient structure, 6-peak sawtooth roof with glass faces + glazing bars + shadow sides + ridge rail, 2 industrial chimneys with bands/lips + 4-puff rising smoke, big roll-up garage door with 5 panels + hazard stripes, glowing control-room window, routed pipes with flanges + 2 valve wheels, multi-pane side windows, hazard line on ground.
- **turret (1x1 / 40x40):** Refined existing design — octagonal base pad with rivets, hemisphere dome with linear gradient + highlight + rivet ring, cannon mantlet + barrel + muzzle brake, faction emblem.
- **refinery (2x2 / 80x80):** Lower processing structure with stripe, large central dome tank (cylinder base with rivets + hemisphere top with radial gradient + horizontal band lines + vertical seams + top valve/outlet with faction indicator light), routed side pipes with elbows + highlights, 2 large spoked valve wheels, glowing side windows, central door, spice stain spill with crystal specks.
- **generator (2x2 / 80x80):** Housing with gradient, vertical radiator cooling fins on both sides (8 slit lines each, top vent glow), horizontal top vent assembly with slats, large glowing radial-gradient power core with containment ring + 8 bolt mounts + bright plasma inner, 4 lightning arcs (top/left/right/bottom) with rounded line caps, energy pylon with ceramic insulators + tip glow, 5 power conduit LEDs along bottom, 2 status display panels.

### Backward compatibility
- `drawBuilding` and `getBuildingPreview` accept `w,h` with defaults of `1,1`. Existing callers in `src/app/page.tsx` (which still call without `w,h`) continue to work without modification, though buildings will render at 1x1 until page.tsx is updated to pass `b.w, b.h` from the Building footprint (game-engine.ts already exposes `Building.w` / `Building.h`).
- The `buildingCache` Map uses the new key format; old `${type}_${faction}` entries are simply never matched (and the Map is in-memory only).

### Verification
- `cd /home/z/my-project && bun run lint` → clean (no eslint output).
- `bunx tsc --noEmit` shows 2 errors at `tile-renderer.ts:1442` and `:1490` (in `renderUnit` harvester/tank sections: `rrect(ctx, 6, s-20, 26, 2, col.primary)` missing the `r` argument). These errors are **pre-existing** — verified by `git stash` + re-run; they existed at original lines 751 and 799 before this task. They are outside the building rendering section and were left untouched per "DO NOT change any other functions."

### Next actions for integration agent
- Update `src/app/page.tsx` calls to pass footprints:
  - `drawBuilding(ctx, b.type, b.owner, b.x*TILE_SIZE, b.y*TILE_SIZE, b.w, b.h)`
  - `getBuildingPreview(selBld.type, 'atreides', 48, selBld.w, selBld.h)`
  - `getBuildingPreview(t, 'atreides', 40, <footprintW>, <footprintH>)` for the build menu (look up footprint from a BUILDING_FOOTPRINTS map or from CONFIG)
- Update build-mode hover preview rectangle to use `b.w * TILE_SIZE, b.h * TILE_SIZE` instead of single `TILE_SIZE`.
- Optionally fix the 2 pre-existing `rrect` argument errors in `renderUnit` (harvester line ~1442, tank line ~1490).

## Task 8-futuristic: Rewrite renderBuilding for sci-fi/futuristic aesthetic
**Agent:** general-purpose sub-agent
**File modified:** `src/lib/tile-renderer.ts` (only the `renderBuilding` body — the if/else if chain inside the function, ~lines 579-1652)

### Summary
Completely rewrote the drawing code inside `renderBuilding` so ALL 6 buildings look futuristic/sci-fi (Dune 1984/2021 movie aesthetic) instead of rustic wooden huts or fairy-tale castles. Function signature, cache, shadow setup, and all other functions left untouched. Only the `if (type === 'palace') {...} else if ...` chain was replaced.

### Design philosophy
- **Primary palette = metallic grays** (`#1a1a1a` → `#9a9a9a`), NOT faction colors or wood tones
- **Faction colors used only as subtle accents** (1-2px stripes, banner, door indicator dots)
- **Glowing elements:** cyan `#00d0ff` for energy/tech, orange `#ff8030`/`#ffa050` for spice, amber `#ffaa30` for warning lights
- **Angular/geometric shapes** throughout — hexagonal pads, beveled corners, flat roofs, sawtooth glass — NO pitched/conical/pyramidal roofs
- **Visible tech details:** metal panel seams, floor bands, vents, pipes, antennas, comm dishes, blast doors, hazard stripes, cooling fins, plasma core, lightning arcs, valve wheels, rivets, LEDs
- **Gradients everywhere:** 24 linear gradients (metallic surfaces) + 15 radial gradients (glowing elements)

### Building details
- **palace (2x2 / 80x80):** Massive brutalist command fortress. Wide stepped concrete base with beveled corners + horizontal seam lines. Central tall angular command tower with metallic horizontal gradient, 4 vertical panel seams, 3 horizontal floor bands, 3 rows of glowing cyan slit windows (left+right). Flat roof pad with corner comm equipment pads. Tall central comm antenna with cyan glowing tip (radial gradient halo) + 2 side comm dishes. 4 energy shield emitter nodes (cyan radial glow) at base corners. Vertical hanging faction banner. Rectangular blast door with hazard stripes + faction indicator lights. Side louvered vents. 3 rooftop solar array panels (dark blue). Ground-level amber exhaust lights.
- **barracks (2x2 / 80x80):** Angular prefab military structure. Flat roof with beveled edges + rooftop equipment housing with amber vent slits. Antenna array: tall main mast with red beacon (radial glow), shorter secondary with cyan tip, central comm dish. External coolant pipes (horizontal routes with flanges + cyan vent glow at ends). 4 vertical slit windows (cyan, 2 rows x 2 side columns) with frames. Central blast door with vertical seam, horizontal panel lines, hazard stripes, faction control panel. Side reinforcement pillars (buttresses) with rivets. Subtle faction stripe. Ground hazard line.
- **factory (3x2 / 120x80):** Wide industrial facility. Flat sawtooth roof (6 angular glass panels with cyan-tint gradient + glazing bars + shadow faces + cyan glow strips at peaks — NOT pitched). 2 metallic chimneys with horizontal gradient, flared lips, reinforcement bands, and amber/orange heat vent glow (radial gradient) at tops + hot interior orange ring. Large cargo bay roll-up door (6 horizontal panel segments, 2 vertical seams, yellow-black hazard stripes, faction warning label). Glowing cyan control room window above door (with dividers). External pipes + smaller conduit + flanges + 2 spoked valve wheels. Side multi-pane cyan windows. Ground hazard zone.
- **turret (1x1 / 40x40):** Compact energy cannon. Angular hexagonal base pad (reinforced, with rivets). Rotating angular box base (NOT dome) with panel seams. Raised cannon mantlet. Sleek energy cannon barrel with muzzle ring. Glowing cyan power cell (radial gradient) at barrel base. Muzzle glow (charging tip, radial gradient). Faction emblem on side. 2 amber status lights.
- **refinery (2x2 / 80x80):** Spice processing plant. Lower industrial structure base. Large central cylindrical processing tank with metallic horizontal gradient, reinforced top rim, 2 reinforcement band rings with rivets. 2 spice glow viewports (translucent orange gradient with dividers). Spice glow halo around tank top. Tank top valve/outlet assembly + rising outlet pipe + orange spice fume vent glow. 2 side crystallization vats (smaller cylinders with spice glow viewports + top rims). Connecting pipes (tank→vats) with flanges. 2 large spoked valve wheels with spice-orange center glow. Spice glow windows on lower structure. Central access door with hazard stripes. Spice stain spill + glowing crystal specks on ground.
- **generator (2x2 / 80x80):** Power plant with vertical plasma core. Reactor housing. 2 vertical cooling fin stacks (10 slit lines each, top cap with cyan vent glow). Top horizontal vent assembly with slats. Central vertical plasma core: outer cyan halo (radial gradient), containment ring (mechanical housing with 8 bolt mounts), bright cyan plasma (white center → cyan → deep cyan radial gradient), cyan containment grid bars. 4 cyan lightning arcs (jagged bolts in 4 directions). Energy pylon/antenna with ceramic insulators + cyan tip glow. 5 cyan conduit LEDs along bottom (radial glow each). 2 status display panels (cyan + amber). Faction accent stripe.

### Removal of old rustic elements (verified absent)
All of the following were completely eliminated from `renderBuilding`:
- Conical/pyramidal roofs, crenellations/battlements, arched doors, stained-glass windows, finials, pediments
- Sandbags, supply crates, wall torches, flags on poles
- Wooden colors (`#3a2a1a`, `#2a1a0a`, `#5a4a3a`, `#8a7040`, `#6a4a2a`, `#1a1208`)
- Old warm yellow lights (`#ffd060`, `#fff8c0`)
- Wooden flagpoles, castle roundels, conical tower roofs

### Technical notes
- Used `px` and `rrect` helpers throughout; `mulberry` RNG for spice crystal specks
- All gradient arguments passed to `rrect` use `as any` cast (matching original code convention to bypass the `string`-only type signature of the helper)
- `FACTION_COLORS` used only for subtle accents (1-2px stripes, banner, indicator dots, emblem) — metallic grays are the dominant palette
- Cache key format `${type}_${faction}_${w}x${h}` unchanged

### Verification
- `cd /home/z/my-project && bun run lint` → **clean** (no eslint output)
- `bunx tsc --noEmit` → 2 errors at `tile-renderer.ts:1688` and `:1736`, both in `renderUnit` (harvester/tank body: `rrect(ctx, 6, s-20, 26, 2, col.primary)` missing `r` argument). These are **pre-existing** — confirmed they are the same 2 errors documented in the Task 4-renderer worklog (originally at lines 1442/1490, now shifted by +246 lines due to the larger renderBuilding body). They are OUTSIDE `renderBuilding` and were left untouched per "DO NOT change any other functions."
- Structure verified: all 6 building branches present (palace/barracks/factory/turret/refinery/generator), function ends properly with `buildingCache.set(key, c); return c; }`
- Sci-fi palette verified: 27× cyan `#00d0ff`, 5× spice orange `#ff8030`, 7× amber `#ffaa30`, 91× dark metal `#1a1a1a`, 44× mid metal `#5a5a5a`, 24 linear gradients, 15 radial gradients

### Next actions for integration agent
- The 2 pre-existing `rrect` argument errors in `renderUnit` (harvester ~line 1688, tank ~line 1736) could optionally be fixed by adding the missing `r` parameter (e.g., `rrect(ctx, 6, s-20, 26, 2, 1, col.primary)`)
- Visual review in-browser recommended to confirm the futuristic aesthetic renders correctly at all footprint sizes
- If the build menu / `getBuildingPreview` scaling needs adjustment for the new taller structures (e.g., palace antenna extends to y=H*0.05), verify preview thumbnails still look good

## Task dimetric-1: Semi-dimetric buildings + 8-directional unit sprites
**Agent:** general-purpose sub-agent
**File modified:** `src/lib/tile-renderer.ts` (only — `renderBuilding`, `drawBuilding`, `getBuildingPreview`, `renderUnitDirection` (new), `drawUnit`, plus a new `unitDirCache`)

### Summary
Implemented two changes requested in task dimetric-1:
1. **Semi-dimetric buildings** — buildings now render with a visible vertical facade/wall rising upward from the flat top-down footprint, giving a ~30° viewing-angle look (C&C/StarCraft 2.5D style). Canvas height = footprint height + W/2.
2. **8-directional unit sprites for vehicles** — harvester and tank are now pre-rendered into 8 cached rotated sprites (one per 45° direction) instead of being rotated at draw-time. Soldiers remain non-rotating.

### CHANGE 1 — Semi-dimetric buildings

#### `renderBuilding(type, faction, w, h)`
- **Canvas size**: was `W × H`; now `W × (H + facadeHeight)` where `facadeHeight = W / 2` (2:1 height ratio per task spec).
  - 2×2 palace/barracks/refinery/generator: 80×120 (was 80×80)
  - 3×2 factory: 120×140 (was 120×80)
  - 1×1 turret: 40×60 (was 40×40)
- **Layout in canvas**:
  - `y = 0 .. facadeHeight`: NEW vertical facade wall (the front face of the building, rising upward from the base — sits ABOVE the footprint in canvas space, which is "upward" visually after the `-facadeHeight` offset in `drawBuilding`).
  - `y = facadeHeight .. facadeHeight + H`: existing top-down footprint artwork, wrapped in `ctx.save(); ctx.translate(0, facadeHeight); …existing per-building code… ctx.restore();`. All existing futuristic artwork (palace antenna, barracks slit windows, factory sawtooth roof, turret cannon, refinery tank, generator plasma core) is preserved unchanged — only its canvas y-origin is shifted down by `facadeHeight`.
- **Facade drawing** (new, generic for all 6 building types — futuristic aesthetic matching the existing palette):
  - Outer dark frame (`#0a0a0a`) + main wall gradient (`#3a3a3a` top → `#7a7a7a` bottom) suggesting perspective (top is further away / darker, bottom is closer / lighter).
  - Side-wall shading: left & right edges get a `rgba(0,0,0,0.55) → transparent` gradient overlay — "darker shades for side walls, lighter for front face" per spec.
  - Top edge highlight (`#8a8a8a` + `#6a6a6a`) — sun-baked parapet rim.
  - 2 horizontal panel seams (reinforced concrete bands) + N vertical panel seams (`numVSeams = max(3, floor(W/20))`).
  - 2 rows × N cols of glowing cyan slit windows (`#0080a0` frame + `#00d0ff` glow + `#80e8ff` highlight + `#1a1a1a` frame top/bottom). `winCols = max(2, floor(W/24))` so wider buildings get more windows.
  - Faction accent stripe (`col.primary` + `col.trim`) at the bottom of the facade, just above the footprint — visually ties the facade to the building's faction.
- All existing per-building futuristic details (glowing windows, pipes, antennas, energy cores) are preserved on the footprint portion; the facade adds a complementary layer of futuristic detail (windows, panel seams, faction stripe) on the vertical wall.

#### `drawBuilding(ctx, type, faction, px_, py_, w, h)`
- Now offsets the building image upward by `facadeH = (w * TILE_SIZE) / 2` so the FOOTPRINT portion of the image sits at the building's tile position (`py_`) and the facade rises upward above the tile:
  ```ts
  const img = renderBuilding(type, faction, w, h)
  const facadeH = (w * TILE_SIZE) / 2
  ctx.drawImage(img, px_, py_ - facadeH)
  ```

#### `getBuildingPreview(type, faction, size, w, h)`
- Scale formula updated to fit the now-taller image inside the square preview canvas:
  - Old: `size / (Math.max(w, h) * TILE_SIZE)` — clipped the new taller images.
  - New: `size / Math.max(imgW, imgH)` where `imgW = w*TILE_SIZE` and `imgH = (h + w/2)*TILE_SIZE`.
- Preview image is now also horizontally centered: `ctx.drawImage(img, (size/scale - imgW)/2, 0)` so taller-than-wide buildings (all of them now, since facadeHeight > 0) don't hug the left edge of the preview thumbnail.

### CHANGE 2 — 8-directional unit sprites for vehicles

#### New `unitDirCache = new Map<string, HTMLCanvasElement>()`
- Added next to `unitCache`. Keyed by `${type}_${faction}_${dir}` (dir 0–7).

#### New `renderUnitDirection(type, faction, dir)` function
- Returns a cached `TILE_SIZE × TILE_SIZE` canvas containing the base vehicle sprite (from `renderUnit`) rotated `dir * 45°` around the tile center.
- `imageSmoothingEnabled = true` for clean rotated edges.
- dir convention (clockwise in canvas coords because +Y is down — matches the `drawUnit` comment in the task spec):
  - 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE
- Caches all 8 directions lazily on first use; subsequent calls hit the cache.

#### Updated `drawUnit(ctx, type, faction, px_, py_, bob, facing)`
- `soldier`: unchanged behavior — calls `renderUnit` directly and draws with bob (soldiers always face the player).
- `harvester` / `tank`: no longer rotates via `ctx.save/translate/rotate/restore` at draw-time. Instead:
  1. Normalizes `facing` to `[0, 2π)`.
  2. Snaps to nearest 45° step: `dir = Math.round(angle / (π/4)) % 8`.
  3. Calls `renderUnitDirection(type, faction, dir)` to get the pre-rendered rotated sprite.
  4. Draws the sprite at `(px_ - TILE_SIZE/2, py_ - TILE_SIZE/2 + bob)`.
- This means each vehicle now has 8 visually distinct direction sprites cached in memory (2 types × 4 factions × 8 dirs = up to 64 cached canvases total, each 40×40 — negligible memory). Draw-time rotation is eliminated.

### Verification
- `cd /home/z/my-project && bun run lint` → **clean** (no eslint output).
- `bunx tsc --noEmit` → 2 errors at `tile-renderer.ts:1772` and `:1820`. These are the **pre-existing** `rrect` argument errors in `renderUnit` (harvester body line ~1772, tank body line ~1820 — shifted from the previous 1688/1736 by +84 due to the new facade code). They are OUTSIDE the building rendering section and OUTSIDE the new `renderUnitDirection`/`drawUnit` changes; they exist in the unchanged harvester/tank body code inside `renderUnit` and were documented in the prior two worklog entries (Task 4-renderer and Task 8-futuristic). Next.js is configured with `typescript.ignoreBuildErrors: true` so these do not block the build.
- No new TS or lint errors introduced by this task.
- Verified structurally:
  - `renderBuilding` opens `ctx.save(); ctx.translate(0, facadeHeight)` after the facade block, and closes with `ctx.restore()` immediately before `buildingCache.set(key, c); return c` — so all per-building branches (palace/barracks/factory/turret/refinery/generator) execute inside the translated scope and render at the bottom of the taller canvas.
  - `drawBuilding` uses `py_ - facadeH` offset exactly as specified in the task.
  - `renderUnitDirection` rotates the base sprite by `dir * π/4` and caches it; `drawUnit` snaps facing to the nearest of 8 directions for vehicles.

### Next actions for integration agent
- **Visual review in-browser** is recommended: confirm the facade looks good above each building type, that the `-facadeHeight` offset doesn't cause buildings to overlap the tile above them inappropriately (especially tall palace/barracks/refinery/generator which are 120px tall on 40px tiles — they'll extend 80px above their tile, i.e. 2 tiles up). The integration agent may want to adjust building render order to back-to-front (top-of-map first) so facades don't overlap buildings above them, OR accept the overlap as a stylistic choice (C&C-style).
- The 2 pre-existing `rrect` argument errors in `renderUnit` (now at lines ~1772 and ~1820) could optionally be fixed by adding the missing `r` parameter (e.g. `rrect(ctx, 6, s-20, 26, 2, 1, col.primary)`). Not required for this task.
- If the build menu / selected-building preview (`getBuildingPreview` at 48px) looks too small for the now-taller images, the integration agent can increase the preview `size` argument or adjust the build menu card layout.
