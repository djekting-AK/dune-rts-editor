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
