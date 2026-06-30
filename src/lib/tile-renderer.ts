// tile-renderer.ts — High-detail procedural tile rendering (40px tiles, gradients, shadows, animation)

export const TILE_SIZE = 40

export interface TileDef {
  id: number
  name: string
  category: 'terrain' | 'building' | 'unit'
  walkable: boolean
  buildable: boolean
}

export const TERRAIN: Record<number, TileDef> = {
  0: { id: 0, name: 'Пустота',      category: 'terrain', walkable: false, buildable: false },
  1: { id: 1, name: 'Песок',        category: 'terrain', walkable: true,  buildable: true  },
  2: { id: 2, name: 'Дюны',         category: 'terrain', walkable: true,  buildable: true  },
  3: { id: 3, name: 'Скала',        category: 'terrain', walkable: false, buildable: true  },
  4: { id: 4, name: 'Горы',         category: 'terrain', walkable: false, buildable: false },
  5: { id: 5, name: 'Спайс',        category: 'terrain', walkable: true,  buildable: false },
  6: { id: 6, name: 'Богатый спайс', category: 'terrain', walkable: true,  buildable: false },
  7: { id: 7, name: 'Вода',         category: 'terrain', walkable: false, buildable: false },
}

// ---------- Deterministic hash for texture variation ----------
function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
function mulberry(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 429496296
  }
}

// ---------- Pixel helper ----------
function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

// ============================================================
//  SEAMLESS TERRAIN RENDERING (no visible tile squares)
//  Uses world-space noise so neighboring tiles blend continuously.
// ============================================================

// 2D value noise — smooth, continuous across tile boundaries
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const fade = (t: number) => t * t * (3 - 2 * t)
  const u = fade(xf), v = fade(yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

// Multi-octave noise for richer texture
function fbm(x: number, y: number, octaves = 3): number {
  let sum = 0, amp = 0.5, freq = 1
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp
    amp *= 0.5; freq *= 2
  }
  return sum
}

// ---------- Cached continuous SAND BASE (per-pixel noise, seamless) ----------
// Renders the entire map's sand once at half resolution, upscaled smoothly.
// Key: color varies per-PIXEL using world-space noise → no tile squares.
const sandBaseCache = new Map<string, HTMLCanvasElement>()

function getSandBase(mapW: number, mapH: number): HTMLCanvasElement {
  const key = `${mapW}x${mapH}`
  let c = sandBaseCache.get(key)
  if (c) return c
  const scale = 2 // render at 1/2 res, upscale smooth
  const w = Math.ceil((mapW * TILE_SIZE) / scale)
  const h = Math.ceil((mapH * TILE_SIZE) / scale)
  c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const data = img.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // world-space coordinates (in tile units)
      const wx = (x * scale) / TILE_SIZE
      const wy = (y * scale) / TILE_SIZE
      // multi-octave noise for natural sand variation
      const n = fbm(wx * 0.35, wy * 0.35, 4) // 0..~0.9
      const n2 = fbm(wx * 1.2 + 100, wy * 1.2 + 100, 2) // fine detail
      const t = Math.max(0, Math.min(1, n / 0.7))
      const t2 = Math.max(0, Math.min(1, n2 / 0.6))
      // warm sand palette: dark amber → golden
      const r = Math.round(195 + t * 45 + (t2 - 0.5) * 12)
      const g = Math.round(145 + t * 38 + (t2 - 0.5) * 10)
      const b = Math.round(68 + t * 27 + (t2 - 0.5) * 6)
      const i = (y * w + x) * 4
      data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  sandBaseCache.set(key, c)
  return c
}

// ---------- FULL TERRAIN BASE (all types, per-pixel, truly seamless) ----------
// Renders every terrain type with continuous per-pixel noise → NO tile squares.
// Cached by version; call clearTerrainCache() when terrain changes.
const terrainBaseCache = new Map<string, HTMLCanvasElement>()

export function clearTerrainCache() {
  terrainBaseCache.clear()
  sandBaseCache.clear()
}

function getTerrainBase(terrain: number[], mapW: number, mapH: number, version: number): HTMLCanvasElement {
  const key = `${mapW}x${mapH}-v${version}`
  let c = terrainBaseCache.get(key)
  if (c) return c
  const scale = 2
  const w = Math.ceil((mapW * TILE_SIZE) / scale)
  const h = Math.ceil((mapH * TILE_SIZE) / scale)
  c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const data = img.data

  // color function for each terrain type at world coords (continuous noise)
  const typeColor = (t: number, wx: number, wy: number): [number, number, number] => {
    if (t === 0) return [8, 6, 4]
    if (t === 1 || t === 2 || t === 5 || t === 6) {
      const n = fbm(wx * 0.35, wy * 0.35, 4)
      const n2 = fbm(wx * 1.2 + 100, wy * 1.2 + 100, 2)
      const tn = Math.max(0, Math.min(1, n / 0.7))
      const tn2 = Math.max(0, Math.min(1, n2 / 0.6))
      let r = 195 + tn * 45 + (tn2 - 0.5) * 12
      let g = 145 + tn * 38 + (tn2 - 0.5) * 10
      let b = 68 + tn * 27 + (tn2 - 0.5) * 6
      if (t === 5) { r = r * 0.7 + 232 * 0.3; g = g * 0.7 + 93 * 0.3; b = b * 0.7 + 47 * 0.3 }
      else if (t === 6) { r = r * 0.6 + 200 * 0.4; g = g * 0.6 + 60 * 0.4; b = b * 0.6 + 30 * 0.4 }
      if (t === 2) { r *= 0.88; g *= 0.86; b *= 0.82 }
      return [r, g, b]
    }
    if (t === 3) {
      const n = fbm(wx * 0.3, wy * 0.3, 4)
      const n2 = fbm(wx * 1.5 + 50, wy * 1.5 + 50, 2)
      const tn = n / 0.7
      const tn2 = (n2 - 0.5) * 20
      return [118 + tn * 32 + tn2, 113 + tn * 30 + tn2, 103 + tn * 26 + tn2]
    }
    if (t === 4) {
      const n = fbm(wx * 0.3, wy * 0.3, 4)
      return [82 + n * 25, 75 + n * 22, 65 + n * 18]
    }
    if (t === 7) {
      const n = fbm(wx * 0.4, wy * 0.4, 3)
      return [40 + n * 30, 120 + n * 40, 170 + n * 40]
    }
    return [8, 6, 4]
  }

  const typeAt = (wx: number, wy: number): number => {
    const tx = Math.floor(wx), ty = Math.floor(wy)
    return (tx >= 0 && ty >= 0 && tx < mapW && ty < mapH) ? terrain[ty * mapW + tx] : 0
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const wx = (x * scale) / TILE_SIZE
      const wy = (y * scale) / TILE_SIZE
      const i = (y * w + x) * 4
      // sample terrain type at this pixel + 4 neighbors for boundary blending
      const t0 = typeAt(wx, wy)
      const offsets = [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]
      let r = 0, g = 0, b = 0, total = 0
      // center weight = 1, each neighbor weight = 0.25 (only if different type)
      const [cr, cg, cb] = typeColor(t0, wx, wy)
      r += cr; g += cg; b += cb; total += 1
      for (const [dx, dy] of offsets) {
        const tn = typeAt(wx + dx, wy + dy)
        if (tn !== t0) {
          const [nr, ng, nb] = typeColor(tn, wx + dx, wy + dy)
          r += nr * 0.3; g += ng * 0.3; b += nb * 0.3; total += 0.3
        }
      }
      r /= total; g /= total; b /= total
      data[i] = Math.max(0, Math.min(255, Math.round(r)))
      data[i+1] = Math.max(0, Math.min(255, Math.round(g)))
      data[i+2] = Math.max(0, Math.min(255, Math.round(b)))
      data[i+3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  terrainBaseCache.set(key, c)
  for (const k of terrainBaseCache.keys()) {
    if (k !== key) terrainBaseCache.delete(k)
  }
  return c
}

// Render one seamless terrain tile at world position (gx, gy)
// NOTE: sand base is pre-rendered for the whole map — tiles only draw
// features ON TOP of it (dunes ripples, spice glow, rock, water, etc.)
function drawSeamlessTile(
  ctx: CanvasRenderingContext2D,
  tileId: number,
  gx: number, gy: number,
  animPhase: number,
) {
  const s = TILE_SIZE
  const ox = gx * s, oy = gy * s
  ctx.save()
  ctx.translate(ox, oy)

  if (tileId === 0) {
    ctx.fillStyle = '#080604'
    ctx.fillRect(0, 0, s, s)
  } else if (tileId === 1) {
    // Sand — nothing to draw, sand base shows through (seamless)
    // optional: very faint grain
    const rng = mulberry((gx * 73856093) ^ (gy * 19349663))
    ctx.fillStyle = 'rgba(120,70,20,0.06)'
    for (let i = 0; i < 4; i++) ctx.fillRect(rng() * s, rng() * s, 1, 1)
  } else if (tileId === 2) {
    // Dunes — sand base + ripple lines (continuous wave)
    const rng = mulberry((gx * 73856093) ^ (gy * 19349663))
    ctx.fillStyle = 'rgba(120,70,20,0.06)'
    for (let i = 0; i < 4; i++) ctx.fillRect(rng() * s, rng() * s, 1, 1)
    // dune ripple crests — continuous across tiles via world coords
    ctx.strokeStyle = 'rgba(120,75,20,0.4)'
    ctx.lineWidth = 1.5
    for (let i = 0; i < 3; i++) {
      const yo = i * (s / 3) + 5
      ctx.beginPath()
      ctx.moveTo(-1, yo)
      for (let x = 0; x <= s; x += 3) {
        const wy = yo + Math.sin((gx * s + x) * 0.13 + gy * 0.6) * 3
        ctx.lineTo(x, wy)
      }
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(255,225,150,0.32)'
    ctx.lineWidth = 1
    for (let i = 0; i < 3; i++) {
      const yo = i * (s / 3) + 3.5
      ctx.beginPath()
      ctx.moveTo(-1, yo)
      for (let x = 0; x <= s; x += 3) {
        const wy = yo + Math.sin((gx * s + x) * 0.13 + gy * 0.6) * 3
        ctx.lineTo(x, wy)
      }
      ctx.stroke()
    }
  } else if (tileId === 3) {
    // Rock — opaque rocky ground
    const n = fbm(gx * 0.2, gy * 0.2, 3)
    const t = n / 0.7
    const r = Math.round(118 + t * 32)
    const g = Math.round(113 + t * 30)
    const b = Math.round(103 + t * 26)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(0, 0, s, s)
    const rng = mulberry((gx * 12345) ^ (gy * 54321))
    ctx.fillStyle = 'rgba(50,45,35,0.45)'
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(rng() * s, rng() * s, 2 + rng() * 4, 1)
    }
    ctx.fillStyle = 'rgba(180,175,165,0.35)'
    for (let i = 0; i < 5; i++) ctx.fillRect(rng() * s, rng() * s, 1, 1)
  } else if (tileId === 4) {
    // Mountain — rocky base + soft peak + snow
    const n = fbm(gx * 0.2, gy * 0.2, 3)
    ctx.fillStyle = `rgb(${82 + n * 22},${75 + n * 20},${65 + n * 16})`
    ctx.fillRect(0, 0, s, s)
    const peakGrad = ctx.createRadialGradient(s / 2, s * 0.6, 2, s / 2, s * 0.6, s * 0.55)
    peakGrad.addColorStop(0, '#9a8e7e')
    peakGrad.addColorStop(0.5, '#6a5e50')
    peakGrad.addColorStop(1, 'rgba(58,50,40,0)')
    ctx.fillStyle = peakGrad
    ctx.fillRect(0, 0, s, s)
    const snow = ctx.createRadialGradient(s / 2, s * 0.25, 1, s / 2, s * 0.25, s * 0.2)
    snow.addColorStop(0, 'rgba(245,245,250,0.95)')
    snow.addColorStop(1, 'rgba(245,245,250,0)')
    ctx.fillStyle = snow
    ctx.fillRect(0, 0, s, s)
  } else if (tileId === 5 || tileId === 6) {
    // Spice — sand base shows through + glowing crystals (semi-transparent)
    const rich = tileId === 6
    ctx.fillStyle = rich ? 'rgba(200,60,30,0.22)' : 'rgba(232,93,47,0.16)'
    ctx.fillRect(0, 0, s, s)
    const rng = mulberry((gx * 3333) ^ (gy * 7777))
    const count = rich ? 5 : 4
    for (let i = 0; i < count; i++) {
      const cx = 4 + rng() * (s - 8), cy = 4 + rng() * (s - 8)
      const rad = 4 + rng() * 4
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
      glow.addColorStop(0, rich ? 'rgba(255,100,50,0.85)' : 'rgba(255,140,70,0.7)')
      glow.addColorStop(0.5, rich ? 'rgba(220,60,30,0.5)' : 'rgba(232,93,47,0.4)')
      glow.addColorStop(1, 'rgba(232,93,47,0)')
      ctx.fillStyle = glow
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
      ctx.fillStyle = rich ? '#ff7050' : '#ff9060'
      ctx.fillRect(cx - 1, cy - 1, 2, 2)
    }
  } else if (tileId === 7) {
    // Water — opaque, animated continuous ripples
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#3aa0c8'); g.addColorStop(1, '#1a5e80')
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
    ctx.strokeStyle = 'rgba(150,220,240,0.4)'
    ctx.lineWidth = 1
    const phase = animPhase * 0.6
    for (let i = 0; i < 4; i++) {
      const yo = (i * (s / 4) + phase) % s
      ctx.beginPath()
      ctx.moveTo(-1, yo)
      for (let x = 0; x <= s; x += 3) {
        const wy = yo + Math.sin((gx * s + x) * 0.2 + phase) * 1.2
        ctx.lineTo(x, wy)
      }
      ctx.stroke()
    }
    const rng = mulberry((gx * 999) ^ (gy * 111))
    ctx.fillStyle = 'rgba(220,245,255,0.6)'
    ctx.fillRect((phase * 3 + rng() * s) % s, 3, 2, 1)
  }

  ctx.restore()
}

// Soft edge blending: feather borders where rock/water/mountain meets sand
function blendEdges(
  ctx: CanvasRenderingContext2D,
  tileId: number,
  gx: number, gy: number,
  terrain: number[], w: number, h: number,
) {
  const s = TILE_SIZE
  const ox = gx * s, oy = gy * s
  if (tileId === 0 || tileId === 1 || tileId === 2) return
  const neighbors = [
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
  ]
  for (const nb of neighbors) {
    const nx = gx + nb.dx, ny = gy + nb.dy
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
    const nt = terrain[ny * w + nx]
    if (nt === tileId || nt === 0) continue
    if ((nt === 1 || nt === 2) && (tileId === 3 || tileId === 7 || tileId === 4)) {
      const grad = ctx.createLinearGradient(
        nb.dx === -1 ? ox : nb.dx === 1 ? ox + s : ox,
        nb.dy === -1 ? oy : nb.dy === 1 ? oy + s : oy,
        nb.dx === -1 ? ox + 5 : nb.dx === 1 ? ox + s - 5 : ox,
        nb.dy === -1 ? oy + 5 : nb.dy === 1 ? oy + s - 5 : oy,
      )
      grad.addColorStop(0, 'rgba(210,160,75,0.7)')
      grad.addColorStop(1, 'rgba(210,160,75,0)')
      ctx.fillStyle = grad
      if (nb.dx === -1) ctx.fillRect(ox, oy, 5, s)
      else if (nb.dx === 1) ctx.fillRect(ox + s - 5, oy, 5, s)
      else if (nb.dy === -1) ctx.fillRect(ox, oy, s, 5)
      else if (nb.dy === 1) ctx.fillRect(ox, oy + s - 5, s, 5)
    }
  }
}

// ---------- Public: draw full seamless terrain layer ----------
// Blits the continuous terrain base (per-pixel, no squares) then draws
// feature overlays on top (dune ripples, spice glow, water animation, peaks).
export function drawTerrainLayer(
  ctx: CanvasRenderingContext2D,
  terrain: number[], w: number, h: number,
  animPhase: number,
  version = 0,
) {
  // 1. continuous terrain base — ALL types per-pixel noise, truly seamless
  const base = getTerrainBase(terrain, w, h, version)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(base, 0, 0, w * TILE_SIZE, h * TILE_SIZE)
  // 2. per-tile feature overlays (semi-transparent, sand base shows through)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = terrain[y * w + x]
      if (t === 2) {
        // dunes: ripple crests on top of sand-colored base
        drawDuneRipples(ctx, x, y)
      } else if (t === 5 || t === 6) {
        // spice: glowing crystal clusters
        drawSpiceGlow(ctx, x, y, t === 6)
      } else if (t === 7) {
        // water: animated ripples
        drawWaterAnim(ctx, x, y, animPhase)
      } else if (t === 4) {
        // mountain: peak + snow cap overlay
        drawMountainPeak(ctx, x, y)
      }
    }
  }
}

// Feature overlays — drawn semi-transparently over the seamless base
function drawDuneRipples(ctx: CanvasRenderingContext2D, gx: number, gy: number) {
  const s = TILE_SIZE
  ctx.save()
  ctx.translate(gx * s, gy * s)
  // ripples use world-space Y so they flow continuously across tiles
  ctx.strokeStyle = 'rgba(120,75,20,0.3)'
  ctx.lineWidth = 1.5
  for (let i = 0; i < 4; i++) {
    const yo = ((gy * s + i * 10 + 5) % s)
    ctx.beginPath()
    ctx.moveTo(-1, yo)
    for (let x = 0; x <= s; x += 3) {
      const wy = yo + Math.sin((gx * s + x) * 0.13 + gy * 0.6) * 3
      ctx.lineTo(x, wy)
    }
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(255,225,150,0.2)'
  ctx.lineWidth = 1
  for (let i = 0; i < 4; i++) {
    const yo = ((gy * s + i * 10 + 3) % s)
    ctx.beginPath()
    ctx.moveTo(-1, yo)
    for (let x = 0; x <= s; x += 3) {
      const wy = yo + Math.sin((gx * s + x) * 0.13 + gy * 0.6) * 3
      ctx.lineTo(x, wy)
    }
    ctx.stroke()
  }
  ctx.restore()
}

function drawSpiceGlow(ctx: CanvasRenderingContext2D, gx: number, gy: number, rich: boolean) {
  const s = TILE_SIZE
  ctx.save()
  ctx.translate(gx * s, gy * s)
  const rng = mulberry((gx * 3333) ^ (gy * 7777))
  const count = rich ? 5 : 4
  for (let i = 0; i < count; i++) {
    const cx = 4 + rng() * (s - 8), cy = 4 + rng() * (s - 8)
    const rad = 4 + rng() * 4
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    glow.addColorStop(0, rich ? 'rgba(255,100,50,0.7)' : 'rgba(255,140,70,0.55)')
    glow.addColorStop(0.5, rich ? 'rgba(220,60,30,0.4)' : 'rgba(232,93,47,0.3)')
    glow.addColorStop(1, 'rgba(232,93,47,0)')
    ctx.fillStyle = glow
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
    ctx.fillStyle = rich ? '#ff7050' : '#ff9060'
    ctx.fillRect(cx - 1, cy - 1, 2, 2)
  }
  ctx.restore()
}

function drawWaterAnim(ctx: CanvasRenderingContext2D, gx: number, gy: number, animPhase: number) {
  const s = TILE_SIZE
  ctx.save()
  ctx.translate(gx * s, gy * s)
  ctx.strokeStyle = 'rgba(150,220,240,0.3)'
  ctx.lineWidth = 1
  const phase = animPhase * 0.6
  for (let i = 0; i < 3; i++) {
    const yo = (i * (s / 3) + phase) % s
    ctx.beginPath()
    ctx.moveTo(-1, yo)
    for (let x = 0; x <= s; x += 3) {
      const wy = yo + Math.sin((gx * s + x) * 0.2 + phase) * 1.2
      ctx.lineTo(x, wy)
    }
    ctx.stroke()
  }
  ctx.restore()
}

function drawMountainPeak(ctx: CanvasRenderingContext2D, gx: number, gy: number) {
  const s = TILE_SIZE
  ctx.save()
  ctx.translate(gx * s, gy * s)
  // soft peak highlight
  const peakGrad = ctx.createRadialGradient(s / 2, s * 0.6, 2, s / 2, s * 0.6, s * 0.5)
  peakGrad.addColorStop(0, 'rgba(154,142,126,0.5)')
  peakGrad.addColorStop(0.5, 'rgba(106,94,80,0.3)')
  peakGrad.addColorStop(1, 'rgba(58,50,40,0)')
  ctx.fillStyle = peakGrad
  ctx.fillRect(0, 0, s, s)
  // snow cap
  const snow = ctx.createRadialGradient(s / 2, s * 0.25, 1, s / 2, s * 0.25, s * 0.18)
  snow.addColorStop(0, 'rgba(245,245,250,0.7)')
  snow.addColorStop(1, 'rgba(245,245,250,0)')
  ctx.fillStyle = snow
  ctx.fillRect(0, 0, s, s)
  ctx.restore()
}

// Backward-compatible single-tile draw (used by editor preview etc.)
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  tileId: number,
  gx: number, gy: number,
  animPhase = 0,
  _terrain?: number[], _w?: number, _h?: number,
) {
  drawSeamlessTile(ctx, tileId, gx, gy, animPhase)
}

// ---------- Palette preview (for editor) ----------
export function getTerrainTile(tileId: number, _variant = 0): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = TILE_SIZE; c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  if (tileId !== 0) {
    ctx.fillStyle = '#d4a040'
    ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE)
  }
  drawSeamlessTile(ctx, tileId, 0, 0, 0)
  return c
}

// ---------- Faction colors ----------
export const FACTION_COLORS = {
  atreides:  { primary: '#2e6fd0', light: '#5a9dee', dark: '#1a4a90', flag: '#4a8fd8', trim: '#88c0ff' },
  harkonnen: { primary: '#8a2098', light: '#b84cc0', dark: '#5a1068', flag: '#a840b8', trim: '#d070e0' },
  ordos:     { primary: '#1a9e4d', light: '#40c870', dark: '#0d6a2e', flag: '#22c55e', trim: '#60e090' },
  neutral:   { primary: '#9a8a6a', light: '#c0b08a', dark: '#6a5a3a', flag: '#b8a878', trim: '#d0c098' },
}
export type Faction = keyof typeof FACTION_COLORS

// ---------- Building rendering (detailed, volumetric) ----------
export type BuildingType = 'palace' | 'barracks' | 'factory' | 'turret' | 'refinery'

const buildingCache = new Map<string, HTMLCanvasElement>()

function renderBuilding(type: BuildingType, faction: Faction): HTMLCanvasElement {
  const key = `${type}_${faction}`
  let c = buildingCache.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = TILE_SIZE; c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  const col = FACTION_COLORS[faction]
  const s = TILE_SIZE

  // ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(s/2, s - 3, s/2 - 3, 4, 0, 0, Math.PI * 2)
  ctx.fill()

  if (type === 'palace') {
    // base platform
    rrect(ctx, 3, 12, s - 6, s - 16, 2, col.dark)
    // front wall
    rrect(ctx, 4, 13, s - 8, s - 18, 1, col.primary)
    // central keep
    rrect(ctx, s/2 - 5, 5, 10, 10, 1, col.primary)
    px(ctx, s/2 - 4, 5, 8, 1, col.light)
    // keep roof
    ctx.fillStyle = '#3a2a1a'
    ctx.beginPath(); ctx.moveTo(s/2 - 6, 6); ctx.lineTo(s/2, 2); ctx.lineTo(s/2 + 6, 6); ctx.closePath(); ctx.fill()
    // side towers
    rrect(ctx, 3, 8, 6, s - 12, 1, col.primary)
    rrect(ctx, s - 9, 8, 6, s - 12, 1, col.primary)
    px(ctx, 3, 8, 6, 1, col.light); px(ctx, s - 9, 8, 6, 1, col.light)
    // tower roofs
    ctx.fillStyle = '#3a2a1a'
    ctx.beginPath(); ctx.moveTo(2, 9); ctx.lineTo(6, 5); ctx.lineTo(10, 9); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.moveTo(s - 10, 9); ctx.lineTo(s - 6, 5); ctx.lineTo(s - 2, 9); ctx.closePath(); ctx.fill()
    // door
    rrect(ctx, s/2 - 3, s - 10, 6, 6, 2, '#1a1208')
    px(ctx, s/2 - 2, s - 9, 4, 1, col.trim)
    // windows (glowing)
    px(ctx, 6, 14, 3, 3, '#ffd060'); px(ctx, 6, 14, 1, 1, '#fff0a0')
    px(ctx, s - 9, 14, 3, 3, '#ffd060'); px(ctx, s - 9, 14, 1, 1, '#fff0a0')
    px(ctx, s/2 - 1, 8, 2, 2, '#ffd060')
    // flag on keep
    px(ctx, s/2, 1, 1, 6, '#5a4a3a')
    ctx.fillStyle = col.flag
    ctx.beginPath(); ctx.moveTo(s/2 + 1, 1); ctx.lineTo(s/2 + 5, 3); ctx.lineTo(s/2 + 1, 5); ctx.closePath(); ctx.fill()
  } else if (type === 'barracks') {
    // base
    rrect(ctx, 3, 14, s - 6, s - 18, 2, col.dark)
    rrect(ctx, 4, 15, s - 8, s - 20, 1, col.primary)
    // sloped roof
    ctx.fillStyle = '#2a1a0a'
    ctx.beginPath(); ctx.moveTo(2, 16); ctx.lineTo(s/2, 8); ctx.lineTo(s - 2, 16); ctx.closePath(); ctx.fill()
    px(ctx, 2, 15, s - 4, 1, '#3a2a1a')
    // faction stripe
    px(ctx, 4, 18, s - 8, 2, col.light)
    px(ctx, 4, 20, s - 8, 1, col.trim)
    // door
    rrect(ctx, s/2 - 3, s - 10, 6, 7, 2, '#1a1208')
    px(ctx, s/2 - 2, s - 9, 4, 1, col.trim)
    // windows
    px(ctx, 6, 18, 3, 2, '#ffd060'); px(ctx, s - 9, 18, 3, 2, '#ffd060')
    // antenna with flag
    px(ctx, 5, 4, 1, 8, '#5a5a5a')
    ctx.fillStyle = col.flag
    ctx.beginPath(); ctx.moveTo(6, 4); ctx.lineTo(10, 5); ctx.lineTo(6, 7); ctx.closePath(); ctx.fill()
    // sandbag detail
    px(ctx, 2, s - 5, 3, 2, '#8a7040'); px(ctx, s - 5, s - 5, 3, 2, '#8a7040')
  } else if (type === 'factory') {
    // main structure
    rrect(ctx, 2, 16, s - 4, s - 20, 2, col.dark)
    rrect(ctx, 3, 17, s - 6, s - 22, 1, col.primary)
    // chimney
    rrect(ctx, s - 11, 5, 5, 12, 1, '#4a4a4a')
    px(ctx, s - 11, 5, 5, 1, '#3a3a3a')
    // smoke (puffs)
    ctx.fillStyle = 'rgba(190,190,190,0.7)'
    ctx.beginPath(); ctx.arc(s - 8, 3, 2, 0, Math.PI*2); ctx.fill()
    ctx.fillStyle = 'rgba(170,170,170,0.5)'
    ctx.beginPath(); ctx.arc(s - 6, 1, 2.5, 0, Math.PI*2); ctx.fill()
    // sawtooth roof
    for (let i = 0; i < 3; i++) {
      const bx = 3 + i * 11
      ctx.fillStyle = col.light
      ctx.beginPath(); ctx.moveTo(bx, 16); ctx.lineTo(bx + 5, 11); ctx.lineTo(bx + 9, 16); ctx.closePath(); ctx.fill()
      px(ctx, bx + 5, 11, 1, 5, col.trim)
    }
    // big garage door
    rrect(ctx, s/2 - 5, s - 11, 10, 9, 1, '#1a1208')
    px(ctx, s/2 - 5, s - 11, 10, 1, col.trim)
    // door panels
    ctx.strokeStyle = col.dark; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(s/2, s - 11); ctx.lineTo(s/2, s - 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(s/2 - 5, s - 7); ctx.lineTo(s/2 + 5, s - 7); ctx.stroke()
    // window
    px(ctx, 5, 19, 4, 3, '#ffd060'); px(ctx, 5, 19, 1, 1, '#fff0a0')
  } else if (type === 'turret') {
    // base platform
    ctx.fillStyle = '#3a3a3a'
    ctx.beginPath(); ctx.ellipse(s/2, s/2 + 4, 9, 7, 0, 0, Math.PI*2); ctx.fill()
    px(ctx, s/2 - 8, s/2 + 3, 16, 6, col.dark)
    px(ctx, s/2 - 7, s/2 + 2, 14, 1, col.primary)
    // turret dome
    ctx.fillStyle = col.primary
    ctx.beginPath(); ctx.arc(s/2, s/2, 6, Math.PI, 0); ctx.fill()
    px(ctx, s/2 - 5, s/2 - 4, 10, 1, col.light)
    // cannon
    px(ctx, s/2 - 1, s/2 - 6, 3, 5, '#2a2a2a')
    px(ctx, s/2 - 2, s/2 - 7, 5, 1, '#1a1a1a')
    px(ctx, s/2 + 2, s/2 - 6, 1, 4, '#3a3a3a')
    // muzzle
    px(ctx, s/2 - 1, s/2 - 7, 3, 1, '#5a5a5a')
    // emblem
    px(ctx, s/2 - 1, s/2 + 1, 2, 1, col.flag)
  } else if (type === 'refinery') {
    // structure
    rrect(ctx, 3, 14, s - 6, s - 18, 2, col.dark)
    rrect(ctx, 4, 15, s - 8, s - 20, 1, col.primary)
    // pipes
    px(ctx, 2, 18, s - 4, 1, col.light)
    px(ctx, 2, 22, s - 4, 1, col.light)
    px(ctx, 2, 19, s - 4, 1, col.trim)
    // tank dome
    ctx.fillStyle = '#6a6a6a'
    ctx.beginPath(); ctx.arc(s/2, 9, 6, Math.PI, 0); ctx.fill()
    px(ctx, s/2 - 5, 8, 10, 1, '#8a8a8a')
    px(ctx, s/2 - 4, 7, 8, 1, '#a0a0a0')
    // tank valve
    px(ctx, s/2 - 1, 9, 2, 1, col.flag)
    // valves
    ctx.fillStyle = '#ffd060'
    ctx.beginPath(); ctx.arc(5, 18, 2, 0, Math.PI*2); ctx.fill()
    ctx.beginPath(); ctx.arc(s - 5, 18, 2, 0, Math.PI*2); ctx.fill()
    px(ctx, 5, 17, 1, 3, '#a07020'); px(ctx, s - 5, 17, 1, 3, '#a07020')
    // spice stain
    px(ctx, s/2 - 2, s - 5, 4, 1, '#e85d2f')
  }

  buildingCache.set(key, c)
  return c
}

export function drawBuilding(ctx: CanvasRenderingContext2D, type: BuildingType, faction: Faction, px_: number, py_: number) {
  const img = renderBuilding(type, faction)
  ctx.drawImage(img, px_, py_)
}

// ---------- Unit rendering (detailed, with bob animation) ----------
export type UnitType = 'harvester' | 'soldier' | 'tank'

const unitCache = new Map<string, HTMLCanvasElement>()

function renderUnit(type: UnitType, faction: Faction): HTMLCanvasElement {
  const key = `${type}_${faction}`
  let c = unitCache.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = TILE_SIZE; c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  const col = FACTION_COLORS[faction]
  const s = TILE_SIZE
  const cx = s / 2

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.beginPath(); ctx.ellipse(cx, s - 6, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill()

  if (type === 'harvester') {
    // tracks
    rrect(ctx, 5, s - 11, 28, 5, 2, '#2a2a2a')
    for (let i = 0; i < 6; i++) px(ctx, 7 + i * 5, s - 10, 3, 3, '#4a4a4a')
    // body
    rrect(ctx, 6, s - 20, 26, 9, 2, col.dark)
    rrect(ctx, 6, s - 20, 26, 2, col.primary)
    px(ctx, 7, s - 19, 24, 1, col.light)
    // cabin
    rrect(ctx, 18, s - 26, 12, 7, 1, col.primary)
    px(ctx, 18, s - 26, 12, 1, col.light)
    // window
    rrect(ctx, 21, s - 24, 7, 4, 1, '#7ac0ff')
    px(ctx, 21, s - 24, 7, 1, '#a8d8ff')
    // scoop
    rrect(ctx, 2, s - 17, 5, 6, 1, '#5a5a5a')
    px(ctx, 1, s - 16, 2, 4, '#3a3a3a')
    px(ctx, 2, s - 13, 5, 1, '#6a6a6a')
    // spice load
    rrect(ctx, 10, s - 16, 6, 2, 1, '#e85d2f')
    px(ctx, 10, s - 16, 6, 1, '#ff9060')
    // exhaust
    px(ctx, 30, s - 25, 2, 2, '#4a4a4a')
    px(ctx, 31, s - 27, 1, 2, 'rgba(150,150,150,0.6)')
  } else if (type === 'soldier') {
    // legs
    px(ctx, cx - 3, s - 10, 2, 4, col.dark)
    px(ctx, cx + 1, s - 10, 2, 4, col.dark)
    px(ctx, cx - 3, s - 6, 2, 1, '#1a1a1a')
    px(ctx, cx + 1, s - 6, 2, 1, '#1a1a1a')
    // body
    rrect(ctx, cx - 3, s - 18, 6, 8, 1, col.primary)
    px(ctx, cx - 3, s - 18, 6, 1, col.light)
    px(ctx, cx - 3, s - 13, 6, 1, col.trim)
    // belt
    px(ctx, cx - 3, s - 12, 6, 1, col.dark)
    // head
    rrect(ctx, cx - 2, s - 22, 4, 4, 1, '#d4a878')
    px(ctx, cx - 2, s - 22, 4, 1, '#b88860')
    // helmet
    rrect(ctx, cx - 3, s - 23, 6, 2, 1, col.dark)
    px(ctx, cx - 3, s - 23, 6, 1, col.primary)
    // rifle
    px(ctx, cx + 3, s - 16, 7, 1, '#2a2a2a')
    px(ctx, cx + 9, s - 17, 1, 2, '#2a2a2a')
    px(ctx, cx + 2, s - 15, 1, 2, '#4a4a4a')
    // backpack
    px(ctx, cx - 5, s - 17, 2, 4, col.dark)
  } else if (type === 'tank') {
    // tracks
    rrect(ctx, 4, s - 12, 30, 6, 2, '#2a2a2a')
    for (let i = 0; i < 6; i++) px(ctx, 5 + i * 5, s - 11, 3, 4, '#4a4a4a')
    // body
    rrect(ctx, 5, s - 22, 28, 10, 2, col.dark)
    rrect(ctx, 5, s - 22, 28, 2, col.primary)
    px(ctx, 6, s - 21, 26, 1, col.light)
    // turret
    rrect(ctx, cx - 6, s - 30, 14, 9, 2, col.primary)
    px(ctx, cx - 6, s - 30, 14, 1, col.light)
    px(ctx, cx - 6, s - 22, 14, 1, col.dark)
    // cannon
    px(ctx, cx + 6, s - 27, 10, 2, '#2a2a2a')
    px(ctx, cx + 15, s - 28, 2, 1, '#1a1a1a')
    // muzzle brake
    px(ctx, cx + 14, s - 28, 3, 4, '#3a3a3a')
    // hatch
    rrect(ctx, cx - 2, s - 29, 4, 2, 1, col.flag)
    // details
    px(ctx, 7, s - 14, 3, 2, col.trim)
    px(ctx, s - 10, s - 14, 3, 2, col.trim)
  }

  unitCache.set(key, c)
  return c
}

export function drawUnit(ctx: CanvasRenderingContext2D, type: UnitType, faction: Faction, px_: number, py_: number, bob = 0) {
  const img = renderUnit(type, faction)
  // bob: slight vertical offset for motion feel
  ctx.drawImage(img, px_ - TILE_SIZE / 2, py_ - TILE_SIZE / 2 + bob)
}

// ---------- Worm rendering (detailed) ----------
let wormCache: HTMLCanvasElement | null = null
function renderWorm(): HTMLCanvasElement {
  if (wormCache) return wormCache
  const c = document.createElement('canvas')
  c.width = TILE_SIZE; c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  const s = TILE_SIZE
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.beginPath(); ctx.ellipse(s/2, s - 4, 13, 4, 0, 0, Math.PI*2); ctx.fill()
  // body (segmented)
  ctx.fillStyle = '#8b4513'
  ctx.beginPath(); ctx.ellipse(s/2, s/2 + 2, 14, 8, 0, 0, Math.PI*2); ctx.fill()
  // body segments (rings)
  ctx.fillStyle = '#6b3010'
  for (let i = -3; i <= 3; i++) {
    px(ctx, s/2 + i * 4 - 1, s/2 - 4, 2, 12, '#6b3010')
  }
  // body highlight
  ctx.fillStyle = '#a85820'
  px(ctx, s/2 - 8, s/2 - 4, 16, 1, '#a85820')
  px(ctx, s/2 - 6, s/2 - 5, 12, 1, '#c06830')
  // mouth opening
  rrect(ctx, s/2 - 6, s/2 - 1, 12, 5, 1, '#3a1010')
  // teeth
  ctx.fillStyle = '#fff'
  for (let i = 0; i < 6; i++) {
    px(ctx, s/2 - 5 + i * 2, s/2 - 1, 1, 2, '#fff')
    px(ctx, s/2 - 5 + i * 2, s/2 + 2, 1, 2, '#fff')
  }
  // inner glow
  ctx.fillStyle = 'rgba(232,93,47,0.4)'
  ctx.fillRect(s/2 - 5, s/2, 10, 2)
  wormCache = c
  return c
}

export function drawWorm(ctx: CanvasRenderingContext2D, px_: number, py_: number, angle = 0) {
  const img = renderWorm()
  ctx.save()
  ctx.translate(px_, py_)
  ctx.rotate(angle)
  ctx.drawImage(img, -TILE_SIZE / 2, -TILE_SIZE / 2)
  ctx.restore()
}

// ---------- Health bar ----------
export function drawHealthBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, ratio: number) {
  const h = 4
  const bx = x - w / 2
  ctx.fillStyle = 'rgba(0,0,0,0.7)'
  rrect(ctx, bx - 1, y - 1, w + 2, h + 2, 1, 'rgba(0,0,0,0.7)')
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(bx, y, w, h)
  const fillW = Math.max(0, Math.min(w, w * ratio))
  ctx.fillStyle = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#eab308' : '#ef4444'
  ctx.fillRect(bx, y, fillW, h)
  px(ctx, bx, y, fillW, 1, 'rgba(255,255,255,0.3)')
}

// ---------- Selection ring ----------
export function drawSelectionRing(ctx: CanvasRenderingContext2D, px_: number, py_: number, color = '#4ade80') {
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(px_, py_ + 5, TILE_SIZE / 2 - 3, (TILE_SIZE / 2 - 6), 0, 0, Math.PI * 2)
  ctx.stroke()
  // corner ticks
  ctx.lineWidth = 1.5
  const r = TILE_SIZE / 2 - 2
  ctx.beginPath()
  ctx.moveTo(px_ - r, py_ - r + 3); ctx.lineTo(px_ - r, py_ - r); ctx.lineTo(px_ - r + 3, py_ - r)
  ctx.moveTo(px_ + r, py_ - r + 3); ctx.lineTo(px_ + r, py_ - r); ctx.lineTo(px_ + r - 3, py_ - r)
  ctx.moveTo(px_ - r, py_ + r - 3); ctx.lineTo(px_ - r, py_ + r); ctx.lineTo(px_ - r + 3, py_ + r)
  ctx.moveTo(px_ + r, py_ + r - 3); ctx.lineTo(px_ + r, py_ + r); ctx.lineTo(px_ + r - 3, py_ + r)
  ctx.stroke()
}

// ---------- Move target marker ----------
export function drawMoveMarker(ctx: CanvasRenderingContext2D, gx: number, gy: number, color = '#4ade80') {
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([4, 3])
  ctx.strokeRect(gx * TILE_SIZE + 3, gy * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6)
  ctx.setLineDash([])
  // center dot
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(gx * TILE_SIZE + TILE_SIZE/2, gy * TILE_SIZE + TILE_SIZE/2, 2, 0, Math.PI*2); ctx.fill()
}

// ---------- Editor palette icons ----------
export function getTilePreview(tileId: number, size = 40): string {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  const scale = size / TILE_SIZE
  ctx.scale(scale, scale)
  // render seamless tile (preview at world 0,0)
  drawSeamlessTile(ctx, tileId, 0, 0, 0)
  return c.toDataURL()
}

export function getBuildingPreview(type: BuildingType, faction: Faction, size = 40): string {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const ctx = c.getContext('2d')!
  const scale = size / TILE_SIZE
  ctx.scale(scale, scale)
  const img = renderBuilding(type, faction)
  ctx.drawImage(img, 0, 0)
  return c.toDataURL()
}

export function getUnitPreview(type: UnitType, faction: Faction, size = 40): string {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const ctx = c.getContext('2d')!
  const scale = size / TILE_SIZE
  ctx.scale(scale, scale)
  const img = renderUnit(type, faction)
  ctx.drawImage(img, 0, 0)
  return c.toDataURL()
}
