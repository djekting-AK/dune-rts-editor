// ---------- Dimetric (2:1) building rendering ----------
// Each building is drawn as a true 3D dimetric box:
//   ground shadow + diamond base + 2 walls rising upward + roof diamond on top,
// with unique details per building type (windows, doors, pipes, antennas, tanks).
// 2:1 ratio: DIM_W=40, DIM_H=20 → diamond width = (w+h)*20, height = (w+h)*10.

const DIM_W = 40
const DIM_H = 20
const TOP_PAD = 18  // top padding for tall roof features (antennas, chimneys, etc.)

// Wall height (in pixels) per building type — taller = more imposing.
function getWallH(type: BuildingType): number {
  switch (type) {
    case 'palace':    return 50
    case 'barracks':  return 35
    case 'factory':   return 45
    case 'refinery':  return 40
    case 'generator': return 42
    case 'turret':    return 20
  }
}

// Shared geometry computation for a dimetric building canvas.
function buildingGeometry(w: number, h: number, wallH: number) {
  const dw = (w + h) * DIM_W / 4   // half-diamond width
  const dh = (w + h) * DIM_H / 4   // half-diamond height
  const CW = (w + h) * DIM_W / 2 + DIM_W            // canvas width
  const CH = (w + h) * DIM_H / 2 + wallH + DIM_H + TOP_PAD  // canvas height
  const cx = CW / 2
  const cy = CH - dh               // diamond base center (bottom near canvas edge)
  const roofCx = cx
  const roofCy = cy - wallH        // roof diamond center
  return { dw, dh, CW, CH, cx, cy, roofCx, roofCy, wallH }
}

// Trace a dimetric diamond path. (cx, cy) = center; dw, dh = half-width / half-height.
function diamondPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, dw: number, dh: number) {
  ctx.beginPath()
  ctx.moveTo(cx, cy - dh)       // top
  ctx.lineTo(cx + dw, cy)       // right
  ctx.lineTo(cx, cy + dh)       // bottom
  ctx.lineTo(cx - dw, cy)       // left
  ctx.closePath()
}

// Trace a wall face (parallelogram rising UP from a front edge of the diamond).
// edge = 'right' (front-right edge) or 'left' (front-left edge).
function wallFacePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, dw: number, dh: number, wallH: number, edge: 'right' | 'left') {
  ctx.beginPath()
  if (edge === 'right') {
    ctx.moveTo(cx, cy + dh)            // bottom of diamond
    ctx.lineTo(cx + dw, cy)            // right of diamond
    ctx.lineTo(cx + dw, cy - wallH)    // right-up (top-right of wall)
    ctx.lineTo(cx, cy + dh - wallH)    // bottom-up (top-left of wall)
  } else {
    ctx.moveTo(cx, cy + dh)            // bottom of diamond
    ctx.lineTo(cx - dw, cy)            // left of diamond
    ctx.lineTo(cx - dw, cy - wallH)    // left-up
    ctx.lineTo(cx, cy + dh - wallH)    // bottom-up
  }
  ctx.closePath()
}

// Trace a quad on a wall face at normalized coords.
// u in [0,1] along the bottom diamond edge (0 = bottom corner, 1 = side corner).
// v in [0,1] up the wall (0 = ground, 1 = top of wall). v > 1 extends above the wall top.
function wallQuadPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, dw: number, dh: number, wallH: number, edge: 'right' | 'left', u1: number, v1: number, u2: number, v2: number) {
  const s = edge === 'right' ? 1 : -1
  const X = (u: number) => cx + s * u * dw
  const Y = (u: number, v: number) => cy + dh - u * dh - v * wallH
  ctx.beginPath()
  ctx.moveTo(X(u1), Y(u1, v1))
  ctx.lineTo(X(u2), Y(u2, v1))
  ctx.lineTo(X(u2), Y(u2, v2))
  ctx.lineTo(X(u1), Y(u1, v2))
  ctx.closePath()
}

// Fill a wall quad with a solid color.
function wallQuadFill(ctx: CanvasRenderingContext2D, cx: number, cy: number, dw: number, dh: number, wallH: number, edge: 'right' | 'left', u1: number, v1: number, u2: number, v2: number, color: string) {
  wallQuadPath(ctx, cx, cy, dw, dh, wallH, edge, u1, v1, u2, v2)
  ctx.fillStyle = color
  ctx.fill()
}

function renderBuilding(type: BuildingType, faction: Faction, w: number, h: number): HTMLCanvasElement {
  const key = `${type}_${faction}_${w}x${h}`
  let c = buildingCache.get(key)
  if (c) return c
  c = document.createElement('canvas')

  const wallH = getWallH(type)
  const geo = buildingGeometry(w, h, wallH)
  const { dw, dh, CW, CH, cx, cy, roofCx, roofCy } = geo

  c.width = CW; c.height = CH
  const ctx = c.getContext('2d')!
  const col = FACTION_COLORS[faction]
  const rng = mulberry((type.charCodeAt(0) * 7919) ^ (faction.charCodeAt(0) * 4099) ^ (w * 131) ^ (h * 257))

  // ============================================================
  //  1. GROUND SHADOW (slightly offset, darker diamond beneath)
  // ============================================================
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  diamondPath(ctx, cx + 4, cy + 3, dw + 3, dh + 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  diamondPath(ctx, cx + 7, cy + 5, dw + 1, dh + 1)
  ctx.fill()

  // ============================================================
  //  2. RIGHT WALL (darker shade — in shadow from the light source)
  // ============================================================
  wallFacePath(ctx, cx, cy, dw, dh, wallH, 'right')
  const rightGrad = ctx.createLinearGradient(0, cy - wallH, 0, cy + dh)
  rightGrad.addColorStop(0, '#3a3a3a')
  rightGrad.addColorStop(1, '#1f1f1f')
  ctx.fillStyle = rightGrad
  ctx.fill()

  // ============================================================
  //  3. LEFT WALL (medium shade — catches more light)
  // ============================================================
  wallFacePath(ctx, cx, cy, dw, dh, wallH, 'left')
  const leftGrad = ctx.createLinearGradient(0, cy - wallH, 0, cy + dh)
  leftGrad.addColorStop(0, '#7a7a7a')
  leftGrad.addColorStop(1, '#3a3a3a')
  ctx.fillStyle = leftGrad
  ctx.fill()

  // ============================================================
  //  4. ROOF DIAMOND (top face — lightest shade)
  // ============================================================
  diamondPath(ctx, roofCx, roofCy, dw, dh)
  const roofGrad = ctx.createLinearGradient(0, roofCy - dh, 0, roofCy + dh)
  roofGrad.addColorStop(0, '#9a9a9a')
  roofGrad.addColorStop(1, '#5a5a5a')
  ctx.fillStyle = roofGrad
  ctx.fill()
  // Sun-lit back-top edges of roof (subtle highlight)
  ctx.strokeStyle = '#a8a8a8'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(roofCx - dw, roofCy)
  ctx.lineTo(roofCx, roofCy - dh)
  ctx.lineTo(roofCx + dw, roofCy)
  ctx.stroke()

  // ============================================================
  //  5. BUILDING-SPECIFIC DETAILS (each type looks different)
  // ============================================================
  if (type === 'palace') {
    // ===== PALACE: brutalist command fortress =====
    // Walls: crenellated parapet strip on top, slit windows, big blast door,
    //        reinforced panel seams, faction stripe.
    // Roof:  tall comm antenna at back, faction banner on pole at center,
    //        4 corner guard tower pads, glowing roof light strip.

    // --- Crenellated parapet strip (raised band at top of both walls) ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0, 0.88, 1, 1.04, '#2a2a2a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left',  0, 0.88, 1, 1.04, '#3a3a3a')
    // Merlon notches (dark gaps) along the parapet top
    for (let i = 0; i < 6; i++) {
      const u = 0.05 + i * 0.16
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', u, 1.0, u + 0.06, 1.05, '#0a0a0a')
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left',  u, 1.0, u + 0.06, 1.05, '#0a0a0a')
    }

    // --- Right wall: large central blast door + slit windows on sides ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.34, 0.04, 0.66, 0.62, '#0f0f0f')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.34, 0.04, 0.66, 0.07, '#3a3a3a')  // top trim
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.34, 0.60, 0.66, 0.62, '#3a3a3a')  // bottom trim
    // hazard stripes (yellow-black) across door
    for (let i = 0; i < 4; i++) {
      const su = 0.34 + i * 0.08
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', su, 0.30, su + 0.04, 0.36, i % 2 === 0 ? '#ffcc00' : '#1a1a1a')
    }
    // vertical seam on door
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.49, 0.07, 0.51, 0.60, '#1a1a1a')
    // faction indicator lights beside door
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.30, 0.30, 0.33, 0.34, col.primary)
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.67, 0.30, 0.70, 0.34, col.primary)
    // slit windows (cyan glow) flanking door, 2 rows
    for (const row of [0.20, 0.45]) {
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.08, row, 0.20, row + 0.05, '#00d0ff')
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.80, row, 0.92, row + 0.05, '#00d0ff')
    }

    // --- Left wall: 3 rows × 3 cols of slit windows + vertical seams ---
    for (let i = 1; i < 4; i++) {
      const u = i / 4
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', u - 0.005, 0.05, u + 0.005, 0.85, '#1a1a1a')
    }
    for (const row of [0.18, 0.40, 0.62]) {
      for (let i = 0; i < 3; i++) {
        const u = 0.10 + i * 0.27
        wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', u, row, u + 0.14, row + 0.05, '#00d0ff')
      }
    }
    // Faction accent stripe (vertical) on left wall
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.46, 0.05, 0.54, 0.85, col.dark)
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.48, 0.05, 0.52, 0.85, col.primary)

    // --- Horizontal floor band on both walls ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0, 0.78, 1, 0.80, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left',  0, 0.78, 1, 0.80, '#1a1a1a')

    // --- Roof details ---
    // 4 corner guard tower pads (small dark diamonds on roof corners)
    const corners: [number, number][] = [
      [roofCx - dw + 4, roofCy], [roofCx + dw - 4, roofCy],
      [roofCx, roofCy - dh + 3], [roofCx, roofCy + dh - 3],
    ]
    for (const [tx2, ty2] of corners) {
      diamondPath(ctx, tx2, ty2, 5, 2.5)
      ctx.fillStyle = '#2a2a2a'; ctx.fill()
      diamondPath(ctx, tx2, ty2, 3, 1.5)
      ctx.fillStyle = '#5a5a5a'; ctx.fill()
    }
    // Glowing roof light strip (cyan-tinted central diamond)
    diamondPath(ctx, roofCx, roofCy, dw * 0.55, dh * 0.55)
    ctx.fillStyle = 'rgba(0, 208, 255, 0.15)'; ctx.fill()
    ctx.strokeStyle = '#00d0ff'; ctx.lineWidth = 1; ctx.stroke()

    // Faction banner on a pole at roof center
    const poleH = 16
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(roofCx, roofCy); ctx.lineTo(roofCx, roofCy - poleH); ctx.stroke()
    ctx.fillStyle = col.primary
    ctx.beginPath()
    ctx.moveTo(roofCx, roofCy - poleH)
    ctx.lineTo(roofCx + 11, roofCy - poleH + 3)
    ctx.lineTo(roofCx, roofCy - poleH + 6)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = col.trim
    ctx.fillRect(roofCx, roofCy - poleH, 1, 6)
    ctx.fillStyle = '#ffaa30'
    ctx.beginPath(); ctx.arc(roofCx, roofCy - poleH - 1, 1.5, 0, Math.PI * 2); ctx.fill()

    // Tall comm antenna at back corner (top of roof diamond)
    const antX = roofCx
    const antY = roofCy - dh
    const antH = 16
    ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(antX, antY); ctx.lineTo(antX, antY - antH); ctx.stroke()
    ctx.lineWidth = 1
    for (let i = 0; i < 2; i++) {
      const yy = antY - 5 - i * 5
      ctx.beginPath(); ctx.moveTo(antX - 4, yy); ctx.lineTo(antX + 4, yy); ctx.stroke()
    }
    // glowing tip (cyan, radial gradient)
    const tipGrad = ctx.createRadialGradient(antX, antY - antH, 0, antX, antY - antH, 6)
    tipGrad.addColorStop(0, '#e0f8ff')
    tipGrad.addColorStop(0.4, '#00d0ff')
    tipGrad.addColorStop(1, 'rgba(0,208,255,0)')
    ctx.fillStyle = tipGrad
    ctx.fillRect(antX - 6, antY - antH - 6, 12, 12)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(antX, antY - antH, 1.5, 0, Math.PI * 2); ctx.fill()
  }
  else if (type === 'barracks') {
    // ===== BARRACKS: angular prefab military structure =====
    // Walls: blast door on right, slit windows on left, hazard stripes at bottom.
    // Roof:  antenna with red beacon, 2 vent pipes.

    // --- Right wall: large blast door + 2 slit windows above ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.28, 0.05, 0.72, 0.60, '#0f0f0f')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.28, 0.05, 0.72, 0.08, '#3a3a3a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.49, 0.08, 0.51, 0.60, '#1a1a1a')
    // hazard stripes at bottom of door
    for (let i = 0; i < 5; i++) {
      const su = 0.28 + i * 0.09
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', su, 0.54, su + 0.045, 0.60, i % 2 === 0 ? '#ffcc00' : '#1a1a1a')
    }
    // door handles
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.40, 0.32, 0.42, 0.36, '#5a5a5a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.58, 0.32, 0.60, 0.36, '#5a5a5a')
    // slit windows above door
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.34, 0.72, 0.46, 0.78, '#00d0ff')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.54, 0.72, 0.66, 0.78, '#00d0ff')

    // --- Left wall: 4 slit windows in 2x2 grid + vertical seams ---
    for (let i = 1; i < 3; i++) {
      const u = i / 3
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', u - 0.005, 0.05, u + 0.005, 0.85, '#1a1a1a')
    }
    for (const row of [0.25, 0.55]) {
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.10, row, 0.25, row + 0.06, '#00d0ff')
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.40, row, 0.55, row + 0.06, '#00d0ff')
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.70, row, 0.85, row + 0.06, '#00d0ff')
    }

    // --- Horizontal hazard stripe at bottom of both walls ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0, 0.86, 1, 0.92, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left',  0, 0.86, 1, 0.92, '#1a1a1a')
    for (let i = 0; i < 8; i++) {
      const u = i * 0.125
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', u, 0.86, u + 0.06, 0.92, '#ffcc00')
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left',  u, 0.86, u + 0.06, 0.92, '#ffcc00')
    }
    // Faction stripe on both walls
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0, 0.80, 1, 0.83, col.primary)
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left',  0, 0.80, 1, 0.83, col.primary)

    // --- Roof: tall antenna mast with red beacon + 2 vent pipes ---
    const antX = roofCx
    const antY = roofCy - dh
    const antH = 26
    ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(antX, antY); ctx.lineTo(antX, antY - antH); ctx.stroke()
    ctx.lineWidth = 1
    for (let i = 0; i < 2; i++) {
      const yy = antY - 7 - i * 7
      ctx.beginPath(); ctx.moveTo(antX - 4, yy); ctx.lineTo(antX + 4, yy); ctx.stroke()
    }
    // Red beacon (radial glow)
    const beaconGrad = ctx.createRadialGradient(antX, antY - antH, 0, antX, antY - antH, 5)
    beaconGrad.addColorStop(0, '#ffe0e0')
    beaconGrad.addColorStop(0.4, '#ff3030')
    beaconGrad.addColorStop(1, 'rgba(255,48,48,0)')
    ctx.fillStyle = beaconGrad
    ctx.fillRect(antX - 5, antY - antH - 5, 10, 10)
    ctx.fillStyle = '#ff5050'
    ctx.beginPath(); ctx.arc(antX, antY - antH, 1.5, 0, Math.PI * 2); ctx.fill()

    // 2 small vent pipes on roof
    for (const offX of [-12, 12]) {
      const px2 = roofCx + offX
      const py2 = roofCy - 2
      ctx.fillStyle = '#3a3a3a'
      ctx.fillRect(px2 - 2, py2 - 8, 4, 10)
      ctx.fillStyle = '#5a5a5a'
      ctx.fillRect(px2 - 2, py2 - 8, 4, 2)
      ctx.fillStyle = '#00d0ff'
      ctx.fillRect(px2 - 1, py2 - 7, 2, 1)
    }
  }
  else if (type === 'factory') {
    // ===== FACTORY: wide industrial facility (3x2) =====
    // Walls: big cargo door on right, multi-pane windows on left, pipe + valve.
    // Roof:  sawtooth panels + 2 chimneys with smoke.

    // --- Right wall: big roll-up cargo door + control room window above ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.20, 0.05, 0.80, 0.65, '#1a1a1a')
    for (let i = 0; i < 5; i++) {
      const v = 0.05 + i * 0.12
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.20, v + 0.10, 0.80, v + 0.12, '#3a3a3a')
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.40, 0.05, 0.42, 0.65, '#0a0a0a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.60, 0.05, 0.62, 0.65, '#0a0a0a')
    for (let i = 0; i < 6; i++) {
      const su = 0.20 + i * 0.10
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', su, 0.60, su + 0.05, 0.65, i % 2 === 0 ? '#ffcc00' : '#1a1a1a')
    }
    // control room window (cyan glow) above door
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.32, 0.74, 0.68, 0.84, '#00d0ff')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.49, 0.74, 0.51, 0.84, '#1a1a1a')

    // --- Left wall: 2 multi-pane windows + vertical pipe with valve wheel ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.10, 0.55, 0.40, 0.72, '#00d0ff')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.23, 0.55, 0.25, 0.72, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.10, 0.62, 0.40, 0.64, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.55, 0.55, 0.85, 0.72, '#00d0ff')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.69, 0.55, 0.71, 0.72, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.55, 0.62, 0.85, 0.64, '#1a1a1a')
    // Vertical pipe (left edge)
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.04, 0.05, 0.08, 0.85, '#4a4a4a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.05, 0.05, 0.06, 0.85, '#6a6a6a')
    // Valve wheel on pipe
    const vX = cx - 0.06 * dw
    const vY = cy + dh - 0.06 * dh - 0.40 * wallH
    ctx.fillStyle = '#5a5a5a'
    ctx.beginPath(); ctx.arc(vX, vY, 3, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 0.5
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2
      ctx.beginPath(); ctx.moveTo(vX, vY); ctx.lineTo(vX + Math.cos(a) * 3, vY + Math.sin(a) * 3); ctx.stroke()
    }

    // --- Hazard stripe at bottom of both walls ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0, 0.88, 1, 0.94, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left',  0, 0.88, 1, 0.94, '#1a1a1a')

    // --- Roof: sawtooth panels (4 angled parallelogram strips across the roof) ---
    const stripCount = 4
    for (let i = 0; i < stripCount; i++) {
      const u0 = i / stripCount
      const u1 = (i + 1) / stripCount
      const lx0 = roofCx - dw + u0 * 2 * dw
      const lx1 = roofCx - dw + u1 * 2 * dw
      const halfW = (lx1 - lx0) / 2
      const cxStrip = (lx0 + lx1) / 2
      ctx.fillStyle = i % 2 === 0 ? '#3a3a3a' : '#6a6a6a'
      ctx.beginPath()
      ctx.moveTo(cxStrip - halfW, roofCy)
      ctx.lineTo(cxStrip, roofCy - dh)
      ctx.lineTo(cxStrip + halfW, roofCy)
      ctx.lineTo(cxStrip, roofCy + dh)
      ctx.closePath()
      ctx.fill()
      // Glazing bar (vertical line at peak)
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cxStrip, roofCy - dh)
      ctx.lineTo(cxStrip, roofCy + dh)
      ctx.stroke()
      // Cyan glow strip at the top of each panel (glass facing the sun)
      ctx.fillStyle = 'rgba(0, 208, 255, 0.35)'
      ctx.beginPath()
      ctx.moveTo(cxStrip - halfW * 0.7, roofCy - dh * 0.3)
      ctx.lineTo(cxStrip, roofCy - dh)
      ctx.lineTo(cxStrip + halfW * 0.7, roofCy - dh * 0.3)
      ctx.lineTo(cxStrip, roofCy - dh * 0.4)
      ctx.closePath()
      ctx.fill()
    }

    // --- 2 chimneys rising from back of roof ---
    for (const offX of [-dw * 0.4, dw * 0.4]) {
      const chX = roofCx + offX
      const chY = roofCy - dh * 0.5
      const chH = 18
      const cg = ctx.createLinearGradient(chX - 4, 0, chX + 4, 0)
      cg.addColorStop(0, '#3a3a3a')
      cg.addColorStop(0.5, '#6a6a6a')
      cg.addColorStop(1, '#2a2a2a')
      ctx.fillStyle = cg
      ctx.fillRect(chX - 4, chY - chH, 8, chH)
      ctx.fillStyle = '#5a5a5a'
      ctx.fillRect(chX - 5, chY - chH - 2, 10, 3)
      // heat glow at top
      const heatG = ctx.createRadialGradient(chX, chY - chH, 0, chX, chY - chH, 5)
      heatG.addColorStop(0, 'rgba(255, 130, 50, 0.7)')
      heatG.addColorStop(1, 'rgba(255, 130, 50, 0)')
      ctx.fillStyle = heatG
      ctx.fillRect(chX - 5, chY - chH - 5, 10, 8)
      // smoke puffs
      ctx.fillStyle = 'rgba(180, 180, 180, 0.55)'
      for (let i = 0; i < 2; i++) {
        const smY = chY - chH - 6 - i * 4
        const smX = chX + (i - 0.5) * 2
        ctx.beginPath(); ctx.arc(smX, smY, 2 + i * 0.5, 0, Math.PI * 2); ctx.fill()
      }
    }
  }
  else if (type === 'refinery') {
    // ===== REFINERY: spice processing plant =====
    // Walls: spice-glow viewports, central door, pipes + valve wheel.
    // Roof:  large central cylindrical tank (orange glow), 2 side tanks, pipes.

    // --- Right wall: 2 spice-glow viewports + central door + horizontal pipe ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.38, 0.05, 0.62, 0.45, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.49, 0.05, 0.51, 0.45, '#0a0a0a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.38, 0.43, 0.62, 0.45, '#3a3a3a')
    for (let i = 0; i < 4; i++) {
      const su = 0.38 + i * 0.06
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', su, 0.40, su + 0.03, 0.43, i % 2 === 0 ? '#ffcc00' : '#1a1a1a')
    }
    // 2 spice-glow viewports (orange) above door
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.10, 0.55, 0.30, 0.75, '#3a1a08')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.12, 0.57, 0.28, 0.73, '#ff8030')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.14, 0.58, 0.26, 0.60, '#ffc080')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.70, 0.55, 0.90, 0.75, '#3a1a08')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.72, 0.57, 0.88, 0.73, '#ff8030')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.74, 0.58, 0.86, 0.60, '#ffc080')
    // Horizontal pipe along the right wall
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.05, 0.83, 0.95, 0.87, '#4a4a4a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.05, 0.83, 0.95, 0.84, '#6a6a6a')

    // --- Left wall: 3 vertical pipes + 2 spice-glow windows ---
    for (const u of [0.15, 0.50, 0.85]) {
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', u - 0.025, 0.05, u + 0.025, 0.85, '#4a4a4a')
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', u - 0.005, 0.05, u + 0.005, 0.85, '#6a6a6a')
    }
    // Pipe flanges
    for (const u of [0.15, 0.50, 0.85]) {
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', u - 0.035, 0.30, u + 0.035, 0.34, '#3a3a3a')
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', u - 0.035, 0.60, u + 0.035, 0.64, '#3a3a3a')
    }
    // 2 spice-glow windows (between pipes)
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.30, 0.45, 0.42, 0.65, '#3a1a08')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.32, 0.47, 0.40, 0.63, '#ff8030')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.58, 0.45, 0.70, 0.65, '#3a1a08')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.60, 0.47, 0.68, 0.63, '#ff8030')

    // Spice stain on ground in front
    ctx.fillStyle = 'rgba(255, 128, 48, 0.4)'
    diamondPath(ctx, cx + 5, cy + dh - 1, dw * 0.4, dh * 0.3)
    ctx.fill()

    // --- Valve wheel on right wall (visible circle) ---
    const vx = cx + 0.55 * dw
    const vy = cy + dh - 0.55 * dh - 0.85 * wallH
    ctx.fillStyle = '#5a5a5a'
    ctx.beginPath(); ctx.arc(vx, vy, 3, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 0.5
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2
      ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(vx + Math.cos(a) * 3, vy + Math.sin(a) * 3); ctx.stroke()
    }
    ctx.fillStyle = '#ff8030'
    ctx.beginPath(); ctx.arc(vx, vy, 1, 0, Math.PI * 2); ctx.fill()

    // --- Roof: large central tank (cylindrical, viewed from top, orange glow) ---
    const tankR = Math.min(dw, dh * 2) * 0.55
    ctx.fillStyle = '#3a3a3a'
    ctx.beginPath(); ctx.ellipse(roofCx, roofCy, tankR, tankR * 0.5, 0, 0, Math.PI * 2); ctx.fill()
    const tankG = ctx.createRadialGradient(roofCx, roofCy, 0, roofCx, roofCy, tankR)
    tankG.addColorStop(0, '#ffc080')
    tankG.addColorStop(0.4, '#ff8030')
    tankG.addColorStop(0.8, '#a04010')
    tankG.addColorStop(1, '#3a1a08')
    ctx.fillStyle = tankG
    ctx.beginPath(); ctx.ellipse(roofCx, roofCy, tankR * 0.85, tankR * 0.42, 0, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.ellipse(roofCx, roofCy, tankR * 0.85, tankR * 0.42, 0, 0, Math.PI * 2); ctx.stroke()
    // center valve + spice glow
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath(); ctx.arc(roofCx, roofCy, 2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ff8030'
    ctx.beginPath(); ctx.arc(roofCx, roofCy, 1, 0, Math.PI * 2); ctx.fill()

    // 2 side tanks (smaller, spice glow)
    for (const offX of [-dw * 0.6, dw * 0.6]) {
      const tx2 = roofCx + offX
      const ty2 = roofCy + dh * 0.2
      ctx.fillStyle = '#3a3a3a'
      ctx.beginPath(); ctx.ellipse(tx2, ty2, tankR * 0.35, tankR * 0.18, 0, 0, Math.PI * 2); ctx.fill()
      const sg = ctx.createRadialGradient(tx2, ty2, 0, tx2, ty2, tankR * 0.35)
      sg.addColorStop(0, '#ffa050')
      sg.addColorStop(0.7, '#a04010')
      sg.addColorStop(1, '#3a1a08')
      ctx.fillStyle = sg
      ctx.beginPath(); ctx.ellipse(tx2, ty2, tankR * 0.28, tankR * 0.14, 0, 0, Math.PI * 2); ctx.fill()
    }

    // Connecting pipes from main tank to side tanks
    ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(roofCx - tankR * 0.85, roofCy)
    ctx.lineTo(roofCx - dw * 0.6 + tankR * 0.28, roofCy + dh * 0.2)
    ctx.moveTo(roofCx + tankR * 0.85, roofCy)
    ctx.lineTo(roofCx + dw * 0.6 - tankR * 0.28, roofCy + dh * 0.2)
    ctx.stroke()
  }
  else if (type === 'generator') {
    // ===== GENERATOR: power plant with vertical plasma core =====
    // Walls: vertical cooling fins, vent slats, status panels, conduit LEDs.
    // Roof:  glowing plasma core, 4 lightning arcs, central pylon.

    // --- Right wall: 6 vertical cooling fins + 2 vent slats + status panel ---
    for (let i = 0; i < 6; i++) {
      const u = 0.08 + i * 0.15
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', u - 0.015, 0.05, u + 0.015, 0.75, '#2a2a2a')
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', u - 0.005, 0.05, u + 0.005, 0.75, '#4a4a4a')
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.05, 0.82, 0.95, 0.85, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.05, 0.88, 0.95, 0.91, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.05, 0.83, 0.95, 0.84, 'rgba(0,208,255,0.4)')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.05, 0.89, 0.95, 0.90, 'rgba(0,208,255,0.4)')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.35, 0.50, 0.65, 0.60, '#0a0a0a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.40, 0.53, 0.45, 0.55, '#00d0ff')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.55, 0.53, 0.60, 0.55, '#ffaa30')

    // --- Left wall: 6 vertical cooling fins + 1 vent slat + status panel ---
    for (let i = 0; i < 6; i++) {
      const u = 0.08 + i * 0.15
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', u - 0.015, 0.05, u + 0.015, 0.75, '#2a2a2a')
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', u - 0.005, 0.05, u + 0.005, 0.75, '#4a4a4a')
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.05, 0.82, 0.95, 0.85, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.05, 0.83, 0.95, 0.84, 'rgba(0,208,255,0.4)')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.35, 0.50, 0.65, 0.60, '#0a0a0a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.40, 0.53, 0.45, 0.55, '#00d0ff')

    // --- Conduit LEDs at bottom of both walls (cyan glowing dots) ---
    for (let i = 0; i < 5; i++) {
      const u = 0.10 + i * 0.20
      const rX = cx + u * dw
      const rY = cy + dh - u * dh - 0.96 * wallH
      const lg = ctx.createRadialGradient(rX, rY, 0, rX, rY, 3)
      lg.addColorStop(0, '#c0f4ff')
      lg.addColorStop(0.5, '#00d0ff')
      lg.addColorStop(1, 'rgba(0,208,255,0)')
      ctx.fillStyle = lg
      ctx.fillRect(rX - 3, rY - 3, 6, 6)
      const lX = cx - u * dw
      const lY = cy + dh - u * dh - 0.96 * wallH
      const lg2 = ctx.createRadialGradient(lX, lY, 0, lX, lY, 3)
      lg2.addColorStop(0, '#c0f4ff')
      lg2.addColorStop(0.5, '#00d0ff')
      lg2.addColorStop(1, 'rgba(0,208,255,0)')
      ctx.fillStyle = lg2
      ctx.fillRect(lX - 3, lY - 3, 6, 6)
    }

    // --- Faction accent stripe on both walls ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0, 0.76, 1, 0.78, col.dark)
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left',  0, 0.76, 1, 0.78, col.dark)

    // --- Roof: glowing plasma core + 4 lightning arcs + central pylon ---
    const coreR = Math.min(dw, dh * 2) * 0.55
    // Outer cyan halo (radial gradient)
    const haloG = ctx.createRadialGradient(roofCx, roofCy, 0, roofCx, roofCy, coreR * 1.4)
    haloG.addColorStop(0, 'rgba(0, 208, 255, 0.6)')
    haloG.addColorStop(0.5, 'rgba(0, 208, 255, 0.25)')
    haloG.addColorStop(1, 'rgba(0, 208, 255, 0)')
    ctx.fillStyle = haloG
    ctx.fillRect(roofCx - coreR * 1.4, roofCy - coreR * 0.8, coreR * 2.8, coreR * 1.6)
    // Containment ring (mechanical housing)
    ctx.fillStyle = '#3a3a3a'
    ctx.beginPath(); ctx.ellipse(roofCx, roofCy, coreR, coreR * 0.5, 0, 0, Math.PI * 2); ctx.fill()
    // 8 bolt mounts around ring
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4
      const bx = roofCx + Math.cos(a) * coreR * 0.9
      const by = roofCy + Math.sin(a) * coreR * 0.45
      ctx.fillStyle = '#1a1a1a'
      ctx.beginPath(); ctx.arc(bx, by, 1, 0, Math.PI * 2); ctx.fill()
    }
    // Bright plasma core (radial gradient)
    const plasmaG = ctx.createRadialGradient(roofCx, roofCy, 0, roofCx, roofCy, coreR * 0.7)
    plasmaG.addColorStop(0, '#ffffff')
    plasmaG.addColorStop(0.3, '#c0f4ff')
    plasmaG.addColorStop(0.6, '#00d0ff')
    plasmaG.addColorStop(1, '#003a5a')
    ctx.fillStyle = plasmaG
    ctx.beginPath(); ctx.ellipse(roofCx, roofCy, coreR * 0.7, coreR * 0.35, 0, 0, Math.PI * 2); ctx.fill()
    // Containment grid bars (cross)
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(roofCx - coreR * 0.7, roofCy); ctx.lineTo(roofCx + coreR * 0.7, roofCy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(roofCx, roofCy - coreR * 0.35); ctx.lineTo(roofCx, roofCy + coreR * 0.35); ctx.stroke()

    // 4 lightning arcs (jagged bolts) from core outward
    ctx.strokeStyle = '#c0f4ff'; ctx.lineWidth = 1
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4
      const ex = roofCx + Math.cos(a) * coreR * 1.3
      const ey = roofCy + Math.sin(a) * coreR * 0.65
      const mx = roofCx + Math.cos(a) * coreR * 0.7 + (rng() - 0.5) * 4
      const my = roofCy + Math.sin(a) * coreR * 0.35 + (rng() - 0.5) * 4
      ctx.beginPath()
      ctx.moveTo(roofCx, roofCy)
      ctx.lineTo(mx, my)
      ctx.lineTo(ex, ey)
      ctx.stroke()
    }

    // Central pylon (small vertical mast with cyan tip)
    ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(roofCx, roofCy - dh * 0.5); ctx.lineTo(roofCx, roofCy - dh * 0.5 - 10); ctx.stroke()
    // ceramic insulators
    ctx.fillStyle = '#d0d0d0'
    ctx.fillRect(roofCx - 2, roofCy - dh * 0.5 - 3, 4, 2)
    ctx.fillRect(roofCx - 2, roofCy - dh * 0.5 - 7, 4, 2)
    // tip glow
    const tipG = ctx.createRadialGradient(roofCx, roofCy - dh * 0.5 - 10, 0, roofCx, roofCy - dh * 0.5 - 10, 4)
    tipG.addColorStop(0, '#ffffff')
    tipG.addColorStop(0.5, '#00d0ff')
    tipG.addColorStop(1, 'rgba(0,208,255,0)')
    ctx.fillStyle = tipG
    ctx.fillRect(roofCx - 4, roofCy - dh * 0.5 - 14, 8, 8)
  }
  else if (type === 'turret') {
    // ===== TURRET: compact energy cannon (1x1) =====
    // Walls: small vision slits, reinforced panel seams.
    // Roof:  octagonal base pad, gun barrel pointing up, glowing core.

    // --- Right wall: vision slit + reinforced seams ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.35, 0.40, 0.65, 0.50, '#00d0ff')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.20, 0.05, 0.22, 0.85, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'right', 0.78, 0.05, 0.80, 0.85, '#1a1a1a')

    // --- Left wall: vision slit + reinforced seams ---
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.35, 0.40, 0.65, 0.50, '#00d0ff')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.20, 0.05, 0.22, 0.85, '#1a1a1a')
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, 'left', 0.78, 0.05, 0.80, 0.85, '#1a1a1a')

    // --- Faction accent dots on both walls ---
    const fX1 = cx + 0.5 * dw
    const fY1 = cy + dh - 0.5 * dh - 0.15 * wallH
    ctx.fillStyle = col.primary
    ctx.beginPath(); ctx.arc(fX1, fY1, 1.5, 0, Math.PI * 2); ctx.fill()
    const fX2 = cx - 0.5 * dw
    const fY2 = cy + dh - 0.5 * dh - 0.15 * wallH
    ctx.beginPath(); ctx.arc(fX2, fY2, 1.5, 0, Math.PI * 2); ctx.fill()

    // --- Roof: octagonal base pad + gun barrel ---
    diamondPath(ctx, roofCx, roofCy, dw * 0.7, dh * 0.7)
    ctx.fillStyle = '#2a2a2a'; ctx.fill()
    diamondPath(ctx, roofCx, roofCy, dw * 0.6, dh * 0.6)
    ctx.fillStyle = '#4a4a4a'; ctx.fill()
    // rivets at 4 corners of pad
    const rivets: [number, number][] = [
      [roofCx - dw * 0.6, roofCy], [roofCx + dw * 0.6, roofCy],
      [roofCx, roofCy - dh * 0.6], [roofCx, roofCy + dh * 0.6],
    ]
    for (const [rx, ry] of rivets) {
      ctx.fillStyle = '#1a1a1a'
      ctx.beginPath(); ctx.arc(rx, ry, 1, 0, Math.PI * 2); ctx.fill()
    }

    // Glowing power cell at center of pad
    const cellG = ctx.createRadialGradient(roofCx, roofCy, 0, roofCx, roofCy, 4)
    cellG.addColorStop(0, '#ffffff')
    cellG.addColorStop(0.5, '#00d0ff')
    cellG.addColorStop(1, 'rgba(0,208,255,0)')
    ctx.fillStyle = cellG
    ctx.fillRect(roofCx - 4, roofCy - 4, 8, 8)

    // Gun barrel pointing straight up
    const barrelLen = 12
    ctx.fillStyle = '#3a3a3a'
    ctx.fillRect(roofCx - 2, roofCy - barrelLen, 4, barrelLen)
    ctx.fillStyle = '#5a5a5a'
    ctx.fillRect(roofCx - 1, roofCy - barrelLen, 1, barrelLen)
    // mantlet (trapezoidal base where barrel meets pad)
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(roofCx - 3, roofCy - 4, 6, 4)
    ctx.fillStyle = '#4a4a4a'
    ctx.fillRect(roofCx - 2, roofCy - 3, 4, 2)
    // muzzle ring at barrel tip
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(roofCx - 3, roofCy - barrelLen - 2, 6, 2)
    // muzzle glow (charging tip)
    const muzG = ctx.createRadialGradient(roofCx, roofCy - barrelLen - 1, 0, roofCx, roofCy - barrelLen - 1, 4)
    muzG.addColorStop(0, '#ffffff')
    muzG.addColorStop(0.4, '#00d0ff')
    muzG.addColorStop(1, 'rgba(0,208,255,0)')
    ctx.fillStyle = muzG
    ctx.fillRect(roofCx - 4, roofCy - barrelLen - 5, 8, 8)

    // 2 amber status lights at base of barrel
    for (const offX of [-3, 3]) {
      ctx.fillStyle = '#ffaa30'
      ctx.beginPath(); ctx.arc(roofCx + offX, roofCy + 2, 0.8, 0, Math.PI * 2); ctx.fill()
    }
  }

  // ============================================================
  //  6. OUTLINE EDGES (dark strokes for definition)
  // ============================================================
  ctx.strokeStyle = '#0a0a0a'
  ctx.lineWidth = 1
  wallFacePath(ctx, cx, cy, dw, dh, wallH, 'right')
  ctx.stroke()
  wallFacePath(ctx, cx, cy, dw, dh, wallH, 'left')
  ctx.stroke()
  diamondPath(ctx, roofCx, roofCy, dw, dh)
  ctx.stroke()
  // Base diamond front edges (visible front-bottom V)
  ctx.beginPath()
  ctx.moveTo(cx - dw, cy)
  ctx.lineTo(cx, cy + dh)
  ctx.lineTo(cx + dw, cy)
  ctx.stroke()

  buildingCache.set(key, c)
  return c
}
