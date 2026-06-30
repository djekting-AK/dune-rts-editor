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

  if (type === 'palace') {
    // ===== PALACE (2x2 = 80x80): Large fortress — thick walls, 4 corner towers,
    // central keep, flag, glowing windows, crenellations =====

    // back wall mass (rises behind the towers and keep)
    const wallTop = H * 0.34
    const wallBottom = H - 4
    rrect(ctx, 6, wallTop, W - 12, wallBottom - wallTop, 3, col.dark)
    const wallGrad = ctx.createLinearGradient(0, wallTop, 0, wallBottom)
    wallGrad.addColorStop(0, col.light)
    wallGrad.addColorStop(0.4, col.primary)
    wallGrad.addColorStop(1, col.dark)
    rrect(ctx, 8, wallTop + 2, W - 16, wallBottom - wallTop - 4, 2, wallGrad as any)
    // wall horizontal trim band
    px(ctx, 8, wallTop + (wallBottom - wallTop) * 0.55, W - 16, 2, col.dark)
    px(ctx, 8, wallTop + (wallBottom - wallTop) * 0.55 + 2, W - 16, 1, col.trim)

    // crenellations (battlements) along top of back wall
    const cn = 9
    const cw = (W - 16) / cn
    for (let i = 0; i < cn; i++) {
      if (i % 2 === 0) {
        const bx = 8 + i * cw
        rrect(ctx, bx, wallTop - 3, cw - 1, 4, 1, col.dark)
        px(ctx, bx, wallTop - 3, cw - 1, 1, col.light)
      }
    }

    // 4 corner towers — front pair (taller, in front) + back pair (slightly behind)
    const tw = W * 0.18
    const th = H * 0.7
    const towerSpecs = [
      { x: 3, y: H - th - 3, depth: 0 },                       // front-left
      { x: W - tw - 3, y: H - th - 3, depth: 0 },              // front-right
      { x: 6, y: H - th - 8, depth: 1 },                       // back-left (smaller, behind)
      { x: W - tw - 6, y: H - th - 8, depth: 1 },              // back-right
    ]
    for (const t of towerSpecs) {
      const shrink = t.depth === 1 ? 2 : 0
      const tw2 = tw - shrink * 2
      // tower body
      rrect(ctx, t.x + shrink, t.y, tw2, th, 2, col.dark)
      const tGrad = ctx.createLinearGradient(0, t.y, 0, t.y + th)
      tGrad.addColorStop(0, col.light)
      tGrad.addColorStop(0.5, col.primary)
      tGrad.addColorStop(1, col.dark)
      rrect(ctx, t.x + shrink + 1, t.y + 1, tw2 - 2, th - 2, 1, tGrad as any)
      px(ctx, t.x + shrink + 1, t.y + 1, tw2 - 2, 2, col.light)
      // tower crenellated top
      const tcn = 3
      for (let i = 0; i < tcn; i++) {
        const bx = t.x + shrink + 1 + i * ((tw2 - 2) / tcn)
        rrect(ctx, bx, t.y - 3, (tw2 - 2) / tcn - 1, 3, 1, col.dark)
        px(ctx, bx, t.y - 3, (tw2 - 2) / tcn - 1, 1, col.light)
      }
      // tower roof (conical)
      const roofColor = t.depth === 1 ? '#2a1a0a' : '#3a2a1a'
      ctx.fillStyle = roofColor
      ctx.beginPath()
      ctx.moveTo(t.x + shrink - 1, t.y - 1)
      ctx.lineTo(t.x + shrink + tw2 / 2, t.y - 11)
      ctx.lineTo(t.x + shrink + tw2 + 1, t.y - 1)
      ctx.closePath()
      ctx.fill()
      // roof shadow side
      ctx.fillStyle = '#1a0e04'
      ctx.beginPath()
      ctx.moveTo(t.x + shrink + tw2 / 2, t.y - 11)
      ctx.lineTo(t.x + shrink + tw2 + 1, t.y - 1)
      ctx.lineTo(t.x + shrink + tw2 / 2 + 1, t.y - 1)
      ctx.closePath()
      ctx.fill()
      // roof finial
      px(ctx, t.x + shrink + tw2 / 2, t.y - 13, 1, 3, '#5a4a3a')
      // glowing windows on tower (2 rows)
      const winY1 = t.y + th * 0.25
      const winY2 = t.y + th * 0.55
      for (const wy of [winY1, winY2]) {
        px(ctx, t.x + shrink + 3, wy, 3, 4, '#ffd060')
        px(ctx, t.x + shrink + 3, wy, 1, 1, '#fff8c0')
        px(ctx, t.x + shrink + tw2 - 6, wy, 3, 4, '#ffd060')
        px(ctx, t.x + shrink + tw2 - 6, wy, 1, 1, '#fff8c0')
      }
    }

    // central keep (tallest, in middle)
    const kw = W * 0.32
    const kh = H * 0.82
    const kx = W / 2 - kw / 2
    const ky = H - kh - 3
    rrect(ctx, kx - 1, ky, kw + 2, kh, 3, col.dark)
    const kGrad = ctx.createLinearGradient(0, ky, 0, ky + kh)
    kGrad.addColorStop(0, col.light)
    kGrad.addColorStop(0.4, col.primary)
    kGrad.addColorStop(1, col.dark)
    rrect(ctx, kx, ky + 1, kw, kh - 1, 2, kGrad as any)
    px(ctx, kx, ky + 1, kw, 2, col.light)
    px(ctx, kx, ky + kh * 0.4, kw, 1, col.dark)
    px(ctx, kx, ky + kh * 0.4 + 1, kw, 1, col.trim)
    // keep crenellated top
    const kcn = 5
    for (let i = 0; i < kcn; i++) {
      if (i % 2 === 0) {
        const bx = kx + 1 + i * ((kw - 2) / kcn)
        rrect(ctx, bx, ky - 4, (kw - 2) / kcn - 1, 4, 1, col.dark)
        px(ctx, bx, ky - 4, (kw - 2) / kcn - 1, 1, col.light)
      }
    }
    // keep pyramidal roof
    ctx.fillStyle = '#3a2a1a'
    ctx.beginPath()
    ctx.moveTo(kx - 2, ky)
    ctx.lineTo(kx + kw / 2, ky - 14)
    ctx.lineTo(kx + kw + 2, ky)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#1a0e04'
    ctx.beginPath()
    ctx.moveTo(kx + kw / 2, ky - 14)
    ctx.lineTo(kx + kw + 2, ky)
    ctx.lineTo(kx + kw / 2 + 1, ky)
    ctx.closePath()
    ctx.fill()
    // roof ridge highlight
    px(ctx, kx + kw / 2, ky - 14, 1, 14, '#5a4a3a')

    // keep large stained-glass windows (glowing)
    for (const wy of [ky + kh * 0.18, ky + kh * 0.5]) {
      rrect(ctx, kx + 4, wy, 6, 8, 1, '#ffd060')
      px(ctx, kx + 4, wy, 6, 2, '#fff8c0')
      px(ctx, kx + 5, wy + 2, 1, 6, col.dark)
      rrect(ctx, kx + kw - 10, wy, 6, 8, 1, '#ffd060')
      px(ctx, kx + kw - 10, wy, 6, 2, '#fff8c0')
      px(ctx, kx + kw - 8, wy + 2, 1, 6, col.dark)
    }
    // central keep roundel (faction emblem)
    ctx.fillStyle = col.flag
    ctx.beginPath(); ctx.arc(W / 2, ky + kh * 0.32, 3, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = col.trim
    ctx.beginPath(); ctx.arc(W / 2, ky + kh * 0.32, 1.5, 0, Math.PI * 2); ctx.fill()

    // main gate (large arched double door)
    const gateW = W * 0.22
    const gateH = H * 0.2
    const gateX = W / 2 - gateW / 2
    const gateY = H - gateH - 3
    ctx.fillStyle = '#1a1208'
    ctx.beginPath()
    ctx.moveTo(gateX, gateY + gateH)
    ctx.lineTo(gateX, gateY + 4)
    ctx.quadraticCurveTo(gateX, gateY, gateX + gateW / 2, gateY)
    ctx.quadraticCurveTo(gateX + gateW, gateY, gateX + gateW, gateY + 4)
    ctx.lineTo(gateX + gateW, gateY + gateH)
    ctx.closePath()
    ctx.fill()
    // gate arch trim
    px(ctx, gateX, gateY + 1, gateW, 1, col.trim)
    // gate vertical seam + horizontal bands
    ctx.strokeStyle = col.dark; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(W / 2, gateY); ctx.lineTo(W / 2, gateY + gateH); ctx.stroke()
    for (let i = 1; i < 3; i++) {
      const by = gateY + (gateH * i / 3)
      ctx.beginPath(); ctx.moveTo(gateX, by); ctx.lineTo(gateX + gateW, by); ctx.stroke()
    }
    // gate rivets
    ctx.fillStyle = col.flag
    ctx.beginPath(); ctx.arc(gateX + 3, gateY + gateH * 0.5, 1, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(gateX + gateW - 3, gateY + gateH * 0.5, 1, 0, Math.PI * 2); ctx.fill()

    // large central flag on keep roof
    const flagX = kx + kw / 2
    const flagY = ky - 14
    px(ctx, flagX, flagY - 12, 1, 14, '#5a4a3a')
    ctx.fillStyle = col.flag
    ctx.beginPath()
    ctx.moveTo(flagX + 1, flagY - 12)
    ctx.lineTo(flagX + 9, flagY - 9)
    ctx.lineTo(flagX + 1, flagY - 6)
    ctx.closePath()
    ctx.fill()
    // flag emblem stripe
    px(ctx, flagX + 2, flagY - 10, 5, 1, col.trim)
    // flagpole finial
    ctx.fillStyle = col.trim
    ctx.beginPath(); ctx.arc(flagX, flagY - 13, 1, 0, Math.PI * 2); ctx.fill()

    // small wall torches/glow points along crenellations
    for (let i = 0; i < 4; i++) {
      const tx = 14 + i * (W - 28) / 3
      ctx.fillStyle = '#ffd060'
      ctx.beginPath(); ctx.arc(tx, wallTop + 6, 1.2, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff8c0'
      ctx.beginPath(); ctx.arc(tx, wallTop + 6, 0.5, 0, Math.PI * 2); ctx.fill()
    }
  } else if (type === 'barracks') {
    // ===== BARRACKS (2x2 = 80x80): Military compound — sloped roof,
    // antenna with flag, sandbags, door, windows, crates =====

    // back wall mass
    const wallTop = H * 0.36
    const wallBottom = H - 4
    rrect(ctx, 6, wallTop, W - 12, wallBottom - wallTop, 3, col.dark)
    const wallGrad = ctx.createLinearGradient(0, wallTop, 0, wallBottom)
    wallGrad.addColorStop(0, col.light)
    wallGrad.addColorStop(0.5, col.primary)
    wallGrad.addColorStop(1, col.dark)
    rrect(ctx, 8, wallTop + 2, W - 16, wallBottom - wallTop - 4, 2, wallGrad as any)

    // sloped roof (large triangular pediment)
    const roofPeakY = H * 0.18
    const roofBaseY = wallTop + 2
    ctx.fillStyle = '#2a1a0a'
    ctx.beginPath()
    ctx.moveTo(4, roofBaseY)
    ctx.lineTo(W / 2, roofPeakY)
    ctx.lineTo(W - 4, roofBaseY)
    ctx.closePath()
    ctx.fill()
    // roof highlight (left half — lit side)
    ctx.fillStyle = '#3a2a1a'
    ctx.beginPath()
    ctx.moveTo(4, roofBaseY)
    ctx.lineTo(W / 2, roofPeakY)
    ctx.lineTo(W / 2, roofBaseY + 2)
    ctx.closePath()
    ctx.fill()
    // roof ridge line
    px(ctx, W / 2, roofPeakY, 1, roofBaseY - roofPeakY, '#5a4a3a')
    // roof eave trim
    px(ctx, 4, roofBaseY, W - 8, 2, '#3a2a1a')
    px(ctx, 4, roofBaseY, W - 8, 1, col.dark)

    // roof skylight (small glowing slit)
    px(ctx, W / 2 - 4, roofPeakY + 6, 8, 2, '#ffd060')
    px(ctx, W / 2 - 4, roofPeakY + 6, 8, 1, '#fff8c0')

    // faction stripe (military band)
    px(ctx, 8, wallTop + 8, W - 16, 3, col.light)
    px(ctx, 8, wallTop + 11, W - 16, 1, col.trim)
    // small chevrons on stripe
    for (let i = 0; i < 4; i++) {
      const cx2 = 14 + i * (W - 28) / 3
      ctx.fillStyle = col.dark
      ctx.beginPath()
      ctx.moveTo(cx2, wallTop + 8)
      ctx.lineTo(cx2 + 2, wallTop + 11)
      ctx.lineTo(cx2 + 4, wallTop + 8)
      ctx.closePath()
      ctx.fill()
    }

    // tall antenna with flag (on roof peak)
    const antX = W / 2 - 8
    px(ctx, antX, H * 0.06, 1, roofPeakY - H * 0.06 + 2, '#6a6a6a')
    // antenna crossbars
    px(ctx, antX - 2, H * 0.1, 5, 1, '#6a6a6a')
    px(ctx, antX - 2, H * 0.14, 5, 1, '#6a6a6a')
    // antenna top beacon (glowing)
    ctx.fillStyle = '#ff4040'
    ctx.beginPath(); ctx.arc(antX, H * 0.05, 1.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffa0a0'
    ctx.beginPath(); ctx.arc(antX, H * 0.05, 0.6, 0, Math.PI * 2); ctx.fill()
    // flag on antenna
    ctx.fillStyle = col.flag
    ctx.beginPath()
    ctx.moveTo(antX + 1, H * 0.08)
    ctx.lineTo(antX + 7, H * 0.11)
    ctx.lineTo(antX + 1, H * 0.14)
    ctx.closePath()
    ctx.fill()
    px(ctx, antX + 2, H * 0.1, 4, 1, col.trim)

    // large central double door
    const doorW = W * 0.22
    const doorH = H * 0.22
    const doorX = W / 2 - doorW / 2
    const doorY = H - doorH - 3
    rrect(ctx, doorX, doorY, doorW, doorH, 2, '#1a1208')
    px(ctx, doorX, doorY, doorW, 1, col.trim)
    // door seam + panels
    ctx.strokeStyle = col.dark; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(W / 2, doorY); ctx.lineTo(W / 2, doorY + doorH); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(doorX, doorY + doorH / 2); ctx.lineTo(doorX + doorW, doorY + doorH / 2); ctx.stroke()
    // door handles
    px(ctx, W / 2 - 2, doorY + doorH / 2 - 1, 1, 2, col.flag)
    px(ctx, W / 2 + 1, doorY + doorH / 2 - 1, 1, 2, col.flag)

    // side windows (4 — 2 per side)
    const winY = wallTop + 20
    for (const wx of [12, 22, W - 26, W - 16]) {
      rrect(ctx, wx, winY, 6, 6, 1, '#ffd060')
      px(ctx, wx, winY, 6, 1, '#fff8c0')
      px(ctx, wx + 2, winY + 1, 1, 5, col.dark)
      // window frame
      px(ctx, wx - 1, winY - 1, 8, 1, col.dark)
    }

    // sandbag emplacements at front corners (defensive)
    for (const side of [0, 1]) {
      const baseX = side === 0 ? 2 : W - 18
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 3; i++) {
          const bx = baseX + i * 5
          const by = H - 8 - row * 4
          rrect(ctx, bx, by, 5, 4, 2, row === 0 ? '#8a7040' : '#7a6030')
          px(ctx, bx, by, 5, 1, '#a08450')
          // sandbag seam
          px(ctx, bx + 2, by + 1, 1, 2, '#5a4830')
        }
      }
    }

    // supply crates near door
    rrect(ctx, W / 2 - 14, H - 10, 4, 5, 1, '#6a4a2a')
    px(ctx, W / 2 - 14, H - 10, 4, 1, '#8a6a3a')
    px(ctx, W / 2 - 14, H - 8, 4, 1, '#4a3010')
    rrect(ctx, W / 2 + 10, H - 10, 4, 5, 1, '#6a4a2a')
    px(ctx, W / 2 + 10, H - 10, 4, 1, '#8a6a3a')
    px(ctx, W / 2 + 10, H - 8, 4, 1, '#4a3010')

    // small vent pipes on roof
    px(ctx, W * 0.3, roofPeakY + 4, 2, 4, '#5a5a5a')
    px(ctx, W * 0.3 - 1, roofPeakY + 4, 4, 1, '#3a3a3a')
    px(ctx, W * 0.7 - 2, roofPeakY + 4, 2, 4, '#5a5a5a')
    px(ctx, W * 0.7 - 3, roofPeakY + 4, 4, 1, '#3a3a3a')
  } else if (type === 'factory') {
    // ===== FACTORY (3x2 = 120x80): Industrial building — 2 chimneys + smoke,
    // sawtooth roof, big garage door, pipes, control room =====

    // main structure (wide)
    const wallTop = H * 0.4
    const wallBottom = H - 4
    rrect(ctx, 4, wallTop, W - 8, wallBottom - wallTop, 3, col.dark)
    const wallGrad = ctx.createLinearGradient(0, wallTop, 0, wallBottom)
    wallGrad.addColorStop(0, col.light)
    wallGrad.addColorStop(0.4, col.primary)
    wallGrad.addColorStop(1, col.dark)
    rrect(ctx, 6, wallTop + 2, W - 12, wallBottom - wallTop - 4, 2, wallGrad as any)
    px(ctx, 6, wallTop + 2, W - 12, 2, col.light)
    // horizontal accent stripe
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.55, W - 12, 2, col.dark)
    px(ctx, 6, wallTop + (wallBottom - wallTop) * 0.55 + 2, W - 12, 1, col.trim)

    // sawtooth roof (multiple triangular peaks spanning the wide factory)
    const numPeaks = 6
    const peakW = (W - 12) / numPeaks
    const peakBaseY = wallTop + 2
    const peakTopY = H * 0.24
    for (let i = 0; i < numPeaks; i++) {
      const bx = 6 + i * peakW
      // glass face of sawtooth (lit, lighter)
      ctx.fillStyle = col.light
      ctx.beginPath()
      ctx.moveTo(bx, peakBaseY)
      ctx.lineTo(bx + peakW * 0.55, peakTopY)
      ctx.lineTo(bx + peakW, peakBaseY)
      ctx.closePath()
      ctx.fill()
      // bright glazing bars
      ctx.strokeStyle = col.trim; ctx.lineWidth = 1
      for (let g = 1; g < 4; g++) {
        const gx2 = bx + (peakW * 0.55) * (g / 4)
        ctx.beginPath()
        ctx.moveTo(gx2, peakBaseY)
        ctx.lineTo(gx2 + peakW * 0.55 * 0.25, peakTopY + (peakBaseY - peakTopY) * (1 - g / 4))
        ctx.stroke()
      }
      // shadow face (right side of each sawtooth)
      ctx.fillStyle = col.dark
      ctx.beginPath()
      ctx.moveTo(bx + peakW * 0.55, peakTopY)
      ctx.lineTo(bx + peakW, peakTopY + (peakBaseY - peakTopY) * 0.4)
      ctx.lineTo(bx + peakW, peakBaseY)
      ctx.closePath()
      ctx.fill()
      // roof edge highlight
      px(ctx, bx, peakBaseY, peakW, 1, col.dark)
    }
    // sawtooth ridge rail
    ctx.strokeStyle = col.dark; ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < numPeaks; i++) {
      const bx = 6 + i * peakW
      if (i === 0) ctx.moveTo(bx, peakBaseY)
      ctx.lineTo(bx + peakW * 0.55, peakTopY)
      ctx.lineTo(bx + peakW, peakBaseY)
    }
    ctx.stroke()

    // 2 industrial chimneys (right side, with smoke)
    const chimneys = [
      { x: W - 36, h: H * 0.36 },
      { x: W - 20, h: H * 0.42 },
    ]
    for (const ch of chimneys) {
      const cyTop = H - ch.h - 4
      // chimney stack
      rrect(ctx, ch.x, cyTop, 8, ch.h, 1, '#4a4a4a')
      const chGrad = ctx.createLinearGradient(ch.x, 0, ch.x + 8, 0)
      chGrad.addColorStop(0, '#5a5a5a')
      chGrad.addColorStop(0.5, '#3a3a3a')
      chGrad.addColorStop(1, '#2a2a2a')
      rrect(ctx, ch.x + 1, cyTop, 6, ch.h, 1, chGrad as any)
      // chimney lip
      rrect(ctx, ch.x - 1, cyTop - 2, 10, 3, 1, '#2a2a2a')
      px(ctx, ch.x - 1, cyTop - 2, 10, 1, '#5a5a5a')
      // chimney bands
      px(ctx, ch.x - 1, cyTop + ch.h * 0.3, 10, 1, '#2a2a2a')
      px(ctx, ch.x - 1, cyTop + ch.h * 0.65, 10, 1, '#2a2a2a')
      // smoke puffs (rising)
      const sx2 = ch.x + 4
      ctx.fillStyle = 'rgba(200,200,200,0.7)'
      ctx.beginPath(); ctx.arc(sx2, cyTop - 4, 3, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(180,180,180,0.55)'
      ctx.beginPath(); ctx.arc(sx2 + 2, cyTop - 9, 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(210,210,210,0.4)'
      ctx.beginPath(); ctx.arc(sx2 - 1, cyTop - 14, 5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(220,220,220,0.25)'
      ctx.beginPath(); ctx.arc(sx2 + 3, cyTop - 20, 6, 0, Math.PI * 2); ctx.fill()
    }

    // big garage door (left, industrial roll-up)
    const gdX = 12
    const gdW = W * 0.22
    const gdH = H * 0.28
    const gdY = H - gdH - 3
    rrect(ctx, gdX, gdY, gdW, gdH, 2, '#1a1208')
    px(ctx, gdX, gdY, gdW, 1, col.trim)
    // door horizontal panel lines (roll-up segments)
    ctx.strokeStyle = col.dark; ctx.lineWidth = 1
    const panels = 5
    for (let i = 1; i < panels; i++) {
      const py = gdY + (gdH * i / panels)
      ctx.beginPath(); ctx.moveTo(gdX + 1, py); ctx.lineTo(gdX + gdW - 1, py); ctx.stroke()
      px(ctx, gdX + 1, py - 1, gdW - 2, 1, '#0a0604')
    }
    // door vertical center seam
    ctx.beginPath(); ctx.moveTo(gdX + gdW / 2, gdY); ctx.lineTo(gdX + gdW / 2, gdY + gdH); ctx.stroke()
    // door warning stripes (yellow-black hazard)
    for (let i = 0; i < 4; i++) {
      px(ctx, gdX + 2 + i * 6, gdY + gdH - 4, 3, 2, i % 2 === 0 ? '#ffd040' : '#1a1a1a')
    }

    // control room window (above door, glowing)
    rrect(ctx, gdX + 2, gdY - 12, gdW - 4, 8, 1, '#ffd060')
    px(ctx, gdX + 2, gdY - 12, gdW - 4, 2, '#fff8c0')
    px(ctx, gdX + gdW / 2 - 1, gdY - 12, 1, 8, col.dark)

    // pipes running along the structure (right of door, connecting to back)
    const pipeY1 = H * 0.65
    const pipeY2 = H * 0.55
    ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(gdX + gdW + 4, pipeY1)
    ctx.lineTo(gdX + gdW + 24, pipeY1)
    ctx.lineTo(gdX + gdW + 24, pipeY2)
    ctx.lineTo(W - 50, pipeY2)
    ctx.stroke()
    // pipe highlight
    ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(gdX + gdW + 4, pipeY1 - 1)
    ctx.lineTo(gdX + gdW + 24, pipeY1 - 1)
    ctx.lineTo(gdX + gdW + 24, pipeY2 - 1)
    ctx.stroke()
    // pipe joints (flanges)
    for (const jx of [gdX + gdW + 24, W - 60]) {
      rrect(ctx, jx - 1, pipeY2 - 3, 4, 6, 1, '#8a8a8a')
      px(ctx, jx - 1, pipeY2 - 3, 4, 1, '#a0a0a0')
    }
    // valve wheels along pipe
    for (const vx of [gdX + gdW + 10, W - 56]) {
      ctx.fillStyle = '#8a8a8a'
      ctx.beginPath(); ctx.arc(vx, pipeY1, 3, 0, Math.PI * 2); ctx.fill()
      px(ctx, vx - 3, pipeY1, 7, 1, '#5a5a5a')
      px(ctx, vx, pipeY1 - 3, 1, 7, '#5a5a5a')
      px(ctx, vx - 2, pipeY1 - 2, 1, 1, '#5a5a5a')
      px(ctx, vx + 2, pipeY1 - 2, 1, 1, '#5a5a5a')
      px(ctx, vx, pipeY1, 1.5, 1.5, '#b0b0b0')
    }

    // side windows (industrial, multi-pane)
    for (const wx of [W * 0.5, W * 0.62]) {
      rrect(ctx, wx, wallTop + 12, 10, 8, 1, '#ffd060')
      px(ctx, wx, wallTop + 12, 10, 2, '#fff8c0')
      ctx.strokeStyle = col.dark; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(wx + 5, wallTop + 12); ctx.lineTo(wx + 5, wallTop + 20); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(wx, wallTop + 16); ctx.lineTo(wx + 10, wallTop + 16); ctx.stroke()
    }

    // small loading ramp / floor accent near door
    px(ctx, gdX - 2, H - 5, gdW + 4, 2, '#3a3a3a')
    // hazard line on ground
    for (let i = 0; i < 8; i++) {
      px(ctx, gdX + i * 4, H - 3, 2, 1, i % 2 === 0 ? '#ffd040' : '#1a1a1a')
    }
  } else if (type === 'turret') {
    // ===== TURRET (1x1 = 40x40): Keep existing design, works at 1x1 =====
    const s = TILE_SIZE
    // base platform (octagonal pad)
    ctx.fillStyle = '#2a2a2a'
    ctx.beginPath(); ctx.ellipse(s/2, s/2 + 5, 11, 7, 0, 0, Math.PI*2); ctx.fill()
    px(ctx, s/2 - 9, s/2 + 4, 18, 5, col.dark)
    px(ctx, s/2 - 8, s/2 + 3, 16, 1, col.primary)
    px(ctx, s/2 - 8, s/2 + 8, 16, 1, '#1a1a1a')
    // turret dome (hemisphere)
    const domeGrad = ctx.createLinearGradient(0, s/2 - 6, 0, s/2 + 2)
    domeGrad.addColorStop(0, col.light)
    domeGrad.addColorStop(0.6, col.primary)
    domeGrad.addColorStop(1, col.dark)
    ctx.fillStyle = domeGrad as any
    ctx.beginPath(); ctx.arc(s/2, s/2, 7, Math.PI, 0); ctx.fill()
    // dome top highlight
    px(ctx, s/2 - 5, s/2 - 5, 10, 1, col.light)
    px(ctx, s/2 - 3, s/2 - 6, 6, 1, col.trim)
    // dome rivet ring
    for (let i = 0; i < 5; i++) {
      const rx = s/2 - 5 + i * 2.5
      px(ctx, rx, s/2 + 1, 1, 1, col.dark)
    }
    // cannon mantlet
    rrect(ctx, s/2 - 2, s/2 - 7, 4, 4, 1, '#2a2a2a')
    px(ctx, s/2 - 2, s/2 - 7, 4, 1, col.dark)
    // cannon barrel
    px(ctx, s/2 - 1, s/2 - 8, 3, 5, '#2a2a2a')
    px(ctx, s/2 - 2, s/2 - 9, 5, 1, '#1a1a1a')
    px(ctx, s/2 + 2, s/2 - 8, 1, 4, '#3a3a3a')
    // muzzle brake
    px(ctx, s/2 - 1, s/2 - 9, 3, 1, '#5a5a5a')
    px(ctx, s/2 - 2, s/2 - 10, 5, 1, '#3a3a3a')
    // faction emblem on dome
    ctx.fillStyle = col.flag
    ctx.beginPath(); ctx.arc(s/2, s/2 + 1, 1.5, 0, Math.PI * 2); ctx.fill()
    px(ctx, s/2, s/2 + 1, 1, 1, col.trim)
  } else if (type === 'refinery') {
    // ===== REFINERY (2x2 = 80x80): Spice processing — large dome tank,
    // pipes, valves, spice stain, windows =====

    // lower processing structure
    const wallTop = H * 0.5
    const wallBottom = H - 4
    rrect(ctx, 4, wallTop, W - 8, wallBottom - wallTop, 3, col.dark)
    const wallGrad = ctx.createLinearGradient(0, wallTop, 0, wallBottom)
    wallGrad.addColorStop(0, col.light)
    wallGrad.addColorStop(0.5, col.primary)
    wallGrad.addColorStop(1, col.dark)
    rrect(ctx, 6, wallTop + 2, W - 12, wallBottom - wallTop - 4, 2, wallGrad as any)
    // faction stripe
    px(ctx, 6, wallTop + 8, W - 12, 2, col.light)
    px(ctx, 6, wallTop + 10, W - 12, 1, col.trim)

    // large dome tank (central, sitting on top of structure)
    const domeR = W * 0.32
    const domeX = W / 2
    const domeY = wallTop + 2  // base of dome
    // tank base ring (cylinder section)
    rrect(ctx, domeX - domeR, domeY - domeR * 0.35, domeR * 2, domeR * 0.35, 2, '#5a5a5a')
    const tankGrad = ctx.createLinearGradient(0, domeY - domeR * 0.35, 0, domeY)
    tankGrad.addColorStop(0, '#7a7a7a')
    tankGrad.addColorStop(1, '#3a3a3a')
    rrect(ctx, domeX - domeR + 1, domeY - domeR * 0.35 + 1, domeR * 2 - 2, domeR * 0.35 - 2, 1, tankGrad as any)
    // tank band rivets
    for (let i = 0; i < 6; i++) {
      const rx = domeX - domeR + 4 + i * (domeR * 2 - 8) / 5
      px(ctx, rx, domeY - domeR * 0.18, 1, 1, '#2a2a2a')
    }
    // dome top (hemisphere)
    ctx.fillStyle = '#6a6a6a'
    ctx.beginPath()
    ctx.arc(domeX, domeY - domeR * 0.35, domeR, Math.PI, 0)
    ctx.closePath()
    ctx.fill()
    const domeGrad = ctx.createRadialGradient(domeX - domeR * 0.3, domeY - domeR * 0.35 - domeR * 0.5, 1, domeX, domeY - domeR * 0.35, domeR)
    domeGrad.addColorStop(0, '#b0b0b0')
    domeGrad.addColorStop(0.5, '#7a7a7a')
    domeGrad.addColorStop(1, '#4a4a4a')
    ctx.fillStyle = domeGrad
    ctx.beginPath()
    ctx.arc(domeX, domeY - domeR * 0.35, domeR, Math.PI, 0)
    ctx.closePath()
    ctx.fill()
    // dome horizontal band lines
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(domeX, domeY - domeR * 0.35, domeR * 0.7, Math.PI, 0); ctx.stroke()
    ctx.beginPath(); ctx.arc(domeX, domeY - domeR * 0.35, domeR * 0.4, Math.PI, 0); ctx.stroke()
    // dome vertical seams
    for (const a of [Math.PI * 1.25, Math.PI * 1.5, Math.PI * 1.75]) {
      ctx.beginPath()
      ctx.moveTo(domeX, domeY - domeR * 0.35)
      ctx.lineTo(domeX + Math.cos(a) * domeR, domeY - domeR * 0.35 + Math.sin(a) * domeR)
      ctx.stroke()
    }
    // dome top valve/outlet
    px(ctx, domeX - 3, domeY - domeR * 0.35 - domeR - 2, 6, 4, '#5a5a5a')
    px(ctx, domeX - 4, domeY - domeR * 0.35 - domeR - 1, 8, 1, '#3a3a3a')
    px(ctx, domeX - 2, domeY - domeR * 0.35 - domeR - 4, 4, 2, '#7a7a7a')
    // valve indicator light (faction color)
    ctx.fillStyle = col.flag
    ctx.beginPath(); ctx.arc(domeX, domeY - domeR * 0.35 - domeR - 5, 1.2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = col.trim
    ctx.beginPath(); ctx.arc(domeX, domeY - domeR * 0.35 - domeR - 5, 0.5, 0, Math.PI * 2); ctx.fill()

    // side pipes (left and right, connecting tank to structure)
    ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 3
    // left pipe route
    ctx.beginPath()
    ctx.moveTo(8, H * 0.7)
    ctx.lineTo(22, H * 0.7)
    ctx.lineTo(22, domeY - domeR * 0.2)
    ctx.lineTo(domeX - domeR, domeY - domeR * 0.2)
    ctx.stroke()
    // right pipe route
    ctx.beginPath()
    ctx.moveTo(W - 8, H * 0.7)
    ctx.lineTo(W - 22, H * 0.7)
    ctx.lineTo(W - 22, domeY - domeR * 0.2)
    ctx.lineTo(domeX + domeR, domeY - domeR * 0.2)
    ctx.stroke()
    // pipe highlights
    ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(8, H * 0.7 - 1); ctx.lineTo(22, H * 0.7 - 1)
    ctx.moveTo(W - 8, H * 0.7 - 1); ctx.lineTo(W - 22, H * 0.7 - 1)
    ctx.stroke()
    // pipe joints (elbows)
    for (const jx of [22, W - 22]) {
      rrect(ctx, jx - 2, H * 0.7 - 3, 4, 6, 1, '#8a8a8a')
      px(ctx, jx - 2, H * 0.7 - 3, 4, 1, '#a0a0a0')
    }

    // valve wheels (large, on either side)
    for (const vx of [14, W - 14]) {
      const vy = H * 0.78
      ctx.fillStyle = '#8a8a8a'
      ctx.beginPath(); ctx.arc(vx, vy, 5, 0, Math.PI * 2); ctx.fill()
      // wheel spokes
      ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(vx, vy)
        ctx.lineTo(vx + Math.cos(a) * 5, vy + Math.sin(a) * 5)
        ctx.stroke()
      }
      px(ctx, vx - 5, vy, 11, 1, '#5a5a5a')
      px(ctx, vx, vy - 5, 1, 11, '#5a5a5a')
      // hub
      ctx.fillStyle = '#a0a0a0'
      ctx.beginPath(); ctx.arc(vx, vy, 1.5, 0, Math.PI * 2); ctx.fill()
    }

    // windows on lower structure
    for (const wx of [12, W - 16]) {
      rrect(ctx, wx, H * 0.62, 6, 6, 1, '#ffd060')
      px(ctx, wx, H * 0.62, 6, 1, '#fff8c0')
      px(ctx, wx + 2, H * 0.62, 1, 6, col.dark)
      px(ctx, wx - 1, H * 0.62 - 1, 8, 1, col.dark)
    }

    // central access door
    rrect(ctx, W / 2 - 4, H - 12, 8, 9, 2, '#1a1208')
    px(ctx, W / 2 - 4, H - 12, 8, 1, col.trim)
    px(ctx, W / 2, H - 12, 1, 9, col.dark)
    px(ctx, W / 2 - 2, H - 8, 1, 1, col.flag)

    // spice stain (orange spill on ground in front of structure)
    ctx.fillStyle = 'rgba(232, 93, 47, 0.55)'
    ctx.beginPath(); ctx.ellipse(W / 2 + 10, H - 3, 9, 2.5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255, 150, 80, 0.45)'
    ctx.beginPath(); ctx.ellipse(W / 2 + 8, H - 3, 5, 1.5, 0, 0, Math.PI * 2); ctx.fill()
    // spice crystal specks
    for (let i = 0; i < 5; i++) {
      const sx2 = W / 2 + 4 + rng() * 14
      const sy2 = H - 4 + rng() * 2
      ctx.fillStyle = rng() > 0.5 ? '#e85d2f' : '#ff9060'
      ctx.fillRect(sx2, sy2, 1, 1)
    }
  } else if (type === 'generator') {
    // ===== GENERATOR (2x2 = 80x80): Power plant — glowing energy core,
    // cooling fins, lightning arcs, vents, power conduits =====

    // base platform / housing
    const wallTop = H * 0.42
    const wallBottom = H - 4
    rrect(ctx, 4, wallTop, W - 8, wallBottom - wallTop, 3, col.dark)
    const wallGrad = ctx.createLinearGradient(0, wallTop, 0, wallBottom)
    wallGrad.addColorStop(0, col.light)
    wallGrad.addColorStop(0.5, col.primary)
    wallGrad.addColorStop(1, col.dark)
    rrect(ctx, 6, wallTop + 2, W - 12, wallBottom - wallTop - 4, 2, wallGrad as any)
    px(ctx, 6, wallTop + 2, W - 12, 2, col.light)

    // cooling fins (left and right vertical radiator stacks)
    for (const side of [0, 1]) {
      const fx = side === 0 ? 8 : W - 14
      rrect(ctx, fx, wallTop + 4, 6, wallBottom - wallTop - 8, 1, col.dark)
      const fGrad = ctx.createLinearGradient(fx, 0, fx + 6, 0)
      fGrad.addColorStop(0, col.light)
      fGrad.addColorStop(1, col.dark)
      rrect(ctx, fx + 1, wallTop + 5, 4, wallBottom - wallTop - 10, 1, fGrad as any)
      // fin slits (radiator lines)
      for (let i = 0; i < 8; i++) {
        const fy = wallTop + 6 + i * ((wallBottom - wallTop - 12) / 7)
        px(ctx, fx, fy, 6, 1, col.dark)
      }
      // top cap
      px(ctx, fx, wallTop + 4, 6, 1, col.trim)
      // top vent glow
      ctx.fillStyle = '#ffd060'
      ctx.beginPath(); ctx.arc(fx + 3, wallTop + 4, 1, 0, Math.PI * 2); ctx.fill()
    }

    // top vent assembly (horizontal slats)
    rrect(ctx, W * 0.22, wallTop - 4, W * 0.56, 6, 1, col.dark)
    px(ctx, W * 0.22, wallTop - 4, W * 0.56, 1, col.trim)
    for (let i = 0; i < 6; i++) {
      const vx = W * 0.22 + 2 + i * ((W * 0.56 - 4) / 6)
      px(ctx, vx, wallTop - 3, 5, 1, col.light)
      px(ctx, vx, wallTop - 1, 5, 1, col.dark)
    }

    // central power core (large glowing radial gradient)
    const coreX = W / 2
    const coreY = wallTop + (wallBottom - wallTop) * 0.55
    const coreR = W * 0.22
    const coreGrad = ctx.createRadialGradient(coreX, coreY, 1, coreX, coreY, coreR + 8)
    coreGrad.addColorStop(0, '#fff8a0')
    coreGrad.addColorStop(0.15, '#ffe060')
    coreGrad.addColorStop(0.4, '#ff9020')
    coreGrad.addColorStop(0.7, 'rgba(255,144,32,0.6)')
    coreGrad.addColorStop(1, 'rgba(255,144,32,0)')
    ctx.fillStyle = coreGrad
    ctx.fillRect(coreX - coreR - 8, coreY - coreR - 8, (coreR + 8) * 2, (coreR + 8) * 2)

    // core containment ring (mechanical housing around the glow)
    ctx.strokeStyle = col.dark; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(coreX, coreY, coreR * 0.85, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = col.trim; ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(coreX, coreY, coreR * 0.85, 0, Math.PI * 2); ctx.stroke()
    // ring bolt mounts
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const bx = coreX + Math.cos(a) * coreR * 0.85
      const by = coreY + Math.sin(a) * coreR * 0.85
      ctx.fillStyle = '#5a5a5a'
      ctx.beginPath(); ctx.arc(bx, by, 1.5, 0, Math.PI * 2); ctx.fill()
      px(ctx, bx, by, 1, 1, col.dark)
    }

    // core inner (bright plasma)
    const innerGrad = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreR * 0.5)
    innerGrad.addColorStop(0, '#ffffff')
    innerGrad.addColorStop(0.4, '#fff8a0')
    innerGrad.addColorStop(1, 'rgba(255,224,96,0)')
    ctx.fillStyle = innerGrad
    ctx.beginPath(); ctx.arc(coreX, coreY, coreR * 0.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(coreX, coreY, coreR * 0.18, 0, Math.PI * 2); ctx.fill()

    // energy arcs (lightning bolts radiating from core)
    ctx.strokeStyle = '#fff8a0'; ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    // top arc to pylon
    ctx.beginPath()
    ctx.moveTo(coreX, coreY - coreR * 0.85)
    ctx.lineTo(coreX - 3, coreY - coreR * 1.0)
    ctx.lineTo(coreX + 2, coreY - coreR * 1.15)
    ctx.lineTo(coreX - 1, coreY - coreR * 1.3)
    ctx.stroke()
    // left arc
    ctx.beginPath()
    ctx.moveTo(coreX - coreR * 0.85, coreY)
    ctx.lineTo(coreX - coreR * 1.0, coreY - 3)
    ctx.lineTo(coreX - coreR * 1.15, coreY + 2)
    ctx.lineTo(coreX - coreR * 1.25, coreY - 1)
    ctx.stroke()
    // right arc
    ctx.beginPath()
    ctx.moveTo(coreX + coreR * 0.85, coreY)
    ctx.lineTo(coreX + coreR * 1.0, coreY + 3)
    ctx.lineTo(coreX + coreR * 1.15, coreY - 2)
    ctx.lineTo(coreX + coreR * 1.25, coreY + 1)
    ctx.stroke()
    // bottom arc
    ctx.beginPath()
    ctx.moveTo(coreX, coreY + coreR * 0.85)
    ctx.lineTo(coreX + 3, coreY + coreR * 1.0)
    ctx.lineTo(coreX - 2, coreY + coreR * 1.1)
    ctx.stroke()
    ctx.lineCap = 'butt'

    // energy pylon / antenna (top, conducting power up)
    px(ctx, coreX - 1, H * 0.08, 2, wallTop - H * 0.08 - 4, '#5a5a5a')
    px(ctx, coreX - 3, H * 0.1, 6, 1, '#5a5a5a')
    px(ctx, coreX - 3, H * 0.14, 6, 1, '#5a5a5a')
    // pylon ceramic insulators
    for (const iy of [H * 0.12, H * 0.16, H * 0.2]) {
      rrect(ctx, coreX - 2, iy, 4, 2, 1, '#d0d0d0')
      px(ctx, coreX - 2, iy, 4, 1, '#fff')
    }
    // pylon tip glow (charging)
    ctx.fillStyle = '#ffe060'
    ctx.beginPath(); ctx.arc(coreX, H * 0.07, 2.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff8a0'
    ctx.beginPath(); ctx.arc(coreX, H * 0.07, 1, 0, Math.PI * 2); ctx.fill()

    // power conduit lights (small LEDs along the bottom)
    for (let i = 0; i < 5; i++) {
      const lx = 20 + i * (W - 40) / 4
      ctx.fillStyle = '#ffd060'
      ctx.beginPath(); ctx.arc(lx, H - 7, 1.8, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff8c0'
      ctx.beginPath(); ctx.arc(lx, H - 7, 0.7, 0, Math.PI * 2); ctx.fill()
    }

    // small status display panel
    rrect(ctx, 16, wallTop + 10, 8, 5, 1, '#1a1a1a')
    px(ctx, 17, wallTop + 11, 6, 1, '#22c55e')
    px(ctx, 17, wallTop + 13, 4, 1, '#22c55e')
    rrect(ctx, W - 24, wallTop + 10, 8, 5, 1, '#1a1a1a')
    px(ctx, W - 23, wallTop + 11, 6, 1, '#22c55e')
    px(ctx, W - 23, wallTop + 13, 4, 1, '#eab308')

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

export function drawUnit(ctx: CanvasRenderingContext2D, type: UnitType, faction: Faction, px_: number, py_: number, bob = 0) {
  const img = renderUnit(type, faction)
  // bob: slight vertical offset for motion feel
  ctx.drawImage(img, px_ - TILE_SIZE / 2, py_ - TILE_SIZE / 2 + bob)
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
