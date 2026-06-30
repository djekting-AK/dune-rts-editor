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

export function drawBuilding(ctx: CanvasRenderingContext2D, type: BuildingType, faction: Faction, px_: number, py_: number, w = 1, h = 1) {
  const img = renderBuilding(type, faction, w, h)
  // Position the image so:
  //   - the diamond's horizontal CENTER sits at the center of the building's
  //     tile footprint (px_ + w*TILE_SIZE/2),
  //   - the diamond's BOTTOM corner sits at the bottom of the tile footprint
  //     (py_ + h*TILE_SIZE), so the building rises upward from the bottom of
  //     its tile area (walls + roof + features extend upward, covering the
  //     rest of the tile and extending slightly above into the tile row above).
  // In the rendered image, the diamond's center x = img.width/2 and the
  // diamond's bottom y = img.height (i.e., the diamond touches the bottom
  // edge of the canvas). So:
  //   drawX + img.width/2     = px_ + w*TILE_SIZE/2
  //   drawY + img.height      = py_ + h*TILE_SIZE
  const drawX = px_ + (w * TILE_SIZE - img.width) / 2
  const drawY = py_ + h * TILE_SIZE - img.height
  ctx.drawImage(img, drawX, drawY)
}

// ---------- Unit rendering (detailed, with bob animation) ----------
export type UnitType = 'harvester' | 'soldier' | 'tank'

const unitCache = new Map<string, HTMLCanvasElement>()
// 8-directional pre-rendered vehicle sprites (harvester, tank).
// Soldiers do not rotate (they always face the player).
const unitDirCache = new Map<string, HTMLCanvasElement>()

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

// Pre-render a vehicle sprite rotated to one of 8 cardinal/intercardinal
// directions. dir: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE (clockwise
// in canvas coords because +Y is down). The base renderUnit() draws vehicles
// facing right (East, dir 0); we rotate that sprite around the tile center.
function renderUnitDirection(type: UnitType, faction: Faction, dir: number): HTMLCanvasElement {
  const key = `${type}_${faction}_${dir}`
  let c = unitDirCache.get(key)
  if (c) return c
  const base = renderUnit(type, faction) // existing function, draws facing right (East)
  c = document.createElement('canvas')
  c.width = TILE_SIZE; c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.translate(TILE_SIZE / 2, TILE_SIZE / 2)
  ctx.rotate(dir * Math.PI / 4)
  ctx.drawImage(base, -TILE_SIZE / 2, -TILE_SIZE / 2)
  unitDirCache.set(key, c)
  return c
}

export function drawUnit(ctx: CanvasRenderingContext2D, type: UnitType, faction: Faction, px_: number, py_: number, bob = 0, facing = 0) {
  if (type === 'soldier') {
    // soldiers don't rotate (they face the player), just draw with bob
    const img = renderUnit(type, faction)
    ctx.drawImage(img, px_ - TILE_SIZE / 2, py_ - TILE_SIZE / 2 + bob)
  } else {
    // vehicles (harvester, tank) use 8-directional pre-rendered sprites.
    // Normalize facing angle to [0, 2*PI), then snap to nearest 45° step.
    // 0 = East (right), PI/2 = South (canvas down), PI = West, 3PI/2 = North.
    // dir: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE.
    let angle = facing
    while (angle < 0) angle += Math.PI * 2
    while (angle >= Math.PI * 2) angle -= Math.PI * 2
    const dir = Math.round(angle / (Math.PI / 4)) % 8
    const img = renderUnitDirection(type, faction, dir)
    ctx.drawImage(img, px_ - TILE_SIZE / 2, py_ - TILE_SIZE / 2 + bob)
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
  // Dimetric images are roughly square-ish; scale to fit the larger dimension
  // and center the image inside the preview square.
  const scale = size / Math.max(img.width, img.height)
  ctx.scale(scale, scale)
  const drawX = (size / scale - img.width) / 2
  const drawY = (size / scale - img.height) / 2
  ctx.drawImage(img, drawX, drawY)
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
