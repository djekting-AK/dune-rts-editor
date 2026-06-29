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

// ---------- Terrain tile rendering ----------
type RenderFn = (ctx: CanvasRenderingContext2D, s: number, variant: number, animPhase?: number) => void

const TERRAIN_RENDERERS: Record<number, RenderFn> = {
  // Void
  0: (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#0d0d0d'); g.addColorStop(1, '#000')
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
  },
  // Sand — warm gradient, grain texture, ripples
  1: (ctx, s, v) => {
    const g = ctx.createLinearGradient(0, 0, s, s)
    g.addColorStop(0, '#e8b85a'); g.addColorStop(0.5, '#dba040'); g.addColorStop(1, '#c0822c')
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
    const rng = mulberry(v * 9999 + 1)
    // grain specks
    for (let i = 0; i < 14; i++) {
      const x = rng() * s, y = rng() * s, sz = rng() > 0.6 ? 2 : 1
      px(ctx, x, y, sz, sz, rng() > 0.5 ? '#f0c46a' : '#a86d20')
    }
    // wind ripples
    ctx.strokeStyle = 'rgba(245,200,110,0.35)'; ctx.lineWidth = 1
    const yo = (v % 3) * 3
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.moveTo(3, 8 + i * 10 + yo)
      ctx.quadraticCurveTo(s/2, 5 + i*10 + yo, s - 3, 8 + i*10 + yo)
      ctx.stroke()
    }
    // soft shadow edge
    ctx.fillStyle = 'rgba(120,70,20,0.15)'; ctx.fillRect(0, s-3, s, 3)
  },
  // Dunes — crescent shapes with shadows
  2: (ctx, s, v) => {
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#c89238'); g.addColorStop(1, '#a87218')
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
    // crescent dune (lit side)
    ctx.fillStyle = '#e0a848'
    const dy = (v % 3) * 4 + 6
    ctx.beginPath()
    ctx.moveTo(3, dy + 8)
    ctx.quadraticCurveTo(s/2, dy - 2, s - 3, dy + 8)
    ctx.quadraticCurveTo(s/2, dy + 4, 3, dy + 8)
    ctx.fill()
    // shadow side
    ctx.fillStyle = '#8a5a14'
    ctx.beginPath()
    ctx.moveTo(3, dy + 9)
    ctx.quadraticCurveTo(s/2, dy + 5, s - 3, dy + 9)
    ctx.lineTo(s - 3, dy + 13)
    ctx.quadraticCurveTo(s/2, dy + 9, 3, dy + 13)
    ctx.fill()
    // second dune
    ctx.fillStyle = '#d09838'
    ctx.beginPath()
    ctx.moveTo(2, s - 10)
    ctx.quadraticCurveTo(s/2, s - 16, s - 2, s - 10)
    ctx.quadraticCurveTo(s/2, s - 12, 2, s - 10)
    ctx.fill()
    // highlights
    px(ctx, 6, dy + 6, s - 12, 1, '#f0c870')
  },
  // Rock — granite with cracks and moss
  3: (ctx, s, v) => {
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#9a948a'); g.addColorStop(1, '#6a6258')
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
    // rock facets
    const rng = mulberry(v * 5555 + 7)
    ctx.fillStyle = '#7a7268'
    for (let i = 0; i < 5; i++) {
      const x = rng() * (s - 8), y = rng() * (s - 8)
      ctx.beginPath()
      ctx.moveTo(x, y); ctx.lineTo(x + 4 + rng()*4, y + 2); ctx.lineTo(x + 2, y + 5 + rng()*3)
      ctx.closePath(); ctx.fill()
    }
    // cracks
    ctx.strokeStyle = '#3a342a'; ctx.lineWidth = 1.2
    ctx.beginPath()
    const x1 = rng() * s, y1 = rng() * s
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 + (rng()-0.5) * s * 0.5, y1 + (rng()-0.5) * s * 0.5)
    ctx.stroke()
    // moss patches
    ctx.fillStyle = 'rgba(90,110,50,0.5)'
    px(ctx, 3, s - 6, 5, 3, 'rgba(90,110,50,0.5)')
    px(ctx, s - 9, 4, 4, 2, 'rgba(90,110,50,0.4)')
    // top highlight
    ctx.fillStyle = 'rgba(180,175,165,0.4)'; ctx.fillRect(2, 2, s - 4, 1)
  },
  // Mountain — 3D peak with snow
  4: (ctx, s, v) => {
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#5a5248'); g.addColorStop(1, '#3a3228')
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
    // back peak (lighter, distant)
    ctx.fillStyle = '#7a6e60'
    ctx.beginPath()
    ctx.moveTo(s * 0.7, 4); ctx.lineTo(s - 3, s - 3); ctx.lineTo(s * 0.5, s - 3)
    ctx.closePath(); ctx.fill()
    // main peak
    ctx.fillStyle = '#6a5e50'
    ctx.beginPath()
    ctx.moveTo(s * 0.5, 2); ctx.lineTo(s - 4, s - 4); ctx.lineTo(4, s - 4)
    ctx.closePath(); ctx.fill()
    // lit face
    ctx.fillStyle = '#8a7e70'
    ctx.beginPath()
    ctx.moveTo(s * 0.5, 2); ctx.lineTo(4, s - 4); ctx.lineTo(s * 0.5, s - 4)
    ctx.closePath(); ctx.fill()
    // snow cap
    ctx.fillStyle = '#f0f0f0'
    ctx.beginPath()
    ctx.moveTo(s * 0.5, 2); ctx.lineTo(s * 0.58, 9); ctx.lineTo(s * 0.5, 7); ctx.lineTo(s * 0.42, 9)
    ctx.closePath(); ctx.fill()
    // shadow face
    ctx.fillStyle = '#2e2620'
    ctx.beginPath()
    ctx.moveTo(s * 0.5, 2); ctx.lineTo(s - 4, s - 4); ctx.lineTo(s * 0.5, s - 4)
    ctx.closePath(); ctx.fill()
    // ridge line
    ctx.strokeStyle = '#1a1410'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(s * 0.5, 2); ctx.lineTo(s - 4, s - 4); ctx.stroke()
  },
  // Spice — glowing orange crystals on sand
  5: (ctx, s, v) => {
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#e8b85a'); g.addColorStop(1, '#c0822c')
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
    const rng = mulberry(v * 3333 + 11)
    for (let i = 0; i < 9; i++) {
      const cx = 3 + rng() * (s - 8), cy = 3 + rng() * (s - 8), sz = 2 + Math.floor(rng() * 3)
      // glow halo
      const rg = ctx.createRadialGradient(cx + sz/2, cy + sz/2, 0, cx + sz/2, cy + sz/2, sz + 3)
      rg.addColorStop(0, 'rgba(255,140,60,0.6)'); rg.addColorStop(1, 'rgba(255,140,60,0)')
      ctx.fillStyle = rg; ctx.fillRect(cx - 3, cy - 3, sz + 6, sz + 6)
      // crystal
      ctx.fillStyle = '#e85d2f'; ctx.fillRect(cx, cy, sz, sz)
      px(ctx, cx, cy, Math.ceil(sz/2), Math.ceil(sz/2), '#ff9060')
      px(ctx, cx + sz - 1, cy + sz - 1, 1, 1, '#a83010')
    }
  },
  // Rich spice — denser, brighter
  6: (ctx, s, v) => {
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#d89838'); g.addColorStop(1, '#a86818')
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
    const rng = mulberry(v * 2222 + 13)
    for (let i = 0; i < 14; i++) {
      const cx = 2 + rng() * (s - 6), cy = 2 + rng() * (s - 6), sz = 2 + Math.floor(rng() * 3)
      const rg = ctx.createRadialGradient(cx + sz/2, cy + sz/2, 0, cx + sz/2, cy + sz/2, sz + 4)
      rg.addColorStop(0, 'rgba(255,80,40,0.7)'); rg.addColorStop(1, 'rgba(255,80,40,0)')
      ctx.fillStyle = rg; ctx.fillRect(cx - 4, cy - 4, sz + 8, sz + 8)
      ctx.fillStyle = '#d83d1a'; ctx.fillRect(cx, cy, sz, sz)
      px(ctx, cx, cy, Math.ceil(sz/2), Math.ceil(sz/2), '#ff7050')
    }
  },
  // Water — animated ripples (uses animPhase)
  7: (ctx, s, v, animPhase = 0) => {
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#3aa0c8'); g.addColorStop(0.5, '#2a7ea0'); g.addColorStop(1, '#1a5e80')
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
    // animated ripples
    const phase = (animPhase * 0.5 + v) % 8
    ctx.fillStyle = 'rgba(150,220,240,0.45)'
    for (let i = 0; i < 4; i++) {
      const yo = (i * 9 + phase) % s
      ctx.fillRect(3, yo, 10, 1)
      ctx.fillRect(s - 14, (yo + 4) % s, 8, 1)
    }
    // shimmer
    ctx.fillStyle = 'rgba(200,240,255,0.6)'
    const sx = (phase * 2) % s
    px(ctx, sx, 3, 2, 1, 'rgba(220,245,255,0.7)')
    px(ctx, (sx + s/2) % s, s - 4, 2, 1, 'rgba(220,245,255,0.5)')
  },
}

// ---------- Terrain cache (4 variants each, water rendered live) ----------
const VARIANTS = 4
const terrainCache = new Map<string, HTMLCanvasElement>()

export function getTerrainTile(tileId: number, variant: number): HTMLCanvasElement {
  const key = `${tileId}_${variant}`
  let c = terrainCache.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = TILE_SIZE; c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  const fn = TERRAIN_RENDERERS[tileId] || TERRAIN_RENDERERS[0]
  fn(ctx, TILE_SIZE, variant)
  terrainCache.set(key, c)
  return c
}

// animated water tile (not cached)
function drawWaterTile(ctx: CanvasRenderingContext2D, gx: number, gy: number, variant: number, animPhase: number) {
  ctx.save()
  ctx.translate(gx * TILE_SIZE, gy * TILE_SIZE)
  TERRAIN_RENDERERS[7](ctx, TILE_SIZE, variant, animPhase)
  ctx.restore()
}

export function drawTerrain(ctx: CanvasRenderingContext2D, tileId: number, gx: number, gy: number, animPhase = 0) {
  if (tileId === 7) {
    drawWaterTile(ctx, gx, gy, Math.floor(hash(gx, gy) * VARIANTS), animPhase)
    return
  }
  const variant = Math.floor(hash(gx, gy) * VARIANTS)
  const tile = getTerrainTile(tileId, variant)
  ctx.drawImage(tile, gx * TILE_SIZE, gy * TILE_SIZE)
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
  const fn = TERRAIN_RENDERERS[tileId] || TERRAIN_RENDERERS[0]
  fn(ctx, TILE_SIZE, 0)
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
