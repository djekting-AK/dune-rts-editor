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
  // uniform spice field overlay — clear orange tint, not scattered dots
  ctx.fillStyle = rich ? 'rgba(200,50,20,0.4)' : 'rgba(232,93,47,0.3)'
  ctx.fillRect(0, 0, s, s)
  // a few crystal clusters (deterministic) — bright spots
  const rng = mulberry((gx * 3333) ^ (gy * 7777))
  const count = rich ? 3 : 2
  for (let i = 0; i < count; i++) {
    const cx = 6 + rng() * (s - 12), cy = 6 + rng() * (s - 12)
    const rad = 5 + rng() * 3
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    glow.addColorStop(0, rich ? 'rgba(255,120,60,0.8)' : 'rgba(255,150,80,0.65)')
    glow.addColorStop(1, 'rgba(232,93,47,0)')
    ctx.fillStyle = glow
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
  }
  // sparkle highlights
  ctx.fillStyle = rich ? '#ffb070' : '#ffd090'
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(4 + rng() * (s - 8), 4 + rng() * (s - 8), 1, 1)
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
export type BuildingType = 'palace' | 'barracks' | 'factory' | 'turret' | 'refinery' | 'generator'

const buildingCache = new Map<string, HTMLCanvasElement>()

function renderBuilding(type: BuildingType, faction: Faction, w: number, h: number): HTMLCanvasElement {
  const key = `${type}_${faction}_${w}x${h}`
  let c = buildingCache.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = w * TILE_SIZE; c.height = h * TILE_SIZE
  const ctx = c.getContext('2d')!
  const col = FACTION_COLORS[faction]
  const W = w * TILE_SIZE
  const H = h * TILE_SIZE
  const rng = mulberry((type.charCodeAt(0) * 7919) ^ (faction.charCodeAt(0) * 4099) ^ (w * 131) ^ (h * 257))

  // ground shadow (spans building footprint)
  ctx.fillStyle = 'rgba(0,0,0,0.38)'
  ctx.beginPath()
  ctx.ellipse(W / 2, H - 3, W / 2 - 4, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  // soft inner shadow on ground
  ctx.fillStyle = 'rgba(0,0,0,0.2)'
  ctx.beginPath()
  ctx.ellipse(W / 2, H - 2, W / 2 - 8, 2, 0, 0, Math.PI * 2)
  ctx.fill()

  // ============================================================
  //  FUTURISTIC / SCI-FI BUILDINGS (Dune 1984/2021 aesthetic)
  //  Brutalist concrete + metallic panels + glowing energy tech
  //  Palette: metallic grays primary; faction colors as accents;
  //           cyan = energy; orange = spice; amber = warning/lights
  // ============================================================

  if (type === 'palace') {
    // ===== PALACE (2x2 = 80x80): Brutalist command fortress =====
    // Wide stepped concrete base + central command tower + comm antenna
    // + glowing slit windows + energy shield emitters + blast door

    // --- Lower wide base (stepped concrete platform) ---
    const baseTop = H * 0.46
    const baseBottom = H - 4
    rrect(ctx, 2, baseTop, W - 4, baseBottom - baseTop, 2, '#1a1a1a')
    const baseGrad = ctx.createLinearGradient(0, baseTop, 0, baseBottom)
    baseGrad.addColorStop(0, '#6a6a6a')
    baseGrad.addColorStop(0.4, '#4a4a4a')
    baseGrad.addColorStop(1, '#2a2a2a')
    rrect(ctx, 3, baseTop + 1, W - 6, baseBottom - baseTop - 2, 2, baseGrad as any)
    // top edge highlight (sun-baked concrete rim)
    px(ctx, 3, baseTop + 1, W - 6, 1, '#8a8a8a')
    // horizontal concrete seam lines
    px(ctx, 3, baseTop + 10, W - 6, 1, '#1a1a1a')
    px(ctx, 3, baseTop + 11, W - 6, 1, '#5a5a5a')
    px(ctx, 3, baseTop + 22, W - 6, 1, '#1a1a1a')
    px(ctx, 3, baseTop + 23, W - 6, 1, '#5a5a5a')
    // beveled corner cuts (angular brutalist)
    px(ctx, 2, baseTop, 3, 1, '#1a1a1a')
    px(ctx, W - 5, baseTop, 3, 1, '#1a1a1a')

    // --- Central command tower (tall, angular, brutalist) ---
    const tw = W * 0.34
    const th = H * 0.62
    const tx = W / 2 - tw / 2
    const ty = H - th - 3
    rrect(ctx, tx - 2, ty - 2, tw + 4, th + 2, 1, '#1a1a1a')
    const towerGrad = ctx.createLinearGradient(tx, 0, tx + tw, 0)
    towerGrad.addColorStop(0, '#3a3a3a')
    towerGrad.addColorStop(0.2, '#6a6a6a')
    towerGrad.addColorStop(0.5, '#7a7a7a')
    towerGrad.addColorStop(0.8, '#5a5a5a')
    towerGrad.addColorStop(1, '#2a2a2a')
    rrect(ctx, tx, ty, tw, th, 1, towerGrad as any)
    px(ctx, tx, ty, tw, 1, '#9a9a9a')

    // vertical metal panel seams (4 panels)
    for (let i = 1; i < 4; i++) {
      const sx = tx + (tw * i / 4)
      px(ctx, sx, ty + 1, 1, th - 1, '#1a1a1a')
      px(ctx, sx + 1, ty + 1, 1, th - 1, '#6a6a6a')
    }
    // horizontal floor bands (reinforced levels)
    for (let i = 1; i < 4; i++) {
      const by = ty + (th * i / 4)
      px(ctx, tx, by, tw, 1, '#1a1a1a')
      px(ctx, tx, by + 1, tw, 1, '#6a6a6a')
    }

    // glowing cyan horizontal slit windows (3 rows on tower)
    for (let row = 0; row < 3; row++) {
      const wy = ty + th * 0.15 + row * (th * 0.22)
      const ww = tw * 0.28
      rrect(ctx, tx + 4, wy, ww, 3, 1, '#0080a0')
      rrect(ctx, tx + 4, wy + 1, ww, 1, 1, '#00d0ff')
      px(ctx, tx + 4, wy, ww, 1, '#80e8ff')
      rrect(ctx, tx + tw - ww - 4, wy, ww, 3, 1, '#0080a0')
      rrect(ctx, tx + tw - ww - 4, wy + 1, ww, 1, 1, '#00d0ff')
      px(ctx, tx + tw - ww - 4, wy, ww, 1, '#80e8ff')
    }

    // faction accent stripe (subtle, on tower)
    px(ctx, tx, ty + th * 0.78, tw, 2, col.primary)
    px(ctx, tx, ty + th * 0.78 + 2, tw, 1, col.trim)

    // --- Tower top (flat roof pad) ---
    rrect(ctx, tx - 4, ty - 6, tw + 8, 8, 1, '#1a1a1a')
    rrect(ctx, tx - 3, ty - 5, tw + 6, 6, 1, '#5a5a5a')
    px(ctx, tx - 3, ty - 5, tw + 6, 1, '#8a8a8a')
    // corner comm pads
    for (const cx2 of [tx - 2, tx + tw - 2]) {
      rrect(ctx, cx2, ty - 10, 4, 5, 1, '#3a3a3a')
      px(ctx, cx2, ty - 10, 4, 1, '#6a6a6a')
    }

    // --- Central comm antenna with glowing tip ---
    const antX = W / 2
    const antTopY = H * 0.05
    px(ctx, antX, antTopY, 1, ty - 4 - antTopY, '#6a6a6a')
    px(ctx, antX - 3, antTopY + 6, 7, 1, '#5a5a5a')
    px(ctx, antX - 2, antTopY + 12, 5, 1, '#5a5a5a')
    const tipGrad = ctx.createRadialGradient(antX, antTopY, 0, antX, antTopY, 6)
    tipGrad.addColorStop(0, '#c0f4ff')
    tipGrad.addColorStop(0.3, '#00d0ff')
    tipGrad.addColorStop(1, 'rgba(0,208,255,0)')
    ctx.fillStyle = tipGrad
    ctx.fillRect(antX - 6, antTopY - 6, 12, 12)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(antX, antTopY, 1.5, 0, Math.PI * 2); ctx.fill()

    // --- Side comm dishes (smaller antennas on roof pad corners) ---
    for (const dx of [tx - 3, tx + tw - 2]) {
      px(ctx, dx + 1, ty - 18, 1, 12, '#5a5a5a')
      ctx.strokeStyle = '#7a7a7a'; ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(dx - 1, ty - 16)
      ctx.lineTo(dx + 3, ty - 18)
      ctx.stroke()
      ctx.fillStyle = '#00d0ff'
      ctx.beginPath(); ctx.arc(dx + 1, ty - 18, 0.8, 0, Math.PI * 2); ctx.fill()
    }

    // --- Energy shield emitters (glowing corner nodes on base) ---
    for (const ex of [6, W - 7]) {
      for (const ey of [baseTop + 4, baseTop + 28]) {
        const sg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 4)
        sg.addColorStop(0, '#c0f4ff')
        sg.addColorStop(0.4, '#00d0ff')
        sg.addColorStop(1, 'rgba(0,208,255,0)')
        ctx.fillStyle = sg
        ctx.fillRect(ex - 4, ey - 4, 8, 8)
        ctx.fillStyle = '#3a3a3a'
        ctx.beginPath(); ctx.arc(ex, ey, 1.5, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath(); ctx.arc(ex, ey, 0.7, 0, Math.PI * 2); ctx.fill()
      }
    }

    // --- Faction banner (vertical hanging flag from tower) ---
    px(ctx, tx + tw - 6, ty + 2, 1, 14, '#1a1a1a')
    rrect(ctx, tx + tw - 5, ty + 2, 6, 12, 1, col.flag)
    px(ctx, tx + tw - 5, ty + 2, 6, 1, col.trim)
    ctx.fillStyle = col.trim
    ctx.beginPath(); ctx.arc(tx + tw - 2, ty + 8, 1.2, 0, Math.PI * 2); ctx.fill()

    // --- Main blast door (rectangular, with hazard stripes) ---
    const doorW = W * 0.22
    const doorH = H * 0.18
    const doorX = W / 2 - doorW / 2
    const doorY = H - doorH - 3
    rrect(ctx, doorX - 2, doorY - 2, doorW + 4, doorH + 4, 2, '#1a1a1a')
    const doorGrad = ctx.createLinearGradient(0, doorY, 0, doorY + doorH)
    doorGrad.addColorStop(0, '#5a5a5a')
    doorGrad.addColorStop(0.5, '#3a3a3a')
    doorGrad.addColorStop(1, '#1a1a1a')
    rrect(ctx, doorX, doorY, doorW, doorH, 1, doorGrad as any)
    px(ctx, W / 2, doorY, 1, doorH, '#0a0a0a')
    for (let i = 0; i < 6; i++) {
      px(ctx, doorX + i * (doorW / 6), doorY + 2, doorW / 6, 2, i % 2 === 0 ? '#ffaa30' : '#1a1a1a')
    }
    for (let i = 1; i < 3; i++) {
      px(ctx, doorX + 1, doorY + (doorH * i / 3), doorW - 2, 1, '#1a1a1a')
    }
    px(ctx, doorX + 3, doorY + doorH - 5, 2, 2, col.flag)
    px(ctx, doorX + doorW - 5, doorY + doorH - 5, 2, 2, col.flag)

    // --- Side wall vents (vertical louvered slits) ---
    for (const side of [0, 1]) {
      const vx = side === 0 ? 5 : W - 11
      for (let i = 0; i < 4; i++) {
        const vy = baseTop + 14 + i * 6
        px(ctx, vx, vy, 6, 2, '#1a1a1a')
        px(ctx, vx, vy, 6, 1, '#3a3a3a')
      }
    }

    // --- Rooftop solar array (flat dark panels on base top edge) ---
    for (let i = 0; i < 3; i++) {
      const sx = 8 + i * 22
      rrect(ctx, sx, baseTop - 4, 18, 4, 1, '#1a1a1a')
      rrect(ctx, sx + 1, baseTop - 3, 16, 2, 1, '#1a2a4a')
      px(ctx, sx + 1, baseTop - 3, 16, 1, '#3a5a8a')
      px(ctx, sx + 6, baseTop - 3, 1, 2, '#0a1a2a')
      px(ctx, sx + 12, baseTop - 3, 1, 2, '#0a1a2a')
    }

    // --- Ground-level exhaust vents (small glowing amber lights) ---
    for (let i = 0; i < 4; i++) {
      const lx = 14 + i * (W - 28) / 3
      ctx.fillStyle = '#ffaa30'
      ctx.beginPath(); ctx.arc(lx, H - 6, 1, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#ffe080'
      ctx.beginPath(); ctx.arc(lx, H - 6, 0.4, 0, Math.PI * 2); ctx.fill()
    }
  } else if (type === 'barracks') {
    // ===== BARRACKS (2x2 = 80x80): Angular prefab military structure =====
    // Flat roof, vertical slit windows (glowing), blast door, coolant pipes, antenna array

    // --- Main structure (angular prefab box) ---
    const wallTop = H * 0.36
    const wallBottom = H - 4
    rrect(ctx, 6, wallTop, W - 12, wallBottom - wallTop, 2, '#1a1a1a')
    const wallGrad = ctx.createLinearGradient(0, wallTop, 0, wallBottom)
    wallGrad.addColorStop(0, '#7a7a7a')
    wallGrad.addColorStop(0.4, '#5a5a5a')
    wallGrad.addColorStop(1, '#2a2a2a')
    rrect(ctx, 8, wallTop + 1, W - 16, wallBottom - wallTop - 2, 1, wallGrad as any)
    // top edge highlight (metal rim)
    px(ctx, 8, wallTop + 1, W - 16, 1, '#9a9a9a')
    // horizontal panel seam line
    px(ctx, 8, wallTop + (wallBottom - wallTop) * 0.5, W - 16, 1, '#1a1a1a')
    px(ctx, 8, wallTop + (wallBottom - wallTop) * 0.5 + 1, W - 16, 1, '#5a5a5a')

    // --- Flat roof pad with beveled edges ---
    rrect(ctx, 4, wallTop - 4, W - 8, 6, 1, '#1a1a1a')
    rrect(ctx, 5, wallTop - 3, W - 10, 4, 1, '#5a5a5a')
    px(ctx, 5, wallTop - 3, W - 10, 1, '#8a8a8a')
    // beveled corner cuts (angular)
    px(ctx, 4, wallTop - 4, 3, 1, '#1a1a1a')
    px(ctx, W - 7, wallTop - 4, 3, 1, '#1a1a1a')
    // rooftop equipment housing
    rrect(ctx, W * 0.3, wallTop - 8, W * 0.4, 5, 1, '#3a3a3a')
    px(ctx, W * 0.3, wallTop - 8, W * 0.4, 1, '#6a6a6a')
    // rooftop vent slits (glowing amber)
    for (let i = 0; i < 4; i++) {
      const vx = W * 0.3 + 3 + i * (W * 0.4 - 6) / 3
      px(ctx, vx, wallTop - 7, 2, 3, '#1a1a1a')
      px(ctx, vx, wallTop - 6, 2, 1, '#ffaa30')
    }

    // --- Antenna array (multiple antennas on roof) ---
    // main antenna (tall, with red beacon)
    const antX = W * 0.25
    const antTopY = H * 0.06
    px(ctx, antX, antTopY, 1, wallTop - 4 - antTopY, '#5a5a5a')
    px(ctx, antX - 2, antTopY + 6, 5, 1, '#5a5a5a')
    px(ctx, antX - 1, antTopY + 12, 3, 1, '#5a5a5a')
    const antBeaconGrad = ctx.createRadialGradient(antX, antTopY, 0, antX, antTopY, 3)
    antBeaconGrad.addColorStop(0, '#ffa0a0')
    antBeaconGrad.addColorStop(0.5, '#ff4040')
    antBeaconGrad.addColorStop(1, 'rgba(255,64,64,0)')
    ctx.fillStyle = antBeaconGrad
    ctx.fillRect(antX - 3, antTopY - 3, 6, 6)
    ctx.fillStyle = '#ff4040'
    ctx.beginPath(); ctx.arc(antX, antTopY, 1.2, 0, Math.PI * 2); ctx.fill()

    // secondary antenna (shorter, cyan tip)
    const ant2X = W * 0.75
    const ant2TopY = H * 0.14
    px(ctx, ant2X, ant2TopY, 1, wallTop - 4 - ant2TopY, '#5a5a5a')
    px(ctx, ant2X - 1, ant2TopY + 4, 3, 1, '#5a5a5a')
    const ant2Grad = ctx.createRadialGradient(ant2X, ant2TopY, 0, ant2X, ant2TopY, 3)
    ant2Grad.addColorStop(0, '#c0f4ff')
    ant2Grad.addColorStop(0.5, '#00d0ff')
    ant2Grad.addColorStop(1, 'rgba(0,208,255,0)')
    ctx.fillStyle = ant2Grad
    ctx.fillRect(ant2X - 3, ant2TopY - 3, 6, 6)
    ctx.fillStyle = '#00d0ff'
    ctx.beginPath(); ctx.arc(ant2X, ant2TopY, 1, 0, Math.PI * 2); ctx.fill()

    // communications dish (small angled line)
    const dishX = W / 2
    const dishTopY = H * 0.16
    px(ctx, dishX, dishTopY, 1, wallTop - 4 - dishTopY, '#5a5a5a')
    ctx.strokeStyle = '#7a7a7a'; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(dishX - 3, dishTopY + 2)
    ctx.lineTo(dishX + 3, dishTopY)
    ctx.stroke()
    ctx.fillStyle = '#00d0ff'
    ctx.beginPath(); ctx.arc(dishX, dishTopY + 1, 0.8, 0, Math.PI * 2); ctx.fill()

    // --- External coolant pipes (horizontal pipes along wall) ---
    const pipeY = wallTop + (wallBottom - wallTop) * 0.5 + 8
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(10, pipeY)
    ctx.lineTo(28, pipeY)
    ctx.lineTo(28, pipeY - 4)
    ctx.lineTo(40, pipeY - 4)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(W - 40, pipeY - 4)
    ctx.lineTo(W - 28, pipeY - 4)
    ctx.lineTo(W - 28, pipeY)
    ctx.lineTo(W - 10, pipeY)
    ctx.stroke()
    // pipe highlights
    ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(10, pipeY - 1); ctx.lineTo(28, pipeY - 1)
    ctx.moveTo(W - 28, pipeY - 1); ctx.lineTo(W - 10, pipeY - 1)
    ctx.stroke()
    // pipe joints (flanges)
    for (const jx of [28, W - 28]) {
      rrect(ctx, jx - 2, pipeY - 5, 4, 8, 1, '#5a5a5a')
      px(ctx, jx - 2, pipeY - 5, 4, 1, '#8a8a8a')
    }
    // coolant vent glow (cyan dots at pipe ends)
    for (const vx of [40, W - 40]) {
      const cg = ctx.createRadialGradient(vx, pipeY - 4, 0, vx, pipeY - 4, 3)
      cg.addColorStop(0, '#c0f4ff')
      cg.addColorStop(0.5, '#00d0ff')
      cg.addColorStop(1, 'rgba(0,208,255,0)')
      ctx.fillStyle = cg
      ctx.fillRect(vx - 3, pipeY - 7, 6, 6)
      ctx.fillStyle = '#00d0ff'
      ctx.beginPath(); ctx.arc(vx, pipeY - 4, 0.8, 0, Math.PI * 2); ctx.fill()
    }

    // --- Vertical slit windows (glowing cyan, 2 rows x 2 columns on sides) ---
    const winY1 = wallTop + 14
    const winY2 = wallTop + 26
    for (const wy of [winY1, winY2]) {
      for (const wx of [12, W - 16]) {
        rrect(ctx, wx, wy, 4, 6, 1, '#0080a0')
        rrect(ctx, wx, wy + 1, 4, 4, 1, '#00d0ff')
        px(ctx, wx, wy, 4, 1, '#80e8ff')
        // window frame
        px(ctx, wx - 1, wy - 1, 6, 1, '#1a1a1a')
        px(ctx, wx - 1, wy + 6, 6, 1, '#1a1a1a')
      }
    }

    // --- Central blast door ---
    const doorW = W * 0.22
    const doorH = H * 0.26
    const doorX = W / 2 - doorW / 2
    const doorY = H - doorH - 3
    rrect(ctx, doorX - 2, doorY - 2, doorW + 4, doorH + 4, 2, '#1a1a1a')
    const doorGrad = ctx.createLinearGradient(0, doorY, 0, doorY + doorH)
    doorGrad.addColorStop(0, '#5a5a5a')
    doorGrad.addColorStop(0.6, '#3a3a3a')
    doorGrad.addColorStop(1, '#1a1a1a')
    rrect(ctx, doorX, doorY, doorW, doorH, 1, doorGrad as any)
    // door seam (vertical)
    px(ctx, W / 2, doorY, 1, doorH, '#0a0a0a')
    // door panel lines (horizontal)
    for (let i = 1; i < 4; i++) {
      px(ctx, doorX + 1, doorY + (doorH * i / 4), doorW - 2, 1, '#1a1a1a')
      px(ctx, doorX + 1, doorY + (doorH * i / 4) + 1, doorW - 2, 1, '#4a4a4a')
    }
    // hazard stripes at top
    const dhazN = 4
    for (let i = 0; i < dhazN; i++) {
      px(ctx, doorX + 1 + i * (doorW - 2) / dhazN, doorY + 2, (doorW - 2) / dhazN, 2, i % 2 === 0 ? '#ffaa30' : '#1a1a1a')
    }
    // door control panel (faction indicator)
    rrect(ctx, W / 2 - 3, doorY + doorH - 8, 6, 4, 1, '#1a1a1a')
    px(ctx, W / 2 - 2, doorY + doorH - 7, 4, 1, col.flag)
    px(ctx, W / 2 - 2, doorY + doorH - 5, 2, 1, col.trim)

    // --- Faction stripe (subtle accent along wall) ---
    px(ctx, 8, wallTop + 6, W - 16, 1, col.primary)
    px(ctx, 8, wallTop + 7, W - 16, 1, col.dark)

    // --- Side external reinforcement pillars (angular buttresses) ---
    for (const side of [0, 1]) {
      const bx = side === 0 ? 6 : W - 11
      rrect(ctx, bx, wallTop + 2, 5, wallBottom - wallTop - 4, 1, '#2a2a2a')
      const bGrad = ctx.createLinearGradient(bx, 0, bx + 5, 0)
      bGrad.addColorStop(0, '#5a5a5a')
      bGrad.addColorStop(0.5, '#6a6a6a')
      bGrad.addColorStop(1, '#2a2a2a')
      rrect(ctx, bx + 1, wallTop + 3, 3, wallBottom - wallTop - 6, 1, bGrad as any)
      // pillar rivets
      for (let i = 0; i < 3; i++) {
        const ry = wallTop + 8 + i * 12
        px(ctx, bx + 1, ry, 3, 1, '#1a1a1a')
      }
    }

    // --- Hazard line on ground (front of door) ---
    for (let i = 0; i < 10; i++) {
      px(ctx, doorX - 4 + i * 4, H - 4, 2, 1, i % 2 === 0 ? '#ffaa30' : '#1a1a1a')
    }
  } else if (type === 'factory') {
    // ===== FACTORY (3x2 = 120x80): Wide industrial facility =====
    // Flat sawtooth glass roof + 2 chimneys with heat vents + cargo bay door + pipes

    // --- Main structure (wide metallic housing) ---
    const wallTop = H * 0.44
    const wallBottom = H - 4
    rrect(ctx, 4, wallTop, W - 8, wallBottom - wallTop, 2, '#1a1a1a')
    const wallGrad = ctx.createLinearGradient(0, wallTop, 0, wallBottom)
    wallGrad.addColorStop(0, '#6a6a6a')
    wallGrad.addColorStop(0.4, '#4a4a4a')
    wallGrad.addColorStop(1, '#2a2a2a')
    rrect(ctx, 6, wallTop + 1, W - 12, wallBottom - wallTop - 2, 1, wallGrad as any)
    px(ctx, 6, wallTop + 1, W - 12, 1, '#8a8a8a')
    // horizontal accent bands (panel divisions)
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.4, W - 12, 1, '#1a1a1a')
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.4 + 1, W - 12, 1, '#5a5a5a')
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.7, W - 12, 1, '#1a1a1a')
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.7 + 1, W - 12, 1, '#5a5a5a')

    // --- Flat sawtooth roof (angular glass panels, NOT pitched) ---
    const numSaw = 6
    const sawW = (W - 12) / numSaw
    const sawBaseY = wallTop + 2
    const sawTopY = H * 0.28
    for (let i = 0; i < numSaw; i++) {
      const bx = 6 + i * sawW
      // glass face (angled, dark blue-gray glass with cyan tint)
      ctx.fillStyle = '#1a2a3a'
      ctx.beginPath()
      ctx.moveTo(bx, sawBaseY)
      ctx.lineTo(bx + sawW * 0.6, sawTopY)
      ctx.lineTo(bx + sawW, sawBaseY)
      ctx.closePath()
      ctx.fill()
      // glass inner highlight (cyan tint gradient)
      const glassGrad = ctx.createLinearGradient(bx, sawBaseY, bx, sawTopY)
      glassGrad.addColorStop(0, '#1a2a3a')
      glassGrad.addColorStop(0.7, '#3a5a7a')
      glassGrad.addColorStop(1, '#5a8aaa')
      ctx.fillStyle = glassGrad
      ctx.beginPath()
      ctx.moveTo(bx + 1, sawBaseY - 1)
      ctx.lineTo(bx + sawW * 0.6 - 1, sawTopY + 1)
      ctx.lineTo(bx + sawW - 1, sawBaseY - 1)
      ctx.closePath()
      ctx.fill()
      // glazing bars (vertical lines on glass)
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1
      for (let g = 1; g < 3; g++) {
        const gx2 = bx + (sawW * 0.6) * (g / 3)
        ctx.beginPath()
        ctx.moveTo(gx2, sawBaseY)
        ctx.lineTo(gx2 + sawW * 0.6 * 0.2, sawTopY + (sawBaseY - sawTopY) * (1 - g / 3))
        ctx.stroke()
      }
      // shadow face (right side — vertical drop)
      ctx.fillStyle = '#2a2a2a'
      ctx.beginPath()
      ctx.moveTo(bx + sawW * 0.6, sawTopY)
      ctx.lineTo(bx + sawW, sawTopY + (sawBaseY - sawTopY) * 0.3)
      ctx.lineTo(bx + sawW, sawBaseY)
      ctx.closePath()
      ctx.fill()
      // roof edge highlight
      px(ctx, bx, sawBaseY, sawW, 1, '#1a1a1a')
      // small cyan glow strip at peak (factory interior lights)
      px(ctx, bx + sawW * 0.6 - 1, sawTopY, 2, 1, '#00d0ff')
    }
    // sawtooth ridge rail (dark)
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < numSaw; i++) {
      const bx = 6 + i * sawW
      if (i === 0) ctx.moveTo(bx, sawBaseY)
      ctx.lineTo(bx + sawW * 0.6, sawTopY)
      ctx.lineTo(bx + sawW, sawBaseY)
    }
    ctx.stroke()

    // --- 2 industrial chimneys (metallic cylinders with heat vents) ---
    const chimneys = [
      { x: W - 38, h: H * 0.7 },
      { x: W - 22, h: H * 0.8 },
    ]
    for (const ch of chimneys) {
      const cyTop = H - ch.h - 4
      // chimney outer
      rrect(ctx, ch.x, cyTop, 8, ch.h, 1, '#1a1a1a')
      // chimney metallic gradient
      const chGrad = ctx.createLinearGradient(ch.x, 0, ch.x + 8, 0)
      chGrad.addColorStop(0, '#2a2a2a')
      chGrad.addColorStop(0.3, '#5a5a5a')
      chGrad.addColorStop(0.6, '#4a4a4a')
      chGrad.addColorStop(1, '#1a1a1a')
      rrect(ctx, ch.x + 1, cyTop, 6, ch.h, 1, chGrad as any)
      // chimney top lip (flared)
      rrect(ctx, ch.x - 2, cyTop - 3, 12, 4, 1, '#1a1a1a')
      rrect(ctx, ch.x - 1, cyTop - 2, 10, 2, 1, '#4a4a4a')
      px(ctx, ch.x - 1, cyTop - 2, 10, 1, '#7a7a7a')
      // chimney bands (reinforcement rings)
      px(ctx, ch.x, cyTop + ch.h * 0.25, 8, 1, '#1a1a1a')
      px(ctx, ch.x, cyTop + ch.h * 0.25 + 1, 8, 1, '#4a4a4a')
      px(ctx, ch.x, cyTop + ch.h * 0.55, 8, 1, '#1a1a1a')
      px(ctx, ch.x, cyTop + ch.h * 0.55 + 1, 8, 1, '#4a4a4a')
      px(ctx, ch.x, cyTop + ch.h * 0.85, 8, 1, '#1a1a1a')
      // heat vent glow (amber/orange — hot exhaust at top)
      const ventGrad = ctx.createRadialGradient(ch.x + 4, cyTop - 4, 0, ch.x + 4, cyTop - 4, 6)
      ventGrad.addColorStop(0, '#ffe080')
      ventGrad.addColorStop(0.4, '#ff8030')
      ventGrad.addColorStop(1, 'rgba(255,128,48,0)')
      ctx.fillStyle = ventGrad
      ctx.fillRect(ch.x - 2, cyTop - 10, 14, 10)
      ctx.fillStyle = '#ffe080'
      ctx.beginPath(); ctx.arc(ch.x + 4, cyTop - 4, 0.8, 0, Math.PI * 2); ctx.fill()
      // chimney hot interior (orange Ring inside top)
      px(ctx, ch.x + 2, cyTop + 1, 4, 1, '#ff6020')
      px(ctx, ch.x + 3, cyTop + 1, 2, 1, '#ffa050')
    }

    // --- Large cargo bay door (left side, with hazard markings) ---
    const gdX = 12
    const gdW = W * 0.24
    const gdH = H * 0.32
    const gdY = H - gdH - 3
    rrect(ctx, gdX - 2, gdY - 2, gdW + 4, gdH + 4, 2, '#1a1a1a')
    const gdGrad = ctx.createLinearGradient(0, gdY, 0, gdY + gdH)
    gdGrad.addColorStop(0, '#4a4a4a')
    gdGrad.addColorStop(0.5, '#2a2a2a')
    gdGrad.addColorStop(1, '#1a1a1a')
    rrect(ctx, gdX, gdY, gdW, gdH, 1, gdGrad as any)
    // door panel lines (roll-up segments — horizontal)
    for (let i = 1; i < 6; i++) {
      px(ctx, gdX + 1, gdY + (gdH * i / 6), gdW - 2, 1, '#0a0a0a')
      px(ctx, gdX + 1, gdY + (gdH * i / 6) + 1, gdW - 2, 1, '#4a4a4a')
    }
    // door vertical seams (2 panels)
    for (let i = 1; i < 3; i++) {
      px(ctx, gdX + (gdW * i / 3), gdY, 1, gdH, '#0a0a0a')
    }
    // hazard stripes at bottom of door (yellow-black)
    for (let i = 0; i < 8; i++) {
      px(ctx, gdX + 1 + i * (gdW - 2) / 8, gdY + gdH - 5, (gdW - 2) / 8, 3, i % 2 === 0 ? '#ffd040' : '#1a1a1a')
    }
    // door warning label (faction indicator)
    rrect(ctx, gdX + gdW / 2 - 4, gdY + gdH / 2 - 3, 8, 6, 1, '#0a0a0a')
    px(ctx, gdX + gdW / 2 - 3, gdY + gdH / 2 - 2, 6, 1, col.flag)
    px(ctx, gdX + gdW / 2 - 3, gdY + gdH / 2, 4, 1, col.flag)
    px(ctx, gdX + gdW / 2 - 3, gdY + gdH / 2 + 2, 2, 1, col.flag)

    // --- Control room window (above door, glowing cyan) ---
    rrect(ctx, gdX + 4, gdY - 12, gdW - 8, 8, 1, '#1a1a1a')
    const winGrad = ctx.createLinearGradient(0, gdY - 12, 0, gdY - 4)
    winGrad.addColorStop(0, '#0080a0')
    winGrad.addColorStop(0.5, '#00d0ff')
    winGrad.addColorStop(1, '#0080a0')
    rrect(ctx, gdX + 5, gdY - 11, gdW - 10, 6, 1, winGrad as any)
    px(ctx, gdX + 5, gdY - 11, gdW - 10, 1, '#80e8ff')
    // window dividers
    for (let i = 1; i < 4; i++) {
      px(ctx, gdX + 5 + (gdW - 10) * i / 4, gdY - 11, 1, 6, '#1a1a1a')
    }

    // --- External pipes and conduit (right of door) ---
    const pipeY1 = H * 0.6
    const pipeY2 = H * 0.5
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(gdX + gdW + 6, pipeY1)
    ctx.lineTo(gdX + gdW + 24, pipeY1)
    ctx.lineTo(gdX + gdW + 24, pipeY2)
    ctx.lineTo(W - 52, pipeY2)
    ctx.stroke()
    // pipe highlight
    ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(gdX + gdW + 6, pipeY1 - 1)
    ctx.lineTo(gdX + gdW + 24, pipeY1 - 1)
    ctx.lineTo(gdX + gdW + 24, pipeY2 - 1)
    ctx.stroke()
    // second smaller conduit pipe
    ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(gdX + gdW + 6, pipeY1 + 5)
    ctx.lineTo(gdX + gdW + 30, pipeY1 + 5)
    ctx.stroke()
    // pipe joints (flanges)
    for (const jx of [gdX + gdW + 24, W - 56]) {
      rrect(ctx, jx - 2, pipeY2 - 3, 4, 6, 1, '#5a5a5a')
      px(ctx, jx - 2, pipeY2 - 3, 4, 1, '#8a8a8a')
    }
    // valve wheels along pipe
    for (const vx of [gdX + gdW + 14, W - 50]) {
      ctx.fillStyle = '#3a3a3a'
      ctx.beginPath(); ctx.arc(vx, pipeY1, 3.5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#5a5a5a'
      ctx.beginPath(); ctx.arc(vx, pipeY1, 2.5, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(vx, pipeY1)
        ctx.lineTo(vx + Math.cos(a) * 3.5, pipeY1 + Math.sin(a) * 3.5)
        ctx.stroke()
      }
      ctx.fillStyle = '#1a1a1a'
      ctx.beginPath(); ctx.arc(vx, pipeY1, 1, 0, Math.PI * 2); ctx.fill()
    }

    // --- Side multi-pane windows (industrial, glowing cyan) ---
    for (const wx of [W * 0.55, W * 0.7]) {
      rrect(ctx, wx, wallTop + 8, 12, 10, 1, '#1a1a1a')
      const swg = ctx.createLinearGradient(0, wallTop + 8, 0, wallTop + 18)
      swg.addColorStop(0, '#0080a0')
      swg.addColorStop(1, '#00d0ff')
      rrect(ctx, wx + 1, wallTop + 9, 10, 8, 1, swg as any)
      px(ctx, wx + 1, wallTop + 9, 10, 1, '#80e8ff')
      // window dividers
      px(ctx, wx + 5, wallTop + 9, 1, 8, '#1a1a1a')
      px(ctx, wx + 1, wallTop + 13, 10, 1, '#1a1a1a')
    }

    // --- Loading ramp / hazard zone on ground ---
    px(ctx, gdX - 4, H - 5, gdW + 8, 2, '#2a2a2a')
    for (let i = 0; i < 10; i++) {
      px(ctx, gdX - 2 + i * 4, H - 3, 2, 1, i % 2 === 0 ? '#ffd040' : '#1a1a1a')
    }
  } else if (type === 'turret') {
    // ===== TURRET (1x1 = 40x40): Energy cannon on rotating base =====
    const s = TILE_SIZE

    // --- Angular hexagonal base pad (reinforced) ---
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath()
    ctx.moveTo(s / 2 - 13, s - 8)
    ctx.lineTo(s / 2 - 9, s - 4)
    ctx.lineTo(s / 2 + 9, s - 4)
    ctx.lineTo(s / 2 + 13, s - 8)
    ctx.lineTo(s / 2 + 11, s - 12)
    ctx.lineTo(s / 2 - 11, s - 12)
    ctx.closePath()
    ctx.fill()
    const padGrad = ctx.createLinearGradient(0, s - 12, 0, s - 4)
    padGrad.addColorStop(0, '#6a6a6a')
    padGrad.addColorStop(1, '#2a2a2a')
    ctx.fillStyle = padGrad
    ctx.beginPath()
    ctx.moveTo(s / 2 - 12, s - 8)
    ctx.lineTo(s / 2 - 9, s - 5)
    ctx.lineTo(s / 2 + 9, s - 5)
    ctx.lineTo(s / 2 + 12, s - 8)
    ctx.lineTo(s / 2 + 10, s - 11)
    ctx.lineTo(s / 2 - 10, s - 11)
    ctx.closePath()
    ctx.fill()
    px(ctx, s / 2 - 10, s - 11, 20, 1, '#8a8a8a')
    // base rivets
    for (const rx of [s / 2 - 7, s / 2 + 7]) {
      ctx.fillStyle = '#1a1a1a'
      ctx.beginPath(); ctx.arc(rx, s - 7, 0.8, 0, Math.PI * 2); ctx.fill()
    }

    // --- Rotating turret base (angular box) ---
    rrect(ctx, s / 2 - 9, s - 22, 18, 11, 1, '#1a1a1a')
    const tGrad = ctx.createLinearGradient(0, s - 22, 0, s - 11)
    tGrad.addColorStop(0, '#7a7a7a')
    tGrad.addColorStop(0.5, '#5a5a5a')
    tGrad.addColorStop(1, '#2a2a2a')
    rrect(ctx, s / 2 - 8, s - 21, 16, 9, 1, tGrad as any)
    px(ctx, s / 2 - 8, s - 21, 16, 1, '#9a9a9a')
    // vertical panel seams
    px(ctx, s / 2 - 3, s - 21, 1, 9, '#1a1a1a')
    px(ctx, s / 2 + 3, s - 21, 1, 9, '#1a1a1a')

    // --- Energy cannon housing (raised mantlet) ---
    rrect(ctx, s / 2 - 5, s - 28, 10, 7, 1, '#1a1a1a')
    const mGrad = ctx.createLinearGradient(0, s - 28, 0, s - 21)
    mGrad.addColorStop(0, '#6a6a6a')
    mGrad.addColorStop(1, '#3a3a3a')
    rrect(ctx, s / 2 - 4, s - 27, 8, 5, 1, mGrad as any)
    px(ctx, s / 2 - 4, s - 27, 8, 1, '#8a8a8a')

    // --- Energy cannon barrel (sleek, with glowing core) ---
    px(ctx, s / 2 - 1, s - 33, 3, 7, '#1a1a1a')
    px(ctx, s / 2, s - 33, 1, 7, '#4a4a4a')
    // barrel muzzle ring
    px(ctx, s / 2 - 2, s - 33, 5, 1, '#3a3a3a')
    px(ctx, s / 2 - 2, s - 34, 5, 1, '#5a5a5a')

    // --- Glowing power cell at base of barrel (cyan) ---
    const cellGrad = ctx.createRadialGradient(s / 2, s - 25, 0, s / 2, s - 25, 4)
    cellGrad.addColorStop(0, '#c0f4ff')
    cellGrad.addColorStop(0.4, '#00d0ff')
    cellGrad.addColorStop(1, 'rgba(0,208,255,0)')
    ctx.fillStyle = cellGrad
    ctx.fillRect(s / 2 - 4, s - 29, 8, 8)
    ctx.fillStyle = '#00d0ff'
    rrect(ctx, s / 2 - 2, s - 27, 5, 3, 1, '#00d0ff')
    px(ctx, s / 2 - 2, s - 27, 5, 1, '#80e8ff')

    // --- Muzzle glow (charging tip) ---
    const muzzleGrad = ctx.createRadialGradient(s / 2, s - 33, 0, s / 2, s - 33, 4)
    muzzleGrad.addColorStop(0, '#c0f4ff')
    muzzleGrad.addColorStop(0.5, '#00d0ff')
    muzzleGrad.addColorStop(1, 'rgba(0,208,255,0)')
    ctx.fillStyle = muzzleGrad
    ctx.fillRect(s / 2 - 4, s - 37, 8, 8)

    // --- Faction emblem (on turret side) ---
    ctx.fillStyle = col.flag
    ctx.beginPath(); ctx.arc(s / 2, s - 16, 1.5, 0, Math.PI * 2); ctx.fill()
    px(ctx, s / 2, s - 16, 1, 1, col.trim)

    // --- Side status lights (amber) ---
    for (const lx of [s / 2 - 6, s / 2 + 5]) {
      ctx.fillStyle = '#ffaa30'
      ctx.beginPath(); ctx.arc(lx, s - 14, 0.7, 0, Math.PI * 2); ctx.fill()
    }
  } else if (type === 'refinery') {
    // ===== REFINERY (2x2 = 80x80): Spice processing plant =====
    // Large cylindrical processing tank with orange glow + pipes + vats + valves

    // --- Lower processing structure (industrial chemical plant base) ---
    const wallTop = H * 0.52
    const wallBottom = H - 4
    rrect(ctx, 4, wallTop, W - 8, wallBottom - wallTop, 2, '#1a1a1a')
    const wallGrad = ctx.createLinearGradient(0, wallTop, 0, wallBottom)
    wallGrad.addColorStop(0, '#5a5a5a')
    wallGrad.addColorStop(0.4, '#3a3a3a')
    wallGrad.addColorStop(1, '#2a2a2a')
    rrect(ctx, 6, wallTop + 1, W - 12, wallBottom - wallTop - 2, 1, wallGrad as any)
    px(ctx, 6, wallTop + 1, W - 12, 1, '#7a7a7a')
    // panel divisions
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.4, W - 12, 1, '#1a1a1a')
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.4 + 1, W - 12, 1, '#5a5a5a')
    // faction accent stripe (subtle)
    px(ctx, 6, wallTop + 6, W - 12, 1, col.primary)
    px(ctx, 6, wallTop + 7, W - 12, 1, col.dark)

    // --- Large central cylindrical processing tank (with spice glow) ---
    const tankR = W * 0.18
    const tankX = W / 2
    const tankBottomY = wallTop + 2
    const tankTopY = H * 0.18
    const tankH = tankBottomY - tankTopY
    // tank outer shell (dark)
    rrect(ctx, tankX - tankR, tankTopY, tankR * 2, tankH, 2, '#1a1a1a')
    // tank metallic body with horizontal gradient
    const tankGrad = ctx.createLinearGradient(tankX - tankR, 0, tankX + tankR, 0)
    tankGrad.addColorStop(0, '#2a2a2a')
    tankGrad.addColorStop(0.25, '#5a5a5a')
    tankGrad.addColorStop(0.5, '#6a6a6a')
    tankGrad.addColorStop(0.75, '#4a4a4a')
    tankGrad.addColorStop(1, '#1a1a1a')
    rrect(ctx, tankX - tankR + 1, tankTopY + 1, tankR * 2 - 2, tankH - 2, 1, tankGrad as any)
    // tank top rim (reinforced)
    rrect(ctx, tankX - tankR - 2, tankTopY - 3, tankR * 2 + 4, 5, 1, '#1a1a1a')
    rrect(ctx, tankX - tankR - 1, tankTopY - 2, tankR * 2 + 2, 3, 1, '#5a5a5a')
    px(ctx, tankX - tankR - 1, tankTopY - 2, tankR * 2 + 2, 1, '#8a8a8a')
    // tank band rivets (reinforcement rings)
    for (const ry of [tankTopY + tankH * 0.3, tankTopY + tankH * 0.6]) {
      px(ctx, tankX - tankR, ry, tankR * 2, 1, '#1a1a1a')
      px(ctx, tankX - tankR, ry + 1, tankR * 2, 1, '#5a5a5a')
      for (let i = 0; i < 5; i++) {
        const rx = tankX - tankR + 3 + i * (tankR * 2 - 6) / 4
        px(ctx, rx, ry + 1, 1, 1, '#1a1a1a')
      }
    }

    // --- Spice glow viewports (translucent orange windows) ---
    for (const vy of [tankTopY + tankH * 0.45, tankTopY + tankH * 0.75]) {
      const vpGrad = ctx.createLinearGradient(0, vy, 0, vy + 6)
      vpGrad.addColorStop(0, '#ff8030')
      vpGrad.addColorStop(0.5, '#ffa050')
      vpGrad.addColorStop(1, '#ff6020')
      rrect(ctx, tankX - tankR * 0.55, vy, tankR * 1.1, 6, 1, '#1a1a1a')
      rrect(ctx, tankX - tankR * 0.55 + 1, vy + 1, tankR * 1.1 - 2, 4, 1, vpGrad as any)
      px(ctx, tankX - tankR * 0.55 + 1, vy + 1, tankR * 1.1 - 2, 1, '#ffc070')
      // viewport dividers
      for (let i = 1; i < 3; i++) {
        px(ctx, tankX - tankR * 0.55 + (tankR * 1.1 - 2) * i / 3, vy + 1, 1, 4, '#1a1a1a')
      }
    }
    // spice glow halo (around tank top)
    const spiceGlow = ctx.createRadialGradient(tankX, tankTopY + 4, 0, tankX, tankTopY + 4, tankR + 4)
    spiceGlow.addColorStop(0, 'rgba(255,128,48,0.4)')
    spiceGlow.addColorStop(1, 'rgba(255,128,48,0)')
    ctx.fillStyle = spiceGlow
    ctx.fillRect(tankX - tankR - 4, tankTopY - 4, tankR * 2 + 8, 16)

    // --- Tank top valve/outlet assembly ---
    rrect(ctx, tankX - 4, tankTopY - 7, 8, 4, 1, '#1a1a1a')
    rrect(ctx, tankX - 3, tankTopY - 6, 6, 2, 1, '#5a5a5a')
    px(ctx, tankX - 3, tankTopY - 6, 6, 1, '#7a7a7a')
    // outlet pipe (rising)
    px(ctx, tankX - 1, tankTopY - 12, 2, 6, '#3a3a3a')
    px(ctx, tankX - 1, tankTopY - 12, 1, 6, '#5a5a5a')
    // top vent glow (spice fumes — orange)
    const ventGrad = ctx.createRadialGradient(tankX, tankTopY - 12, 0, tankX, tankTopY - 12, 5)
    ventGrad.addColorStop(0, '#ffc070')
    ventGrad.addColorStop(0.4, '#ff8030')
    ventGrad.addColorStop(1, 'rgba(255,128,48,0)')
    ctx.fillStyle = ventGrad
    ctx.fillRect(tankX - 5, tankTopY - 17, 10, 10)

    // --- Side crystallization vats (smaller cylinders, with spice glow) ---
    const vatTopY = tankTopY + tankH * 0.15
    const vatH = tankH * 0.7
    for (const side of [0, 1]) {
      const vx = side === 0 ? 8 : W - 18
      rrect(ctx, vx, vatTopY, 10, vatH, 1, '#1a1a1a')
      const vatGrad = ctx.createLinearGradient(vx, 0, vx + 10, 0)
      vatGrad.addColorStop(0, '#3a3a3a')
      vatGrad.addColorStop(0.5, '#5a5a5a')
      vatGrad.addColorStop(1, '#1a1a1a')
      rrect(ctx, vx + 1, vatTopY + 1, 8, vatH - 2, 1, vatGrad as any)
      // vat spice glow viewport
      const vsg = ctx.createLinearGradient(0, vatTopY + vatH * 0.3, 0, vatTopY + vatH * 0.7)
      vsg.addColorStop(0, '#ff6020')
      vsg.addColorStop(1, '#ffa050')
      rrect(ctx, vx + 2, vatTopY + vatH * 0.3, 6, vatH * 0.4, 1, vsg as any)
      px(ctx, vx + 2, vatTopY + vatH * 0.3, 6, 1, '#ffc070')
      // vat top rim
      rrect(ctx, vx - 1, vatTopY - 1, 12, 3, 1, '#1a1a1a')
      px(ctx, vx - 1, vatTopY - 1, 12, 1, '#5a5a5a')
    }

    // --- Connecting pipes (from main tank to vats) ---
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 3
    // left pipe
    ctx.beginPath()
    ctx.moveTo(tankX - tankR, tankTopY + tankH * 0.5)
    ctx.lineTo(18, tankTopY + tankH * 0.5)
    ctx.stroke()
    // right pipe
    ctx.beginPath()
    ctx.moveTo(tankX + tankR, tankTopY + tankH * 0.5)
    ctx.lineTo(W - 18, tankTopY + tankH * 0.5)
    ctx.stroke()
    // pipe highlights
    ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(tankX - tankR, tankTopY + tankH * 0.5 - 1)
    ctx.lineTo(18, tankTopY + tankH * 0.5 - 1)
    ctx.moveTo(tankX + tankR, tankTopY + tankH * 0.5 - 1)
    ctx.lineTo(W - 18, tankTopY + tankH * 0.5 - 1)
    ctx.stroke()
    // pipe elbows (flanges)
    for (const jx of [18, W - 18]) {
      rrect(ctx, jx - 2, tankTopY + tankH * 0.5 - 3, 4, 6, 1, '#5a5a5a')
      px(ctx, jx - 2, tankTopY + tankH * 0.5 - 3, 4, 1, '#8a8a8a')
    }

    // --- Valve array (2 large wheels on lower structure) ---
    for (const vx of [14, W - 14]) {
      const vy = H * 0.78
      ctx.fillStyle = '#3a3a3a'
      ctx.beginPath(); ctx.arc(vx, vy, 5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#5a5a5a'
      ctx.beginPath(); ctx.arc(vx, vy, 4, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(vx, vy)
        ctx.lineTo(vx + Math.cos(a) * 4, vy + Math.sin(a) * 4)
        ctx.stroke()
      }
      ctx.fillStyle = '#1a1a1a'
      ctx.beginPath(); ctx.arc(vx, vy, 1.5, 0, Math.PI * 2); ctx.fill()
      // valve center glow (spice)
      ctx.fillStyle = '#ff8030'
      ctx.beginPath(); ctx.arc(vx, vy, 0.8, 0, Math.PI * 2); ctx.fill()
    }

    // --- Spice glow windows on lower structure ---
    for (const wx of [12, W - 16]) {
      const sg = ctx.createLinearGradient(0, H * 0.62, 0, H * 0.7)
      sg.addColorStop(0, '#ff6020')
      sg.addColorStop(1, '#ffa050')
      rrect(ctx, wx, H * 0.62, 6, 8, 1, '#1a1a1a')
      rrect(ctx, wx + 1, H * 0.62 + 1, 4, 6, 1, sg as any)
      px(ctx, wx + 1, H * 0.62 + 1, 4, 1, '#ffc070')
    }

    // --- Central access door ---
    rrect(ctx, W / 2 - 5, H - 13, 10, 10, 1, '#1a1a1a')
    const dGrad = ctx.createLinearGradient(0, H - 13, 0, H - 3)
    dGrad.addColorStop(0, '#4a4a4a')
    dGrad.addColorStop(1, '#1a1a1a')
    rrect(ctx, W / 2 - 4, H - 12, 8, 9, 1, dGrad as any)
    px(ctx, W / 2, H - 12, 1, 9, '#0a0a0a')
    // hazard stripes at door base
    for (let i = 0; i < 4; i++) {
      px(ctx, W / 2 - 4 + i * 2, H - 4, 2, 1, i % 2 === 0 ? '#ffd040' : '#1a1a1a')
    }

    // --- Spice stain spill (orange on ground) ---
    ctx.fillStyle = 'rgba(232, 93, 47, 0.5)'
    ctx.beginPath(); ctx.ellipse(W / 2 + 12, H - 3, 10, 2.5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255, 150, 80, 0.4)'
    ctx.beginPath(); ctx.ellipse(W / 2 + 10, H - 3, 5, 1.5, 0, 0, Math.PI * 2); ctx.fill()
    // spice crystal specks (glowing)
    for (let i = 0; i < 6; i++) {
      const sx2 = W / 2 + 6 + rng() * 14
      const sy2 = H - 4 + rng() * 2
      ctx.fillStyle = rng() > 0.5 ? '#ff8030' : '#ffc070'
      ctx.fillRect(sx2, sy2, 1, 1)
    }
  } else if (type === 'generator') {
    // ===== GENERATOR (2x2 = 80x80): Power plant with vertical plasma core =====
    // Bright cyan plasma + cooling fins + lightning arcs + energy conduit

    // --- Main reactor housing ---
    const wallTop = H * 0.4
    const wallBottom = H - 4
    rrect(ctx, 4, wallTop, W - 8, wallBottom - wallTop, 2, '#1a1a1a')
    const wallGrad = ctx.createLinearGradient(0, wallTop, 0, wallBottom)
    wallGrad.addColorStop(0, '#5a5a5a')
    wallGrad.addColorStop(0.4, '#3a3a3a')
    wallGrad.addColorStop(1, '#2a2a2a')
    rrect(ctx, 6, wallTop + 1, W - 12, wallBottom - wallTop - 2, 1, wallGrad as any)
    px(ctx, 6, wallTop + 1, W - 12, 1, '#7a7a7a')
    // panel divisions
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.55, W - 12, 1, '#1a1a1a')
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.55 + 1, W - 12, 1, '#5a5a5a')

    // --- Vertical cooling fins (left and right radiator stacks) ---
    for (const side of [0, 1]) {
      const fx = side === 0 ? 8 : W - 14
      rrect(ctx, fx, wallTop + 4, 6, wallBottom - wallTop - 8, 1, '#1a1a1a')
      const fGrad = ctx.createLinearGradient(fx, 0, fx + 6, 0)
      fGrad.addColorStop(0, '#3a3a3a')
      fGrad.addColorStop(0.5, '#5a5a5a')
      fGrad.addColorStop(1, '#1a1a1a')
      rrect(ctx, fx + 1, wallTop + 5, 4, wallBottom - wallTop - 10, 1, fGrad as any)
      // fin slits (vertical radiator lines)
      for (let i = 0; i < 10; i++) {
        const fy = wallTop + 6 + i * ((wallBottom - wallTop - 14) / 9)
        px(ctx, fx, fy, 6, 1, '#1a1a1a')
        px(ctx, fx, fy + 1, 6, 1, '#4a4a4a')
      }
      // top cap (with vent glow)
      rrect(ctx, fx - 1, wallTop + 1, 8, 4, 1, '#1a1a1a')
      rrect(ctx, fx, wallTop + 2, 6, 2, 1, '#4a4a4a')
      // top vent glow (cyan heat exhaust)
      const vg = ctx.createRadialGradient(fx + 3, wallTop + 1, 0, fx + 3, wallTop + 1, 4)
      vg.addColorStop(0, '#c0f4ff')
      vg.addColorStop(0.4, '#00d0ff')
      vg.addColorStop(1, 'rgba(0,208,255,0)')
      ctx.fillStyle = vg
      ctx.fillRect(fx - 1, wallTop - 3, 8, 6)
      ctx.fillStyle = '#00d0ff'
      ctx.beginPath(); ctx.arc(fx + 3, wallTop + 1, 0.8, 0, Math.PI * 2); ctx.fill()
    }

    // --- Top vent assembly (horizontal slats) ---
    rrect(ctx, W * 0.22, wallTop - 4, W * 0.56, 6, 1, '#1a1a1a')
    rrect(ctx, W * 0.22 + 1, wallTop - 3, W * 0.56 - 2, 4, 1, '#4a4a4a')
    px(ctx, W * 0.22 + 1, wallTop - 3, W * 0.56 - 2, 1, '#6a6a6a')
    for (let i = 0; i < 7; i++) {
      const vx = W * 0.22 + 2 + i * ((W * 0.56 - 4) / 7)
      px(ctx, vx, wallTop - 2, 4, 1, '#2a2a2a')
      px(ctx, vx, wallTop, 4, 1, '#5a5a5a')
    }

    // --- Central vertical plasma core (bright cyan glow through containment) ---
    const coreX = W / 2
    const coreY = wallTop + (wallBottom - wallTop) * 0.5
    const coreR = W * 0.2

    // outer plasma halo (large soft glow)
    const haloGrad = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreR + 12)
    haloGrad.addColorStop(0, 'rgba(0,208,255,0.7)')
    haloGrad.addColorStop(0.5, 'rgba(0,128,160,0.4)')
    haloGrad.addColorStop(1, 'rgba(0,128,160,0)')
    ctx.fillStyle = haloGrad
    ctx.fillRect(coreX - coreR - 12, coreY - coreR - 12, (coreR + 12) * 2, (coreR + 12) * 2)

    // core containment ring (mechanical housing)
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath(); ctx.arc(coreX, coreY, coreR * 0.9, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(coreX, coreY, coreR * 0.85, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = '#7a7a7a'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(coreX, coreY, coreR * 0.85, 0, Math.PI * 2); ctx.stroke()
    // ring bolt mounts (8 around)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const bx = coreX + Math.cos(a) * coreR * 0.85
      const by = coreY + Math.sin(a) * coreR * 0.85
      ctx.fillStyle = '#3a3a3a'
      ctx.beginPath(); ctx.arc(bx, by, 2, 0, Math.PI * 2); ctx.fill()
      px(ctx, bx, by, 1, 1, '#1a1a1a')
    }

    // core plasma (bright cyan radial gradient)
    const plasmaGrad = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreR * 0.7)
    plasmaGrad.addColorStop(0, '#ffffff')
    plasmaGrad.addColorStop(0.2, '#c0f4ff')
    plasmaGrad.addColorStop(0.5, '#00d0ff')
    plasmaGrad.addColorStop(0.85, '#0080a0')
    plasmaGrad.addColorStop(1, 'rgba(0,128,160,0)')
    ctx.fillStyle = plasmaGrad
    ctx.beginPath(); ctx.arc(coreX, coreY, coreR * 0.7, 0, Math.PI * 2); ctx.fill()
    // plasma bright center
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(coreX, coreY, coreR * 0.18, 0, Math.PI * 2); ctx.fill()

    // containment vertical bars (cyan grid over plasma)
    ctx.strokeStyle = 'rgba(0,208,255,0.6)'; ctx.lineWidth = 1
    for (let i = -2; i <= 2; i++) {
      const cx2 = coreX + i * (coreR * 0.7 / 2.5)
      const dy = Math.sqrt(Math.max(0, (coreR * 0.7) ** 2 - (cx2 - coreX) ** 2))
      ctx.beginPath()
      ctx.moveTo(cx2, coreY - dy)
      ctx.lineTo(cx2, coreY + dy)
      ctx.stroke()
    }

    // --- Lightning arcs (4 directions from core, cyan) ---
    ctx.strokeStyle = '#c0f4ff'; ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    // top arc to pylon
    ctx.beginPath()
    ctx.moveTo(coreX, coreY - coreR * 0.85)
    ctx.lineTo(coreX - 3, coreY - coreR * 1.05)
    ctx.lineTo(coreX + 2, coreY - coreR * 1.2)
    ctx.lineTo(coreX - 1, coreY - coreR * 1.35)
    ctx.stroke()
    // left arc
    ctx.beginPath()
    ctx.moveTo(coreX - coreR * 0.85, coreY)
    ctx.lineTo(coreX - coreR * 1.05, coreY - 3)
    ctx.lineTo(coreX - coreR * 1.2, coreY + 2)
    ctx.lineTo(coreX - coreR * 1.3, coreY - 1)
    ctx.stroke()
    // right arc
    ctx.beginPath()
    ctx.moveTo(coreX + coreR * 0.85, coreY)
    ctx.lineTo(coreX + coreR * 1.05, coreY + 3)
    ctx.lineTo(coreX + coreR * 1.2, coreY - 2)
    ctx.lineTo(coreX + coreR * 1.3, coreY + 1)
    ctx.stroke()
    // bottom arc
    ctx.beginPath()
    ctx.moveTo(coreX, coreY + coreR * 0.85)
    ctx.lineTo(coreX + 3, coreY + coreR * 1.0)
    ctx.lineTo(coreX - 2, coreY + coreR * 1.15)
    ctx.stroke()
    ctx.lineCap = 'butt'

    // --- Energy pylon / antenna (top, conducting power up) ---
    const pylonX = coreX
    const pylonTopY = H * 0.05
    px(ctx, pylonX - 1, pylonTopY, 2, wallTop - 4 - pylonTopY, '#3a3a3a')
    px(ctx, pylonX - 1, pylonTopY, 1, wallTop - 4 - pylonTopY, '#5a5a5a')
    // pylon crossbars
    px(ctx, pylonX - 3, pylonTopY + 6, 6, 1, '#4a4a4a')
    px(ctx, pylonX - 2, pylonTopY + 12, 4, 1, '#4a4a4a')
    // pylon ceramic insulators
    for (const iy of [pylonTopY + 8, pylonTopY + 14, pylonTopY + 20]) {
      rrect(ctx, pylonX - 2, iy, 4, 2, 1, '#d0d0d0')
      px(ctx, pylonX - 2, iy, 4, 1, '#ffffff')
    }
    // pylon tip glow (cyan, charging)
    const tipGrad = ctx.createRadialGradient(pylonX, pylonTopY, 0, pylonX, pylonTopY, 6)
    tipGrad.addColorStop(0, '#c0f4ff')
    tipGrad.addColorStop(0.4, '#00d0ff')
    tipGrad.addColorStop(1, 'rgba(0,208,255,0)')
    ctx.fillStyle = tipGrad
    ctx.fillRect(pylonX - 6, pylonTopY - 6, 12, 12)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(pylonX, pylonTopY, 1.5, 0, Math.PI * 2); ctx.fill()

    // --- Energy conduit LEDs along the bottom (cyan) ---
    for (let i = 0; i < 5; i++) {
      const lx = 22 + i * (W - 44) / 4
      const lg = ctx.createRadialGradient(lx, H - 7, 0, lx, H - 7, 3)
      lg.addColorStop(0, '#c0f4ff')
      lg.addColorStop(0.4, '#00d0ff')
      lg.addColorStop(1, 'rgba(0,208,255,0)')
      ctx.fillStyle = lg
      ctx.fillRect(lx - 3, H - 10, 6, 6)
      ctx.fillStyle = '#00d0ff'
      ctx.beginPath(); ctx.arc(lx, H - 7, 1.2, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(lx, H - 7, 0.4, 0, Math.PI * 2); ctx.fill()
    }

    // --- Status display panels (glowing cyan/amber) ---
    rrect(ctx, 16, wallTop + 8, 8, 5, 1, '#1a1a1a')
    px(ctx, 17, wallTop + 9, 6, 1, '#00d0ff')
    px(ctx, 17, wallTop + 11, 4, 1, '#00d0ff')
    rrect(ctx, W - 24, wallTop + 8, 8, 5, 1, '#1a1a1a')
    px(ctx, W - 23, wallTop + 9, 6, 1, '#00d0ff')
    px(ctx, W - 23, wallTop + 11, 4, 1, '#ffaa30')

    // --- Faction accent stripe ---
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.85, W - 12, 1, col.primary)
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.85 + 1, W - 12, 1, col.dark)

    // base shadow strip
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.fillRect(8, H - 4, W - 16, 2)
  }

  buildingCache.set(key, c)
  return c
}

export function drawBuilding(ctx: CanvasRenderingContext2D, type: BuildingType, faction: Faction, px_: number, py_: number, w = 1, h = 1) {
  const img = renderBuilding(type, faction, w, h)
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

export function drawUnit(ctx: CanvasRenderingContext2D, type: UnitType, faction: Faction, px_: number, py_: number, bob = 0, facing = 0) {
  const img = renderUnit(type, faction)
  if (type === 'soldier') {
    // soldiers don't rotate (they face the player), just draw with bob
    ctx.drawImage(img, px_ - TILE_SIZE / 2, py_ - TILE_SIZE / 2 + bob)
  } else {
    // vehicles (harvester, tank) rotate to face movement direction
    ctx.save()
    ctx.translate(px_, py_ + bob)
    // sprite is drawn facing right (0 rad). Rotate to facing.
    ctx.rotate(facing)
    ctx.drawImage(img, -TILE_SIZE / 2, -TILE_SIZE / 2)
    ctx.restore()
  }
}

// ---------- Worm rendering (detailed, Shai-Hulud) ----------
let wormCache: HTMLCanvasElement | null = null
function renderWorm(): HTMLCanvasElement {
  if (wormCache) return wormCache
  const c = document.createElement('canvas')
  c.width = TILE_SIZE; c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  const s = TILE_SIZE
  const cx = s / 2, cy = s / 2

  // ground shadow (sand displacement)
  ctx.fillStyle = 'rgba(60,30,5,0.45)'
  ctx.beginPath(); ctx.ellipse(cx, s - 5, 15, 4, 0, 0, Math.PI * 2); ctx.fill()

  // body — long segmented worm emerging from sand, horizontal orientation
  // tail (tapering, behind)
  ctx.fillStyle = '#7a3a10'
  ctx.beginPath()
  ctx.moveTo(2, cy + 1)
  ctx.quadraticCurveTo(cx - 8, cy - 3, cx - 4, cy)
  ctx.lineTo(cx - 4, cy + 6)
  ctx.quadraticCurveTo(cx - 8, cy + 7, 2, cy + 7)
  ctx.fill()

  // main body segments (rounded, overlapping)
  const segments = [
    { x: cx - 8, y: cy, r: 5, shade: '#8b4513' },
    { x: cx - 4, y: cy - 1, r: 6, shade: '#9a5018' },
    { x: cx, y: cy - 2, r: 7, shade: '#a85820' },
    { x: cx + 4, y: cy - 1, r: 7, shade: '#9a5018' },
  ]
  for (const seg of segments) {
    ctx.fillStyle = seg.shade
    ctx.beginPath(); ctx.ellipse(seg.x, seg.y + 3, seg.r, seg.r - 1, 0, 0, Math.PI * 2); ctx.fill()
  }

  // segment ring lines (texture)
  ctx.strokeStyle = '#5a2810'; ctx.lineWidth = 1
  for (let i = -2; i <= 2; i++) {
    const x = cx + i * 4
    ctx.beginPath()
    ctx.moveTo(x, cy - 3)
    ctx.quadraticCurveTo(x - 1, cy + 3, x, cy + 7)
    ctx.stroke()
  }

  // top highlight (light from above)
  ctx.fillStyle = '#c07030'
  ctx.beginPath(); ctx.ellipse(cx, cy - 1, 10, 2, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#e09040'
  ctx.beginPath(); ctx.ellipse(cx - 2, cy - 2, 6, 1, 0, 0, Math.PI * 2); ctx.fill()

  // mouth — circular maw at the front (right side)
  const mouthX = cx + 7, mouthY = cy + 2
  // outer lips (darker)
  ctx.fillStyle = '#3a1008'
  ctx.beginPath(); ctx.ellipse(mouthX, mouthY, 5, 4, 0, 0, Math.PI * 2); ctx.fill()
  // inner mouth (glowing red)
  const mouthGrad = ctx.createRadialGradient(mouthX, mouthY, 0, mouthX, mouthY, 4)
  mouthGrad.addColorStop(0, '#ff4020')
  mouthGrad.addColorStop(0.5, '#a02010')
  mouthGrad.addColorStop(1, '#3a1008')
  ctx.fillStyle = mouthGrad
  ctx.beginPath(); ctx.ellipse(mouthX, mouthY, 3.5, 3, 0, 0, Math.PI * 2); ctx.fill()
  // teeth — triangular, ring around mouth
  ctx.fillStyle = '#fff8e0'
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const tx = mouthX + Math.cos(a) * 4
    const ty = mouthY + Math.sin(a) * 3
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.lineTo(mouthX + Math.cos(a) * 2.5, mouthY + Math.sin(a) * 1.8)
    ctx.lineTo(mouthX + Math.cos(a + 0.4) * 4, mouthY + Math.sin(a + 0.4) * 3)
    ctx.closePath(); ctx.fill()
  }

  // sand spray at base (emerging effect)
  ctx.fillStyle = 'rgba(200,150,70,0.6)'
  for (let i = 0; i < 6; i++) {
    const px2 = 3 + Math.random() * 6
    const py2 = s - 8 + Math.random() * 5
    ctx.fillRect(px2, py2, 1, 1)
  }
  for (let i = 0; i < 4; i++) {
    const px2 = s - 8 + Math.random() * 6
    const py2 = s - 8 + Math.random() * 5
    ctx.fillRect(px2, py2, 1, 1)
  }

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

export function getBuildingPreview(type: BuildingType, faction: Faction, size = 40, w = 1, h = 1): string {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const ctx = c.getContext('2d')!
  const img = renderBuilding(type, faction, w, h)
  // scale the (potentially multi-tile) building image to fit the preview square
  const scale = size / (Math.max(w, h) * TILE_SIZE)
  ctx.scale(scale, scale)
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

// ---------- Projectile ----------
export function drawProjectile(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, color: string) {
  // tracer trail
  const dx = x - sx, dy = y - sy
  const d = Math.hypot(dx, dy) || 1
  const trailLen = Math.min(8, d)
  const tx = x - (dx / d) * trailLen
  const ty = y - (dy / d) * trailLen
  const grad = ctx.createLinearGradient(tx, ty, x, y)
  grad.addColorStop(0, 'rgba(255,200,100,0)')
  grad.addColorStop(1, color)
  ctx.strokeStyle = grad
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke()
  // bright head
  ctx.fillStyle = '#fff'
  ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1
}

// ---------- Explosion ----------
export function drawExplosion(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number, maxFrame: number, size: number, color: string) {
  const t = frame / maxFrame
  const r = (1 - Math.abs(t - 0.3)) * 8 * size
  // outer glow
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r + 4)
  grad.addColorStop(0, `rgba(255,240,180,${1 - t})`)
  grad.addColorStop(0.3, color)
  grad.addColorStop(0.7, `rgba(180,60,20,${0.7 * (1 - t)})`)
  grad.addColorStop(1, 'rgba(80,20,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(x - r - 4, y - r - 4, (r + 4) * 2, (r + 4) * 2)
  // core flash
  if (t < 0.4) {
    ctx.fillStyle = `rgba(255,255,255,${0.9 - t * 2})`
    ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2); ctx.fill()
  }
  // sparks
  if (t < 0.6) {
    ctx.fillStyle = '#ffe080'
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + frame * 0.1
      const sr = r * 0.8
      ctx.fillRect(x + Math.cos(a) * sr, y + Math.sin(a) * sr, 1, 1)
    }
  }
}

// ---------- Muzzle flash ----------
export function drawMuzzleFlash(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) {
  const r = 4 - frame
  if (r <= 0) return
  ctx.fillStyle = `rgba(255,240,150,${0.8 - frame * 0.2})`
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = `rgba(255,180,60,${0.5 - frame * 0.15})`
  ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill()
}

// ---------- Attack range indicator (for selected turret/unit) ----------
export function drawRangeIndicator(ctx: CanvasRenderingContext2D, x: number, y: number, range: number, color = '#4ade80') {
  ctx.save()
  // subtle fill
  ctx.fillStyle = color
  ctx.globalAlpha = 0.12
  ctx.beginPath(); ctx.arc(x, y, range * TILE_SIZE, 0, Math.PI * 2); ctx.fill()
  // dashed ring
  ctx.strokeStyle = color
  ctx.lineWidth = 2.5
  ctx.setLineDash([6, 4])
  ctx.globalAlpha = 0.85
  ctx.beginPath(); ctx.arc(x, y, range * TILE_SIZE, 0, Math.PI * 2); ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

// ---------- Fog of war overlay ----------
// exploredCells: boolean[] (ever seen), visibleCells: boolean[] (currently visible)
export function drawFogOfWar(
  ctx: CanvasRenderingContext2D,
  explored: boolean[], visible: boolean[],
  w: number, h: number,
) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (visible[i]) continue
      const ox = x * TILE_SIZE, oy = y * TILE_SIZE
      if (explored[i]) {
        // explored but not currently visible — dark overlay, terrain still faintly visible
        ctx.fillStyle = 'rgba(10,8,4,0.55)'
        ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE)
      } else {
        // never seen — full fog
        ctx.fillStyle = 'rgba(5,4,2,0.92)'
        ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE)
        // subtle noise to break flatness
        if ((x * 7 + y * 13) % 5 === 0) {
          ctx.fillStyle = 'rgba(20,15,5,0.5)'
          ctx.fillRect(ox + (x % 3) * 8, oy + (y % 4) * 7, 3, 3)
        }
      }
    }
  }
}

// ---------- Energy indicator (for generator icon / status) ----------
export function drawEnergyIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size = 12, color = '#ffe060') {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = color
  // lightning bolt
  ctx.beginPath()
  ctx.moveTo(size * 0.55, 0)
  ctx.lineTo(size * 0.15, size * 0.55)
  ctx.lineTo(size * 0.45, size * 0.55)
  ctx.lineTo(size * 0.35, size)
  ctx.lineTo(size * 0.85, size * 0.4)
  ctx.lineTo(size * 0.55, size * 0.4)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}
