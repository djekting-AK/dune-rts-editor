#!/usr/bin/env python3
"""Splice the new renderBuilding / drawBuilding / getBuildingPreview
into tile-renderer.ts, replacing the old versions."""

import re
import sys
from pathlib import Path

SRC = Path("/home/z/my-project/src/lib/tile-renderer.ts")
NEW_RENDER = Path("/home/z/my-project/.worktmp/new_render.ts").read_text()

text = SRC.read_text()

# --- 1. Replace renderBuilding function (lines 556-1735 in the original) ---
# Match from `function renderBuilding(` up to the matching `}` that ends it.
# The function ends just before `\nexport function drawBuilding(`.
old_render_pattern = re.compile(
    r"function renderBuilding\(type: BuildingType, faction: Faction, w: number, h: number\): HTMLCanvasElement \{.*?\n\}(?=\n\nexport function drawBuilding\()",
    re.DOTALL,
)
m = old_render_pattern.search(text)
if not m:
    print("ERROR: could not find renderBuilding function", file=sys.stderr)
    sys.exit(1)
print(f"renderBuilding: replacing chars {m.start()}..{m.end()} (length {m.end() - m.start()})")
text = text[:m.start()] + NEW_RENDER.rstrip() + text[m.end():]

# --- 2. Replace drawBuilding function ---
new_draw = """export function drawBuilding(ctx: CanvasRenderingContext2D, type: BuildingType, faction: Faction, px_: number, py_: number, w = 1, h = 1) {
  const img = renderBuilding(type, faction, w, h)
  // Position the image so the diamond base CENTER sits at the center of the
  // building's rectangular tile footprint on screen.
  const wallH = getWallH(type)
  const dh = (w + h) * DIM_H / 4   // half-diamond height
  const CH = (w + h) * DIM_H / 2 + wallH + DIM_H + TOP_PAD
  const cxImg = img.width / 2
  const cyImg = CH - dh             // diamond base center y in image coords
  const drawX = px_ + (w * TILE_SIZE) / 2 - cxImg
  const drawY = py_ + (h * TILE_SIZE) / 2 - cyImg
  ctx.drawImage(img, drawX, drawY)
}"""

old_draw_pattern = re.compile(
    r"export function drawBuilding\(ctx: CanvasRenderingContext2D, type: BuildingType, faction: Faction, px_: number, py_: number, w = 1, h = 1\) \{.*?\n\}",
    re.DOTALL,
)
m = old_draw_pattern.search(text)
if not m:
    print("ERROR: could not find drawBuilding function", file=sys.stderr)
    sys.exit(1)
print(f"drawBuilding: replacing chars {m.start()}..{m.end()}")
text = text[:m.start()] + new_draw + text[m.end():]

# --- 3. Replace getBuildingPreview function ---
new_preview = """export function getBuildingPreview(type: BuildingType, faction: Faction, size = 40, w = 1, h = 1): string {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const ctx = c.getContext('2d')!
  const img = renderBuilding(type, faction, w, h)
  // Dimetric images are roughly square-ish; scale to fit the larger dimension
  // and center the image inside the preview square.
  const scale = size / Math.max(img.width, img.height)
  ctx.scale(scale, scale)
  const drawX = (size / scale - img.width) / 2
  const drawY = (size / scale - img.height) / 2
  ctx.drawImage(img, drawX, drawY)
  return c.toDataURL()
}"""

old_preview_pattern = re.compile(
    r"export function getBuildingPreview\(type: BuildingType, faction: Faction, size = 40, w = 1, h = 1\): string \{.*?\n\}",
    re.DOTALL,
)
m = old_preview_pattern.search(text)
if not m:
    print("ERROR: could not find getBuildingPreview function", file=sys.stderr)
    sys.exit(1)
print(f"getBuildingPreview: replacing chars {m.start()}..{m.end()}")
text = text[:m.start()] + new_preview + text[m.end():]

SRC.write_text(text)
print("OK: all 3 functions replaced")
print(f"new file size: {len(text)} chars")
