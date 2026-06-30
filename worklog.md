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
