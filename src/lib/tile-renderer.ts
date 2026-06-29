// tile-renderer.ts — Beautiful procedural pixel-art tile rendering with cache

export const TILE_SIZE = 28

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

// ---------- Pixel helper ----------
function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

// ---------- Terrain tile rendering ----------
type RenderFn = (ctx: CanvasRenderingContext2D, s: number, variant: number) => void

const TERRAIN_RENDERERS: Record<number, RenderFn> = {
  // Void
  0: (ctx, s) => {
    px(ctx, 0, 0, s, s, '#0a0a0a')
  },
  // Sand
  1: (ctx, s, v) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s)
    grad.addColorStop(0, '#e0ad48')
    grad.addColorStop(1, '#c89030')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, s, s)
    // specks
    const rng = mulberry(v * 9999 + 1)
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(rng() * (s - 2))
      const y = Math.floor(rng() * (s - 2))
      px(ctx, x, y, 2, 2, rng() > 0.5 ? '#d4a040' : '#b87828')
    }
    // dune ripple
    if (v % 2 === 0) {
      ctx.fillStyle = 'rgba(232,184,90,0.35)'
      ctx.fillRect(2, s * 0.6, s - 4, 1)
    }
  },
  // Dunes
  2: (ctx, s, v) => {
    px(ctx, 0, 0, s, s, '#b8842e')
    // crescent dune
    ctx.fillStyle = '#d4a045'
    const dy = (v % 3) * 3 + 4
    ctx.beginPath()
    ctx.moveTo(2, dy + 6)
    ctx.quadraticCurveTo(s / 2, dy, s - 2, dy + 6)
    ctx.lineTo(s - 2, dy + 7)
    ctx.quadraticCurveTo(s / 2, dy + 2, 2, dy + 7)
    ctx.fill()
    // shadow
    ctx.fillStyle = '#8a6020'
    ctx.fillRect(2, dy + 8, s - 4, 2)
    // specks
    const rng = mulberry(v * 7777 + 3)
    for (let i = 0; i < 4; i++) {
      px(ctx, Math.floor(rng() * s), Math.floor(rng() * s), 1, 1, '#9a6a1e')
    }
  },
  // Rock
  3: (ctx, s, v) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s)
    grad.addColorStop(0, '#8a8a8a')
    grad.addColorStop(1, '#6a6a6a')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, s, s)
    // cracks
    ctx.strokeStyle = '#4a4a4a'
    ctx.lineWidth = 1
    ctx.beginPath()
    const rng = mulberry(v * 5555 + 7)
    const x1 = rng() * s, y1 = rng() * s
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 + (rng() - 0.5) * s * 0.6, y1 + (rng() - 0.5) * s * 0.6)
    ctx.stroke()
    // highlights
    px(ctx, 3, 2, 3, 1, '#a0a0a0')
    px(ctx, s - 7, s - 4, 4, 1, '#5a5a5a')
    // scattered rock bits
    for (let i = 0; i < 3; i++) {
      px(ctx, Math.floor(rng() * (s - 3)) + 1, Math.floor(rng() * (s - 3)) + 1, 2, 2, '#5a5a5a')
    }
  },
  // Mountain
  4: (ctx, s, v) => {
    px(ctx, 0, 0, s, s, '#4a4a4a')
    // peak
    ctx.fillStyle = '#6a6a6a'
    ctx.beginPath()
    ctx.moveTo(s * 0.5, 3)
    ctx.lineTo(s - 3, s - 3)
    ctx.lineTo(3, s - 3)
    ctx.closePath()
    ctx.fill()
    // snow cap
    ctx.fillStyle = '#e8e8e8'
    ctx.beginPath()
    ctx.moveTo(s * 0.5, 3)
    ctx.lineTo(s * 0.62, 8)
    ctx.lineTo(s * 0.5, 6)
    ctx.lineTo(s * 0.38, 8)
    ctx.closePath()
    ctx.fill()
    // shadow
    ctx.fillStyle = '#2e2e2e'
    ctx.beginPath()
    ctx.moveTo(s * 0.5, 3)
    ctx.lineTo(s - 3, s - 3)
    ctx.lineTo(s * 0.5, s - 3)
    ctx.closePath()
    ctx.fill()
  },
  // Spice
  5: (ctx, s, v) => {
    // sand base
    const grad = ctx.createLinearGradient(0, 0, 0, s)
    grad.addColorStop(0, '#e0ad48')
    grad.addColorStop(1, '#c89030')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, s, s)
    // spice crystals
    const rng = mulberry(v * 3333 + 11)
    for (let i = 0; i < 7; i++) {
      const cx = 2 + Math.floor(rng() * (s - 4))
      const cy = 2 + Math.floor(rng() * (s - 4))
      const sz = rng() > 0.6 ? 3 : 2
      // glow
      ctx.fillStyle = 'rgba(255,120,60,0.25)'
      ctx.fillRect(cx - 1, cy - 1, sz + 2, sz + 2)
      // crystal
      ctx.fillStyle = '#e85d2f'
      ctx.fillRect(cx, cy, sz, sz)
      px(ctx, cx, cy, 1, 1, '#ff8a5a')
    }
  },
  // Rich spice
  6: (ctx, s, v) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s)
    grad.addColorStop(0, '#d8a040')
    grad.addColorStop(1, '#b87828')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, s, s)
    const rng = mulberry(v * 2222 + 13)
    for (let i = 0; i < 10; i++) {
      const cx = 1 + Math.floor(rng() * (s - 3))
      const cy = 1 + Math.floor(rng() * (s - 3))
      const sz = rng() > 0.5 ? 3 : 2
      ctx.fillStyle = 'rgba(255,80,40,0.3)'
      ctx.fillRect(cx - 1, cy - 1, sz + 2, sz + 2)
      ctx.fillStyle = '#c43d1a'
      ctx.fillRect(cx, cy, sz, sz)
      px(ctx, cx, cy, 1, 1, '#ff6030')
    }
  },
  // Water
  7: (ctx, s, v) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s)
    grad.addColorStop(0, '#3a8eae')
    grad.addColorStop(1, '#1e6080')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, s, s)
    // ripples
    ctx.fillStyle = 'rgba(120,200,230,0.4)'
    const yo = (v % 3) * 3
    ctx.fillRect(3, 6 + yo, 8, 1)
    ctx.fillRect(s - 10, 12 + yo, 7, 1)
    ctx.fillRect(5, 18 + yo, 6, 1)
    px(ctx, 2, 3, 2, 1, 'rgba(180,230,250,0.5)')
  },
}

function mulberry(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- Terrain cache (4 variants each) ----------
const VARIANTS = 4
const terrainCache = new Map<string, HTMLCanvasElement>()

export function getTerrainTile(tileId: number, variant: number): HTMLCanvasElement {
  const key = `${tileId}_${variant}`
  let c = terrainCache.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = TILE_SIZE
  c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const fn = TERRAIN_RENDERERS[tileId] || TERRAIN_RENDERERS[0]
  fn(ctx, TILE_SIZE, variant)
  terrainCache.set(key, c)
  return c
}

export function drawTerrain(ctx: CanvasRenderingContext2D, tileId: number, gx: number, gy: number) {
  const variant = Math.floor(hash(gx, gy) * VARIANTS)
  const tile = getTerrainTile(tileId, variant)
  ctx.drawImage(tile, gx * TILE_SIZE, gy * TILE_SIZE)
}

// ---------- Faction colors ----------
export const FACTION_COLORS = {
  atreides: { primary: '#2563b0', light: '#4a8fd8', dark: '#143f70', flag: '#3b82f6' },
  harkonnen: { primary: '#7a1a8b', light: '#a840b8', dark: '#4a0d5a', flag: '#9333ea' },
  ordos: { primary: '#1a8b4d', light: '#40b870', dark: '#0d5a2e', flag: '#22c55e' },
  neutral: { primary: '#8a7a5a', light: '#b0a07a', dark: '#5a4a2a', flag: '#a78b5a' },
}
export type Faction = keyof typeof FACTION_COLORS

// ---------- Building rendering ----------
export type BuildingType = 'palace' | 'barracks' | 'factory' | 'turret' | 'refinery'

const buildingCache = new Map<string, HTMLCanvasElement>()

function renderBuilding(type: BuildingType, faction: Faction): HTMLCanvasElement {
  const key = `${type}_${faction}`
  let c = buildingCache.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = TILE_SIZE
  c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const col = FACTION_COLORS[faction]
  const s = TILE_SIZE

  // shadow base
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.fillRect(2, s - 4, s - 4, 3)

  if (type === 'palace') {
    // base structure
    px(ctx, 3, 8, s - 6, s - 12, col.dark)
    px(ctx, 4, 7, s - 8, 1, col.primary)
    // central keep
    px(ctx, s / 2 - 3, 4, 6, 6, col.primary)
    px(ctx, s / 2 - 2, 3, 4, 1, col.light)
    // side towers
    px(ctx, 3, 6, 4, 8, col.primary)
    px(ctx, s - 7, 6, 4, 8, col.primary)
    px(ctx, 3, 5, 4, 1, col.light)
    px(ctx, s - 7, 5, 4, 1, col.light)
    // tower tops
    px(ctx, 3, 4, 4, 1, '#3a3a3a')
    px(ctx, s - 7, 4, 4, 1, '#3a3a3a')
    px(ctx, s / 2 - 3, 3, 6, 1, '#3a3a3a')
    // door
    px(ctx, s / 2 - 2, s - 8, 4, 4, '#1a1a1a')
    // windows
    px(ctx, 5, 9, 2, 2, '#ffcc44')
    px(ctx, s - 7, 9, 2, 2, '#ffcc44')
    // flag
    px(ctx, s / 2 - 1, 0, 1, 4, '#8a7a5a')
    px(ctx, s / 2, 0, 3, 2, col.flag)
  } else if (type === 'barracks') {
    // military structure
    px(ctx, 3, 10, s - 6, s - 14, col.dark)
    px(ctx, 3, 9, s - 6, 1, col.primary)
    // roof
    px(ctx, 2, 8, s - 4, 1, '#3a3a3a')
    px(ctx, 2, 7, s - 4, 1, '#2a2a2a')
    // door
    px(ctx, s / 2 - 2, s - 8, 4, 4, '#1a1a1a')
    // faction stripe
    px(ctx, 4, 12, s - 8, 2, col.light)
    // windows
    px(ctx, 5, 11, 2, 2, '#ffcc44')
    px(ctx, s - 7, 11, 2, 2, '#ffcc44')
    // antenna
    px(ctx, 4, 4, 1, 4, '#5a5a5a')
    px(ctx, 3, 4, 2, 1, col.flag)
  } else if (type === 'factory') {
    // industrial building
    px(ctx, 2, 12, s - 4, s - 16, col.dark)
    px(ctx, 2, 11, s - 4, 1, col.primary)
    // chimney
    px(ctx, s - 8, 4, 3, 8, '#4a4a4a')
    px(ctx, s - 9, 3, 5, 1, '#3a3a3a')
    // smoke
    px(ctx, s - 8, 1, 2, 2, 'rgba(180,180,180,0.6)')
    px(ctx, s - 6, 0, 2, 1, 'rgba(160,160,160,0.4)')
    // roof sawtooth
    for (let i = 0; i < 3; i++) {
      px(ctx, 3 + i * 6, 9, 4, 2, col.primary)
      px(ctx, 3 + i * 6, 8, 4, 1, col.light)
    }
    // big door
    px(ctx, s / 2 - 3, s - 7, 6, 5, '#1a1a1a')
    px(ctx, s / 2 - 3, s - 7, 6, 1, col.light)
  } else if (type === 'turret') {
    // base
    ctx.fillStyle = '#3a3a3a'
    ctx.beginPath()
    ctx.arc(s / 2, s / 2 + 2, 7, 0, Math.PI * 2)
    ctx.fill()
    px(ctx, s / 2 - 6, s / 2, 12, 6, col.dark)
    px(ctx, s / 2 - 5, s / 2 - 1, 10, 1, col.primary)
    // cannon
    px(ctx, s / 2 - 1, s / 2 - 4, 3, 5, '#2a2a2a')
    px(ctx, s / 2 - 1, s / 2 - 5, 3, 1, '#1a1a1a')
    px(ctx, s / 2, s / 2 + 1, 1, 1, col.flag)
  } else if (type === 'refinery') {
    // structure
    px(ctx, 3, 10, s - 6, s - 14, col.dark)
    px(ctx, 3, 9, s - 6, 1, col.primary)
    // pipes
    px(ctx, 2, 13, s - 4, 1, col.light)
    px(ctx, 2, 16, s - 4, 1, col.light)
    // tank
    ctx.fillStyle = '#5a5a5a'
    ctx.beginPath()
    ctx.arc(s / 2, 6, 4, 0, Math.PI * 2)
    ctx.fill()
    px(ctx, s / 2 - 1, 3, 2, 1, col.flag)
    // valve
    px(ctx, 4, 12, 2, 2, '#ffcc44')
    px(ctx, s - 6, 12, 2, 2, '#ffcc44')
  }

  buildingCache.set(key, c)
  return c
}

export function drawBuilding(ctx: CanvasRenderingContext2D, type: BuildingType, faction: Faction, px_: number, py_: number) {
  const img = renderBuilding(type, faction)
  ctx.drawImage(img, px_, py_)
}

// ---------- Unit rendering ----------
export type UnitType = 'harvester' | 'soldier' | 'tank'

const unitCache = new Map<string, HTMLCanvasElement>()

function renderUnit(type: UnitType, faction: Faction): HTMLCanvasElement {
  const key = `${type}_${faction}`
  let c = unitCache.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = TILE_SIZE
  c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const col = FACTION_COLORS[faction]
  const s = TILE_SIZE
  const cx = s / 2

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(cx, s - 5, 7, 3, 0, 0, Math.PI * 2)
  ctx.fill()

  if (type === 'harvester') {
    // bulky vehicle
    px(ctx, 5, 12, 16, 6, col.dark)
    px(ctx, 5, 11, 16, 1, col.primary)
    px(ctx, 6, 10, 14, 1, col.light)
    // cabin
    px(ctx, 14, 8, 6, 4, col.primary)
    px(ctx, 14, 7, 6, 1, col.light)
    px(ctx, 16, 9, 3, 2, '#88ccff')
    // scoop
    px(ctx, 3, 13, 3, 4, '#5a5a5a')
    px(ctx, 2, 14, 2, 2, '#3a3a3a')
    // wheels / tracks
    px(ctx, 5, 18, 16, 2, '#2a2a2a')
    for (let i = 0; i < 4; i++) px(ctx, 6 + i * 4, 19, 2, 1, '#5a5a5a')
    // spice load indicator
    px(ctx, 8, 13, 4, 1, '#e85d2f')
  } else if (type === 'soldier') {
    // body
    px(ctx, cx - 2, 14, 4, 5, col.primary)
    px(ctx, cx - 2, 13, 4, 1, col.light)
    // head
    px(ctx, cx - 2, 10, 4, 3, '#d4a878')
    px(ctx, cx - 1, 10, 2, 1, '#b88860')
    // helmet
    px(ctx, cx - 2, 9, 4, 1, col.dark)
    // legs
    px(ctx, cx - 2, 19, 2, 2, col.dark)
    px(ctx, cx, 19, 2, 2, col.dark)
    // rifle
    px(ctx, cx + 2, 13, 5, 1, '#2a2a2a')
    px(ctx, cx + 6, 12, 1, 2, '#2a2a2a')
    px(ctx, cx + 1, 14, 1, 1, '#4a4a4a')
  } else if (type === 'tank') {
    // tracks
    px(ctx, 4, 16, 20, 4, '#2a2a2a')
    for (let i = 0; i < 5; i++) px(ctx, 5 + i * 4, 17, 2, 2, '#4a4a4a')
    // body
    px(ctx, 5, 12, 18, 5, col.dark)
    px(ctx, 5, 11, 18, 1, col.primary)
    px(ctx, 6, 10, 16, 1, col.light)
    // turret
    px(ctx, cx - 3, 7, 8, 4, col.primary)
    px(ctx, cx - 3, 6, 8, 1, col.light)
    // cannon
    px(ctx, cx + 3, 8, 7, 2, '#2a2a2a')
    px(ctx, cx + 9, 7, 2, 1, '#1a1a1a')
    // hatch
    px(ctx, cx - 1, 7, 3, 1, col.flag)
  }

  unitCache.set(key, c)
  return c
}

export function drawUnit(ctx: CanvasRenderingContext2D, type: UnitType, faction: Faction, px_: number, py_: number) {
  const img = renderUnit(type, faction)
  ctx.drawImage(img, px_ - TILE_SIZE / 2, py_ - TILE_SIZE / 2)
}

// ---------- Worm rendering ----------
let wormCache: HTMLCanvasElement | null = null
function renderWorm(): HTMLCanvasElement {
  if (wormCache) return wormCache
  const c = document.createElement('canvas')
  c.width = TILE_SIZE
  c.height = TILE_SIZE
  const ctx = c.getContext('2d')!
  const s = TILE_SIZE
  // body segments
  ctx.fillStyle = '#8b4513'
  ctx.beginPath()
  ctx.ellipse(s / 2, s / 2 + 2, 11, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  // segments rings
  ctx.fillStyle = '#6b3010'
  for (let i = -2; i <= 2; i++) {
    px(ctx, s / 2 + i * 4 - 1, s / 2 - 3, 2, 10, '#6b3010')
  }
  // teeth (mouth)
  ctx.fillStyle = '#fff'
  for (let i = 0; i < 5; i++) {
    px(ctx, s / 2 - 5 + i * 2, s / 2 - 1, 1, 2, '#fff')
    px(ctx, s / 2 - 5 + i * 2, s / 2 + 2, 1, 2, '#fff')
  }
  // mouth interior
  px(ctx, s / 2 - 5, s / 2, 10, 2, '#3a1010')
  // highlight
  px(ctx, s / 2 - 4, s / 2 - 4, 8, 1, '#a85820')
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
export function drawHealthBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, ratio: number, color = '#22c55e') {
  const h = 3
  const bx = x - w / 2
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(bx - 1, y - 1, w + 2, h + 2)
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(bx, y, w, h)
  const fillW = Math.max(0, Math.min(w, w * ratio))
  ctx.fillStyle = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#eab308' : '#ef4444'
  ctx.fillRect(bx, y, fillW, h)
}

// ---------- Selection ring ----------
export function drawSelectionRing(ctx: CanvasRenderingContext2D, px_: number, py_: number, color = '#fff') {
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(px_, py_ + 4, TILE_SIZE / 2 - 2, (TILE_SIZE / 2 - 4), 0, 0, Math.PI * 2)
  ctx.stroke()
}

// ---------- Move target marker ----------
export function drawMoveMarker(ctx: CanvasRenderingContext2D, gx: number, gy: number, color = '#22c55e') {
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([3, 3])
  ctx.strokeRect(gx * TILE_SIZE + 2, gy * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4)
  ctx.setLineDash([])
}

// ---------- Editor palette icons (small) ----------
export function getTilePreview(tileId: number, size = 32): string {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const scale = size / TILE_SIZE
  ctx.scale(scale, scale)
  const fn = TERRAIN_RENDERERS[tileId] || TERRAIN_RENDERERS[0]
  fn(ctx, TILE_SIZE, 0)
  return c.toDataURL()
}

export function getBuildingPreview(type: BuildingType, faction: Faction, size = 32): string {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const scale = size / TILE_SIZE
  ctx.scale(scale, scale)
  const img = renderBuilding(type, faction)
  ctx.drawImage(img, 0, 0)
  return c.toDataURL()
}

export function getUnitPreview(type: UnitType, faction: Faction, size = 32): string {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const scale = size / TILE_SIZE
  ctx.scale(scale, scale)
  const img = renderUnit(type, faction)
  ctx.drawImage(img, 0, 0)
  return c.toDataURL()
}
