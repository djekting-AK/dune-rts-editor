// game-engine.ts — Full RTS game logic: units, combat, AI, economy, worm,
//                  energy, fog of war, 1-unit-per-tile, projectiles/explosions

import { Faction, BuildingType, UnitType } from './tile-renderer'

export interface Building {
  id: number
  type: BuildingType
  x: number
  y: number
  owner: Faction
  hp: number
  maxHp: number
  cooldown: number
  queue: { type: UnitType; progress: number; cost: number }[]
}

export interface Unit {
  id: number
  type: UnitType
  x: number      // float grid coords
  y: number
  owner: Faction
  hp: number
  maxHp: number
  state: 'idle' | 'move' | 'attack' | 'harvest' | 'return'
  tx: number     // target tile
  ty: number
  targetUnitId: number | null
  targetBldId: number | null
  cargo: number      // spice carried
  maxCargo: number
  cooldown: number   // attack cooldown
  harvestTime: number
  homeX: number      // return point after combat (auto-attack origin)
  homeY: number
  stuckTicks: number // counter to detect being stuck
  lastX: number
  lastY: number
}

export interface Worm {
  id: number
  x: number
  y: number
  tx: number
  ty: number
  life: number
  hp: number
  maxHp: number
  cooldown: number
}

export interface Projectile {
  id: number
  x: number; y: number
  tx: number; ty: number
  sx: number; sy: number  // source
  speed: number
  dmg: number
  targetUnitId: number | null
  targetBldId: number | null
  targetWormId: number | null
  owner: Faction
  color: string
  life: number
}

export interface Explosion {
  id: number
  x: number; y: number
  frame: number
  maxFrame: number
  size: number
  color: string
}

export interface MuzzleFlash {
  id: number
  x: number; y: number
  frame: number
}

export interface GameEvent {
  type: 'combat' | 'build' | 'death' | 'spice' | 'warn' | 'win' | 'lose' | 'energy'
  msg: string
  t: number
}

export interface Player {
  faction: Faction
  credits: number
  energy: number       // current energy supply
  energyMax: number    // capacity from generators
  energyDemand: number // consumption by buildings
  alive: boolean
  isAI: boolean
}

export interface GameState {
  width: number
  height: number
  terrain: number[]
  buildings: Building[]
  units: Unit[]
  worms: Worm[]
  projectiles: Projectile[]
  explosions: Explosion[]
  flashes: MuzzleFlash[]
  players: Record<Faction, Player>
  // fog of war: per-player explored + visible (only atreides tracked for rendering)
  explored: boolean[]      // ever seen by player
  visible: boolean[]       // currently visible
  tick: number
  nextId: number
  events: GameEvent[]
  difficulty: 'easy' | 'medium' | 'hard'
  over: boolean
  winner: Faction | null
  terrainVersion: number
}

// ---------- Config ----------
export const CONFIG = {
  harvester: { cost: 150, hp: 200, speed: 0.08, maxCargo: 60, buildTime: 120, dmg: 0, range: 0, atkCd: 0, energy: 2 },
  soldier:   { cost: 60,  hp: 70,  speed: 0.12,  maxCargo: 0,  buildTime: 60,  dmg: 9,  range: 1.8, atkCd: 28, energy: 1 },
  tank:      { cost: 200, hp: 160, speed: 0.09,  maxCargo: 0,  buildTime: 100, dmg: 22, range: 2.8, atkCd: 40, energy: 3 },
  barracks:  { cost: 150, hp: 400, buildTime: 200, energy: 3 },
  factory:   { cost: 300, hp: 550, buildTime: 300, energy: 5 },
  turret:    { cost: 100, hp: 280, buildTime: 120, dmg: 16, range: 4.5, atkCd: 32, energy: 2 },
  refinery:  { cost: 200, hp: 450, buildTime: 180, energy: 2 },
  generator: { cost: 120, hp: 300, buildTime: 100, energyOutput: 12 },
  palace:    { cost: 0,   hp: 1500, buildTime: 0, energy: 0 },
  spiceValue: { 5: 1, 6: 2 },
  wormInterval: 2200,
  wormLife: 700,
  wormHp: 120,
  wormDmg: 60,        // damage to worm per hit
  wormSpeed: 0.025,
  wormRange: 5,       // aggro range
  startingCredits: 600,
}

export const BUILD_COSTS: Record<string, number> = {
  barracks: CONFIG.barracks.cost,
  factory: CONFIG.factory.cost,
  turret: CONFIG.turret.cost,
  refinery: CONFIG.refinery.cost,
  generator: CONFIG.generator.cost,
}

// ---------- Helpers ----------
export function idx(x: number, y: number, w: number) { return y * w + x }
export function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by)
}
export function inBounds(x: number, y: number, w: number, h: number) {
  return x >= 0 && y >= 0 && x < w && y < h
}
export function isWalkable(terrain: number[], x: number, y: number, w: number, h: number) {
  if (!inBounds(x, y, w, h)) return false
  const t = terrain[idx(x, y, w)]
  return t === 1 || t === 2 || t === 5 || t === 6
}
export function isSand(terrain: number[], x: number, y: number, w: number, h: number) {
  if (!inBounds(x, y, w, h)) return false
  const t = terrain[idx(x, y, w)]
  return t === 1 || t === 2 || t === 5 || t === 6
}
export function isBuildable(terrain: number[], x: number, y: number, w: number, h: number) {
  if (!inBounds(x, y, w, h)) return false
  const t = terrain[idx(x, y, w)]
  return t === 1 || t === 2 || t === 3
}

export function buildingAt(s: GameState, x: number, y: number): Building | null {
  return s.buildings.find(b => b.x === x && b.y === y) || null
}

// check if a tile is occupied by a unit (1 unit per tile)
export function unitAt(s: GameState, x: number, y: number): Unit | null {
  const ix = Math.round(x), iy = Math.round(y)
  return s.units.find(u => Math.round(u.x) === ix && Math.round(u.y) === iy) || null
}

// ---------- Init ----------
export function createGame(width: number, height: number, terrain: number[], difficulty: 'easy'|'medium'|'hard'): GameState {
  const s: GameState = {
    width, height, terrain,
    buildings: [], units: [], worms: [],
    projectiles: [], explosions: [], flashes: [],
    players: {
      atreides: { faction: 'atreides', credits: CONFIG.startingCredits, energy: 12, energyMax: 12, energyDemand: 0, alive: true, isAI: false },
      harkonnen: { faction: 'harkonnen', credits: CONFIG.startingCredits, energy: 12, energyMax: 12, energyDemand: 0, alive: true, isAI: true },
      ordos: { faction: 'ordos', credits: 0, energy: 0, energyMax: 0, energyDemand: 0, alive: false, isAI: true },
      neutral: { faction: 'neutral', credits: 0, energy: 0, energyMax: 0, energyDemand: 0, alive: false, isAI: false },
    },
    explored: new Array(width * height).fill(false),
    visible: new Array(width * height).fill(false),
    tick: 0, nextId: 1, events: [], difficulty, over: false, winner: null, terrainVersion: 0,
  }
  if (difficulty === 'medium') s.players.harkonnen.credits += 200
  if (difficulty === 'hard') { s.players.harkonnen.credits += 500 }

  // place palaces + starting generators at opposite corners
  const px1 = 3, py1 = Math.floor(height / 2)
  const px2 = width - 4, py2 = Math.floor(height / 2)
  for (const [bx, by, fac] of [[px1, py1, 'atreides'], [px2, py2, 'harkonnen']] as const) {
    if (inBounds(bx, by, width, height)) terrain[idx(bx, by, width)] = 3
    s.buildings.push({ id: s.nextId++, type: 'palace', x: bx, y: by, owner: fac, hp: CONFIG.palace.hp, maxHp: CONFIG.palace.hp, cooldown: 0, queue: [] })
    // start harvester
    s.units.push(makeUnit(s, 'harvester', fac, bx, by + 1.5))
  }
  recomputeEnergy(s)
  return s
}

export function makeUnit(s: GameState, type: UnitType, owner: Faction, x: number, y: number): Unit {
  const c = CONFIG[type]
  return {
    id: s.nextId++, type, x, y, owner,
    hp: c.hp, maxHp: c.hp,
    state: 'idle', tx: Math.round(x), ty: Math.round(y),
    targetUnitId: null, targetBldId: null,
    cargo: 0, maxCargo: c.maxCargo,
    cooldown: 0, harvestTime: 0,
    homeX: x, homeY: y,
    stuckTicks: 0, lastX: x, lastY: y,
  }
}

// ---------- Energy ----------
export function recomputeEnergy(s: GameState) {
  for (const f of ['atreides', 'harkonnen'] as Faction[]) {
    const p = s.players[f]
    let max = 0, demand = 0
    for (const b of s.buildings) {
      if (b.owner !== f) continue
      if (b.type === 'generator') max += CONFIG.generator.energyOutput
      else if (b.type === 'palace') max += 6 // palace gives a little
      else demand += (CONFIG[b.type] as any).energy || 0
    }
    for (const u of s.units) {
      if (u.owner !== f) continue
      demand += (CONFIG[u.type] as any).energy || 0
    }
    p.energyMax = max
    p.energyDemand = demand
    p.energy = Math.max(0, max - demand)
  }
}

export function hasPower(s: GameState, owner: Faction): boolean {
  return s.players[owner].energyMax >= s.players[owner].energyDemand
}

// ---------- Events ----------
export function logEvent(s: GameState, type: GameEvent['type'], msg: string) {
  s.events.push({ type, msg, t: s.tick })
  if (s.events.length > 40) s.events.shift()
}

// ---------- Visual effects ----------
function spawnProjectile(s: GameState, sx: number, sy: number, tx: number, ty: number, dmg: number, owner: Faction, color: string, target: {unitId?:number, bldId?:number, wormId?:number}) {
  s.projectiles.push({
    id: s.nextId++, x: sx, y: sy, sx, sy, tx, ty,
    speed: 0.35, dmg, owner, color, life: 60,
    targetUnitId: target.unitId ?? null,
    targetBldId: target.bldId ?? null,
    targetWormId: target.wormId ?? null,
  })
  s.flashes.push({ id: s.nextId++, x: sx, y: sy, frame: 0 })
}

function spawnExplosion(s: GameState, x: number, y: number, size = 1, color = '#ff8030') {
  s.explosions.push({ id: s.nextId++, x, y, frame: 0, maxFrame: 12, size, color })
}

// ---------- Building actions ----------
export function canBuild(s: GameState, owner: Faction, type: BuildingType, x: number, y: number): boolean {
  if (!isBuildable(s.terrain, x, y, s.width, s.height)) return false
  if (buildingAt(s, x, y)) return false
  const cost = BUILD_COSTS[type] ?? 0
  if (s.players[owner].credits < cost) return false
  // must be near an existing friendly building
  const near = s.buildings.some(b => b.owner === owner && dist(b.x, b.y, x, y) < 4)
  return near
}

export function placeBuilding(s: GameState, owner: Faction, type: BuildingType, x: number, y: number): boolean {
  if (!canBuild(s, owner, type, x, y)) return false
  const cost = BUILD_COSTS[type] ?? 0
  s.players[owner].credits -= cost
  const cfg = CONFIG[type] as any
  s.buildings.push({
    id: s.nextId++, type, x, y, owner,
    hp: cfg.hp * 0.5, maxHp: cfg.hp,
    cooldown: 0, queue: [],
  })
  recomputeEnergy(s)
  logEvent(s, 'build', `${owner === 'atreides' ? 'Вы строите' : 'ИИ строит'}: ${typeRu(type)}`)
  return true
}

export function queueUnit(s: GameState, bld: Building, type: UnitType): boolean {
  const cost = CONFIG[type].cost
  if (s.players[bld.owner].credits < cost) return false
  if (bld.hp < bld.maxHp * 0.5) return false
  // check power
  if (!hasPower(s, bld.owner)) return false
  s.players[bld.owner].credits -= cost
  bld.queue.push({ type, progress: 0, cost })
  return true
}

// ---------- Unit commands ----------
export function commandMove(s: GameState, unit: Unit, tx: number, ty: number) {
  let fx = tx, fy = ty
  if (!isWalkable(s.terrain, Math.round(tx), Math.round(ty), s.width, s.height)) {
    let found = false
    for (let r = 1; r <= 6 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const cx = Math.round(tx) + dx, cy = Math.round(ty) + dy
          if (isWalkable(s.terrain, cx, cy, s.width, s.height) && !unitAt(s, cx, cy)) {
            fx = cx + 0.5; fy = cy + 0.5; found = true
          }
        }
      }
    }
  }
  unit.tx = fx; unit.ty = fy
  unit.targetUnitId = null; unit.targetBldId = null
  unit.state = 'move'
}

export function commandAttack(s: GameState, unit: Unit, targetId: number, isBuilding: boolean) {
  if (isBuilding) { unit.targetBldId = targetId; unit.targetUnitId = null }
  else { unit.targetUnitId = targetId; unit.targetBldId = null }
  unit.state = 'attack'
}

// ---------- Picking ----------
export function pickUnitAt(s: GameState, x: number, y: number, owner?: Faction, radius = 0.9): Unit | null {
  let best: Unit | null = null
  let bestD = radius
  for (const u of s.units) {
    if (owner && u.owner !== owner) continue
    const d = dist(u.x, u.y, x, y)
    if (d < bestD) { bestD = d; best = u }
  }
  return best
}

export function pickBuildingAt(s: GameState, x: number, y: number, owner?: Faction): Building | null {
  return s.buildings.find(b => b.x === Math.floor(x) && b.y === Math.floor(y) && (!owner || b.owner === owner)) || null
}

// ---------- Core tick ----------
export function tick(s: GameState) {
  if (s.over) return
  s.tick++
  updateBuildings(s)
  updateUnits(s)
  updateProjectiles(s)
  updateEffects(s)
  updateWorms(s)
  updateFog(s)
  if (s.players.harkonnen.alive) updateAI(s)
  // win/lose
  const aPalace = s.buildings.find(b => b.owner === 'atreides' && b.type === 'palace')
  const hPalace = s.buildings.find(b => b.owner === 'harkonnen' && b.type === 'palace')
  if (!aPalace || aPalace.hp <= 0) {
    s.players.atreides.alive = false
    if (!s.over) { s.over = true; s.winner = 'harkonnen'; logEvent(s, 'lose', 'Ваш дворец разрушен! Поражение.') }
  }
  if (!hPalace || hPalace.hp <= 0) {
    s.players.harkonnen.alive = false
    if (!s.over) { s.over = true; s.winner = 'atreides'; logEvent(s, 'win', 'Дворец Харконнен разрушен! Победа!') }
  }
}

function updateBuildings(s: GameState) {
  for (const b of s.buildings) {
    if (b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + 2)
    if (b.queue.length > 0 && b.hp >= b.maxHp * 0.5) {
      const q = b.queue[0]
      q.progress++
      const cfg = CONFIG[q.type]
      if (q.progress >= cfg.buildTime) {
        const spawn = findSpawnTile(s, b)
        if (spawn) {
          s.units.push(makeUnit(s, q.type, b.owner, spawn.x, spawn.y))
          b.queue.shift()
          recomputeEnergy(s)
          if (b.owner === 'atreides') logEvent(s, 'build', `Создан: ${unitName(q.type)}`)
        } else {
          q.progress = cfg.buildTime
        }
      }
    }
    // turret auto-attack (only if has power)
    if (b.type === 'turret' && b.hp >= b.maxHp * 0.5 && hasPower(s, b.owner)) {
      b.cooldown = Math.max(0, b.cooldown - 1)
      if (b.cooldown === 0) {
        const target = findNearestEnemy(s, b.x + 0.5, b.y + 0.5, b.owner, CONFIG.turret.range)
        if (target) {
          // spawn projectile toward target
          const tx = 'type' in target ? (target as any).x : (target as Building).x + 0.5
          const ty = 'type' in target ? (target as any).y : (target as Building).y + 0.5
          if ('cargo' in target) spawnProjectile(s, b.x + 0.5, b.y + 0.5, tx, ty, CONFIG.turret.dmg, b.owner, '#ffe060', { unitId: (target as Unit).id })
          else spawnProjectile(s, b.x + 0.5, b.y + 0.5, tx, ty, CONFIG.turret.dmg, b.owner, '#ffe060', { bldId: (target as Building).id })
          b.cooldown = CONFIG.turret.atkCd
        }
      }
    }
  }
  s.buildings = s.buildings.filter(b => b.hp > 0)
}

function findSpawnTile(s: GameState, b: Building): { x: number; y: number } | null {
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = b.x + dx, y = b.y + dy
        if (!isWalkable(s.terrain, x, y, s.width, s.height)) continue
        if (s.buildings.some(bb => bb.x === x && bb.y === y)) continue
        if (s.units.some(u => Math.round(u.x) === x && Math.round(u.y) === y)) continue
        return { x: x + 0.5, y: y + 0.5 }
      }
    }
  }
  return null
}

function findNearestEnemy(s: GameState, x: number, y: number, owner: Faction, range: number): Unit | Building | null {
  let best: Unit | Building | null = null
  let bestD = range
  for (const u of s.units) {
    if (u.owner === owner) continue
    const d = dist(x, y, u.x, u.y)
    if (d < bestD) { bestD = d; best = u }
  }
  for (const b of s.buildings) {
    if (b.owner === owner) continue
    const d = dist(x, y, b.x + 0.5, b.y + 0.5)
    if (d < bestD) { bestD = d; best = b }
  }
  // also target worms (only if hostile to everyone)
  for (const w of s.worms) {
    const d = dist(x, y, w.x, w.y)
    if (d < bestD) { bestD = d; best = w as any }
  }
  return best
}

function findNearestSpice(s: GameState, x: number, y: number, range = 30): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestD = range
  for (let r = 1; r <= range; r += 2) {
    for (let dy = -r; dy <= r; dy += 2) {
      for (let dx = -r; dx <= r; dx += 2) {
        const cx = Math.round(x) + dx, cy = Math.round(y) + dy
        if (!inBounds(cx, cy, s.width, s.height)) continue
        const t = s.terrain[idx(cx, cy, s.width)]
        if (t === 5 || t === 6) {
          const d = dist(x, y, cx, cy)
          if (d < bestD) { bestD = d; best = { x: cx + 0.5, y: cy + 0.5 } }
        }
      }
    }
    if (best && r > 4) break
  }
  return best
}

function findNearestFriendlyBuilding(s: GameState, x: number, y: number, owner: Faction): Building | null {
  let best: Building | null = null
  let bestD = 99
  for (const b of s.buildings) {
    if (b.owner !== owner) continue
    if (b.type !== 'palace' && b.type !== 'refinery') continue
    const d = dist(x, y, b.x, b.y)
    if (d < bestD) { bestD = d; best = b }
  }
  return best
}

function updateUnits(s: GameState) {
  for (const u of s.units) {
    if (u.cooldown > 0) u.cooldown--
    const cfg = CONFIG[u.type]

    // harvester AI
    if (u.type === 'harvester') {
      if (u.state === 'idle') {
        if (u.cargo >= u.maxCargo) {
          const b = findNearestFriendlyBuilding(s, u.x, u.y, u.owner)
          if (b) { u.tx = b.x + 0.5; u.ty = b.y + 0.5; u.state = 'return' }
        } else {
          const sp = findNearestSpice(s, u.x, u.y)
          if (sp) { u.tx = sp.x; u.ty = sp.y; u.state = 'harvest' }
        }
      } else if (u.state === 'harvest') {
        const d = dist(u.x, u.y, u.tx, u.ty)
        if (d < 0.8) {
          u.harvestTime++
          if (u.harvestTime >= 8) {
            u.harvestTime = 0
            const tx = Math.floor(u.tx), ty = Math.floor(u.ty)
            if (inBounds(tx, ty, s.width, s.height)) {
              const ti = idx(tx, ty, s.width)
              const tval = s.terrain[ti]
              const gain = CONFIG.spiceValue[tval as 5 | 6] || 1
              u.cargo = Math.min(u.maxCargo, u.cargo + gain * 4)
              if (tval === 6) s.terrain[ti] = 5
              else if (tval === 5) s.terrain[ti] = 1
              s.terrainVersion++
            }
            if (u.cargo >= u.maxCargo) {
              const b = findNearestFriendlyBuilding(s, u.x, u.y, u.owner)
              if (b) { u.tx = b.x + 0.5; u.ty = b.y + 0.5; u.state = 'return' }
              else u.state = 'idle'
            }
          }
        } else {
          moveToward(s, u, u.tx, u.ty, cfg.speed)
        }
      } else if (u.state === 'return') {
        const d = dist(u.x, u.y, u.tx, u.ty)
        if (d < 1.2) {
          const credits = u.cargo * 5
          s.players[u.owner].credits += credits
          if (u.owner === 'atreides') logEvent(s, 'spice', `+${credits} кредитов (спайс)`)
          u.cargo = 0
          u.state = 'idle'
        } else {
          moveToward(s, u, u.tx, u.ty, cfg.speed)
        }
      }
      continue
    }

    // combat units
    if (u.state === 'idle') {
      const enemy = findNearestEnemy(s, u.x, u.y, u.owner, cfg.range + 2)
      if (enemy) {
        // save current position as home to return to after combat
        u.homeX = u.x
        u.homeY = u.y
        if ('cargo' in enemy) u.targetUnitId = (enemy as Unit).id
        else if ('type' in enemy && (enemy as any).type) u.targetBldId = (enemy as Building).id
        u.state = 'attack'
      }
    }

    if (u.state === 'attack') {
      let target: Unit | Building | null = null
      if (u.targetUnitId) target = s.units.find(x => x.id === u.targetUnitId) || null
      if (!target && u.targetBldId) target = s.buildings.find(x => x.id === u.targetBldId) || null
      if (!target) {
        // target destroyed — return home or find nearest free tile nearby
        const homeD = dist(u.x, u.y, u.homeX, u.homeY)
        if (homeD > 1.5) {
          // go back home
          u.tx = u.homeX
          u.ty = u.homeY
          u.state = 'move'
        } else {
          // already near home — just find a free adjacent tile if current is occupied
          const curTileX = Math.round(u.x), curTileY = Math.round(u.y)
          if (isTileFree(s, curTileX, curTileY, u.id)) {
            u.state = 'idle'
          } else {
            // find nearest free tile adjacent
            const free = findNearestFreeTile(s, u.x, u.y, u.id, 3)
            if (free) {
              u.tx = free.x
              u.ty = free.y
              u.state = 'move'
            } else {
              u.state = 'idle'
            }
          }
        }
        u.targetUnitId = null
        u.targetBldId = null
        continue
      }
      const tx = 'type' in target && (target as any).type ? (target as any).x : (target as Building).x + 0.5
      const ty = 'type' in target && (target as any).type ? (target as any).y : (target as Building).y + 0.5
      const d = dist(u.x, u.y, tx, ty)
      if (d <= cfg.range) {
        if (u.cooldown <= 0) {
          // fire projectile
          if ('cargo' in target) spawnProjectile(s, u.x, u.y, (target as Unit).x, (target as Unit).y, cfg.dmg, u.owner, '#ffaa44', { unitId: (target as Unit).id })
          else spawnProjectile(s, u.x, u.y, (target as Building).x + 0.5, (target as Building).y + 0.5, cfg.dmg, u.owner, '#ffaa44', { bldId: (target as Building).id })
          u.cooldown = cfg.atkCd
        }
      } else {
        moveToward(s, u, tx, ty, cfg.speed)
      }
    }

    if (u.state === 'move') {
      const d = dist(u.x, u.y, u.tx, u.ty)
      if (d < 0.4) u.state = 'idle'
      else {
        moveToward(s, u, u.tx, u.ty, cfg.speed)
        // auto-attack only if enemy is right next to us (don't break long moves)
        const enemy = findNearestEnemy(s, u.x, u.y, u.owner, cfg.range * 0.5)
        if (enemy && 'cargo' in enemy) {
          u.homeX = u.x; u.homeY = u.y
          u.targetUnitId = (enemy as Unit).id
          u.state = 'attack'
        }
      }
    }

    // stuck detection — if unit hasn't moved much in a while, pick new target
    if (Math.abs(u.x - u.lastX) < 0.01 && Math.abs(u.y - u.lastY) < 0.01) {
      u.stuckTicks++
      if (u.stuckTicks > 15 && u.state !== 'idle') {
        // give up current move target, become idle (will re-acquire)
        if (u.state === 'move') {
          u.state = 'idle'
          u.stuckTicks = 0
        }
      }
    } else {
      u.stuckTicks = 0
    }
    u.lastX = u.x
    u.lastY = u.y
  }
  s.units = s.units.filter(u => u.hp > 0)
}

// find nearest free tile (walkable + no unit + no building) within radius
function findNearestFreeTile(s: GameState, x: number, y: number, exceptUnitId: number, maxR: number): { x: number; y: number } | null {
  for (let r = 1; r <= maxR; r++) {
    let best: { x: number; y: number } | null = null
    let bestD = 99
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
        const cx = Math.round(x) + dx, cy = Math.round(y) + dy
        if (!isTileFree(s, cx, cy, exceptUnitId)) continue
        const d = dist(x, y, cx + 0.5, cy + 0.5)
        if (d < bestD) { bestD = d; best = { x: cx + 0.5, y: cy + 0.5 } }
      }
    }
    if (best) return best
  }
  return null
}

// ---------- Pathfinding (BFS) ----------
// Cached BFS path from a tile to a target tile, avoiding blocked tiles & occupied tiles.
// Returns next step {x,y} or null if no path found within maxDepth.
const pathCache = new Map<string, { x: number; y: number } | null>()

function isTileFree(s: GameState, x: number, y: number, exceptUnitId: number): boolean {
  if (!isWalkable(s.terrain, x, y, s.width, s.height)) return false
  if (s.buildings.some(b => b.x === x && b.y === y)) return false
  const other = s.units.find(o => o.id !== exceptUnitId && Math.round(o.x) === x && Math.round(o.y) === y)
  if (other) return false
  return true
}

function isTilePassable(s: GameState, x: number, y: number, exceptUnitId: number): boolean {
  // passable = walkable + no building (units can pass through each other's tiles
  // but will stop on free tiles; we allow temporary overlap during movement)
  if (!isWalkable(s.terrain, x, y, s.width, s.height)) return false
  if (s.buildings.some(b => b.x === x && b.y === y)) return false
  return true
}

function findNextStep(s: GameState, fromX: number, fromY: number, toX: number, toY: number, unitId: number): { x: number; y: number } | null {
  const fx = Math.round(fromX), fy = Math.round(fromY)
  const tx = Math.round(toX), ty = Math.round(toY)
  if (fx === tx && fy === ty) return { x: tx + 0.5, y: ty + 0.5 }
  // BFS
  const w = s.width, h = s.height
  const visited = new Uint8Array(w * h)
  const cameFrom = new Int32Array(w * h).fill(-1)
  const queue: number[] = [fy * w + fx]
  visited[fy * w + fx] = 1
  const targetIdx = ty * w + tx
  const maxDepth = 120
  let depth = 0
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
  let found = false
  while (queue.length && depth < maxDepth) {
    const cur = queue.shift()!
    depth++
    if (cur === targetIdx) { found = true; break }
    const cx = cur % w, cy = Math.floor(cur / w)
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const ni = ny * w + nx
      if (visited[ni]) continue
      // target tile is always passable even if occupied (we just need to reach adjacent)
      if (ni !== targetIdx && !isTilePassable(s, nx, ny, unitId)) continue
      visited[ni] = 1
      cameFrom[ni] = cur
      queue.push(ni)
    }
  }
  if (!found && visited[targetIdx] === 0) {
    // no path — find closest visited tile to target as fallback
    return null
  }
  // reconstruct: walk back from target to find first step
  let cur = targetIdx
  let prev = cameFrom[cur]
  if (prev < 0) return null
  while (prev !== fy * w + fx && cameFrom[prev] >= 0) {
    cur = prev
    prev = cameFrom[cur]
  }
  const nx = cur % w, ny = Math.floor(cur / w)
  return { x: nx + 0.5, y: ny + 0.5 }
}

function moveToward(s: GameState, u: Unit, tx: number, ty: number, speed: number) {
  const dx = tx - u.x, dy = ty - u.y
  const d = Math.hypot(dx, dy)
  if (d < 0.05) return
  // If close to target, move directly (smooth final approach)
  if (d < speed * 2) {
    const tr = Math.round(tx), tc = Math.round(ty)
    const free = isTileFree(s, tr, tc, u.id) || (Math.round(u.x) === tr && Math.round(u.y) === tc)
    if (free || d < 0.4) {
      u.x = Math.max(0.5, Math.min(s.width - 0.5, u.x + (dx / d) * Math.min(speed, d)))
      u.y = Math.max(0.5, Math.min(s.height - 0.5, u.y + (dy / d) * Math.min(speed, d)))
      return
    }
  }
  // Try direct movement first (fast path — most of the time this works)
  const ux = (dx / d) * speed, uy = (dy / d) * speed
  const directCandidates = [
    [u.x + ux, u.y + uy],
    [u.x + ux, u.y],
    [u.x, u.y + uy],
  ]
  for (const [nx, ny] of directCandidates) {
    const tileX = Math.round(nx), tileY = Math.round(ny)
    if (!isWalkable(s.terrain, tileX, tileY, s.width, s.height)) continue
    if (s.buildings.some(b => b.x === tileX && b.y === tileY)) continue
    const other = s.units.find(o => o.id !== u.id && Math.round(o.x) === tileX && Math.round(o.y) === tileY && dist(o.x, o.y, nx, ny) < 0.5)
    if (other) continue
    u.x = Math.max(0.5, Math.min(s.width - 0.5, nx))
    u.y = Math.max(0.5, Math.min(s.height - 0.5, ny))
    return
  }
  // Direct path blocked — use BFS pathfinding (every few ticks to save CPU)
  // Only run BFS if unit is stuck (hasn't moved this tick would be detected by caller)
  const step = findNextStep(s, u.x, u.y, tx, ty, u.id)
  if (step) {
    const sdx = step.x - u.x, sdy = step.y - u.y
    const sd = Math.hypot(sdx, sdy)
    if (sd > 0.05) {
      const mx = (sdx / sd) * Math.min(speed, sd)
      const my = (sdy / sd) * Math.min(speed, sd)
      const ntx = Math.round(u.x + mx), nty = Math.round(u.y + my)
      const other = s.units.find(o => o.id !== u.id && Math.round(o.x) === ntx && Math.round(o.y) === nty && dist(o.x, o.y, u.x + mx, u.y + my) < 0.5)
      if (!other) {
        u.x = Math.max(0.5, Math.min(s.width - 0.5, u.x + mx))
        u.y = Math.max(0.5, Math.min(s.height - 0.5, u.y + my))
        return
      }
    }
  }
  // last resort: try perpendicular nudge
  const perp = [[u.x + uy, u.y - ux], [u.x - uy, u.y + ux]]
  for (const [nx, ny] of perp) {
    if (!isWalkable(s.terrain, Math.round(nx), Math.round(ny), s.width, s.height)) continue
    const other = s.units.find(o => o.id !== u.id && Math.round(o.x) === Math.round(nx) && Math.round(o.y) === Math.round(ny) && dist(o.x, o.y, nx, ny) < 0.5)
    if (other) continue
    u.x = Math.max(0.5, Math.min(s.width - 0.5, nx))
    u.y = Math.max(0.5, Math.min(s.height - 0.5, ny))
    return
  }
}

// ---------- Projectiles ----------
function updateProjectiles(s: GameState) {
  for (const p of s.projectiles) {
    p.life--
    const dx = p.tx - p.x, dy = p.ty - p.y
    const d = Math.hypot(dx, dy)
    if (d < p.speed * 1.5 || p.life <= 0) {
      // hit
      let hit = false
      if (p.targetUnitId) {
        const t = s.units.find(u => u.id === p.targetUnitId)
        if (t) { t.hp -= p.dmg; hit = true; if (t.hp <= 0) logEvent(s, 'death', `Уничтожен ${unitName(t.type)}`) }
      } else if (p.targetBldId) {
        const t = s.buildings.find(b => b.id === p.targetBldId)
        if (t) { t.hp -= p.dmg; hit = true; if (t.hp <= 0) logEvent(s, 'death', `Разрушен ${bldName(t.type)}`) }
      } else if (p.targetWormId) {
        const t = s.worms.find(w => w.id === p.targetWormId)
        if (t) { t.hp -= p.dmg; hit = true; if (t.hp <= 0) { logEvent(s, 'warn', 'Шай-Хулуд уничтожен!'); spawnExplosion(s, t.x, t.y, 2.5, '#ff6020') } }
      }
      if (hit) spawnExplosion(s, p.tx, p.ty, 1, p.color)
      p.life = 0
    } else {
      p.x += (dx / d) * p.speed
      p.y += (dy / d) * p.speed
    }
  }
  s.projectiles = s.projectiles.filter(p => p.life > 0)
}

function updateEffects(s: GameState) {
  for (const e of s.explosions) e.frame++
  s.explosions = s.explosions.filter(e => e.frame < e.maxFrame)
  for (const f of s.flashes) f.frame++
  s.flashes = s.flashes.filter(f => f.frame < 4)
}

// ---------- Worm ----------
function updateWorms(s: GameState) {
  // spawn — only 1 worm at a time, late game, on sand
  if (s.tick % CONFIG.wormInterval === 0 && s.worms.length < 1 && s.tick > 1500) {
    for (let tries = 0; tries < 30; tries++) {
      const x = Math.floor(Math.random() * s.width)
      const y = Math.floor(Math.random() * s.height)
      if (isSand(s.terrain, x, y, s.width, s.height)) {
        // spawn far from any building
        const nearBld = s.buildings.some(b => dist(b.x, b.y, x, y) < 6)
        if (!nearBld) {
          s.worms.push({ id: s.nextId++, x: x + 0.5, y: y + 0.5, tx: x + 0.5, ty: y + 0.5, life: CONFIG.wormLife, hp: CONFIG.wormHp, maxHp: CONFIG.wormHp, cooldown: 0 })
          logEvent(s, 'warn', 'Шай-Хулуд пробуждается!')
          break
        }
      }
    }
  }

  for (const w of s.worms) {
    w.life--
    // find nearest unit ON SAND within aggro range (less aggressive)
    let best: Unit | null = null
    let bestD = CONFIG.wormRange
    for (const u of s.units) {
      const tx = Math.floor(u.x), ty = Math.floor(u.y)
      if (!isSand(s.terrain, tx, ty, s.width, s.height)) continue
      const d = dist(w.x, w.y, u.x, u.y)
      if (d < bestD) { bestD = d; best = u }
    }
    if (best) { w.tx = best.x; w.ty = best.y }
    else {
      if (w.cooldown <= 0) {
        // wander — but only to sand tiles
        for (let tries = 0; tries < 10; tries++) {
          const x = Math.floor(Math.random() * s.width)
          const y = Math.floor(Math.random() * s.height)
          if (isSand(s.terrain, x, y, s.width, s.height)) { w.tx = x + 0.5; w.ty = y + 0.5; break }
        }
        w.cooldown = 80
      }
      w.cooldown--
    }
    // move — ONLY on sand. If next step is non-sand, pick a sand direction.
    const dx = w.tx - w.x, dy = w.ty - w.y
    const d = Math.hypot(dx, dy)
    if (d > 0.1) {
      const sp = CONFIG.wormSpeed
      const nx = w.x + (dx / d) * sp
      const ny = w.y + (dy / d) * sp
      if (isSand(s.terrain, Math.round(nx), Math.round(ny), s.width, s.height)) {
        w.x = nx; w.y = ny
      } else {
        // try sliding along one axis
        if (isSand(s.terrain, Math.round(nx), Math.round(w.y), s.width, s.height)) w.x = nx
        else if (isSand(s.terrain, Math.round(w.x), Math.round(ny), s.width, s.height)) w.y = ny
        else { w.cooldown = 0 } // pick new wander target
      }
    }
    // eat
    if (best && dist(w.x, w.y, best.x, best.y) < 0.7) {
      best.hp = 0
      logEvent(s, 'warn', `Червь сожрал ${unitName(best.type)}!`)
      spawnExplosion(s, best.x, best.y, 1.5, '#aa5020')
    }
  }
  s.worms = s.worms.filter(w => w.life > 0 && w.hp > 0)
}

// ---------- Fog of war ----------
const VISION_RANGES: Record<string, number> = {
  palace: 5, barracks: 3, factory: 3, turret: 4, refinery: 3, generator: 3,
  harvester: 3, soldier: 4, tank: 4,
}
function updateFog(s: GameState) {
  // reset visible
  s.visible.fill(false)
  // player (atreides) units and buildings reveal area
  for (const u of s.units) {
    if (u.owner !== 'atreides') continue
    const r = VISION_RANGES[u.type] || 3
    reveal(s, u.x, u.y, r)
  }
  for (const b of s.buildings) {
    if (b.owner !== 'atreides') continue
    const r = VISION_RANGES[b.type] || 3
    reveal(s, b.x + 0.5, b.y + 0.5, r)
  }
}
function reveal(s: GameState, x: number, y: number, r: number) {
  const cx = Math.round(x), cy = Math.round(y)
  const r2 = r * r
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const nx = cx + dx, ny = cy + dy
      if (!inBounds(nx, ny, s.width, s.height)) continue
      s.explored[idx(nx, ny, s.width)] = true
      s.visible[idx(nx, ny, s.width)] = true
    }
  }
}

// ---------- AI ----------
function updateAI(s: GameState) {
  const owner: Faction = 'harkonnen'
  const player = s.players[owner]
  const myBldgs = s.buildings.filter(b => b.owner === owner)
  const palace = myBldgs.find(b => b.type === 'palace')
  if (!palace) return

  const myUnits = s.units.filter(u => u.owner === owner)
  const harvesters = myUnits.filter(u => u.type === 'harvester')
  const army = myUnits.filter(u => u.type === 'soldier' || u.type === 'tank')
  const hasBarracks = myBldgs.some(b => b.type === 'barracks')
  const hasFactory = myBldgs.some(b => b.type === 'factory')
  const hasGenerator = myBldgs.some(b => b.type === 'generator')
  const genCount = myBldgs.filter(b => b.type === 'generator').length

  const interval = s.difficulty === 'hard' ? 20 : s.difficulty === 'medium' ? 35 : 50
  if (s.tick % interval !== 0) return

  // build generator first if low power
  if (!hasPower(s, owner) && genCount < 3) {
    tryAIBuild(s, owner, 'generator', palace); return
  }
  // build harvesters
  if (harvesters.length < 2 && player.credits >= CONFIG.harvester.cost && palace.queue.length === 0) {
    queueUnit(s, palace, 'harvester')
  }
  // build generator if demand > 60% of max
  if (player.energyDemand > player.energyMax * 0.7 && genCount < 4) {
    tryAIBuild(s, owner, 'generator', palace)
  }
  if (!hasBarracks && player.credits >= CONFIG.barracks.cost) tryAIBuild(s, owner, 'barracks', palace)
  if (hasBarracks && !hasFactory && player.credits >= CONFIG.factory.cost) tryAIBuild(s, owner, 'factory', palace)
  if (army.length < 3 && player.credits >= CONFIG.turret.cost && myBldgs.filter(b => b.type === 'turret').length < 2) {
    tryAIBuild(s, owner, 'turret', palace)
  }
  const barracks = myBldgs.find(b => b.type === 'barracks')
  if (barracks && barracks.queue.length === 0 && player.credits >= CONFIG.soldier.cost) queueUnit(s, barracks, 'soldier')
  const factory = myBldgs.find(b => b.type === 'factory')
  if (factory && factory.queue.length === 0 && player.credits >= CONFIG.tank.cost) queueUnit(s, factory, 'tank')

  // army orders
  const playerPalace = s.buildings.find(b => b.owner === 'atreides' && b.type === 'palace')
  const threat = s.units.filter(u => u.owner === 'atreides' && u.type !== 'harvester' && dist(u.x, u.y, palace.x, palace.y) < 6)
  if (threat.length > 0 && army.length > 0) {
    for (const a of army) {
      if (a.state === 'idle' || (a.state === 'move' && dist(a.x, a.y, palace.x, palace.y) > 8)) {
        commandAttack(s, a, threat[0].id, false)
      }
    }
  } else if (army.length >= (s.difficulty === 'hard' ? 4 : 6) && playerPalace) {
    for (const a of army) {
      if (a.state === 'idle') commandAttack(s, a, playerPalace.id, true)
    }
  }
}

function tryAIBuild(s: GameState, owner: Faction, type: BuildingType, near: Building) {
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = near.x + dx, y = near.y + dy
        if (canBuild(s, owner, type, x, y)) { placeBuilding(s, owner, type, x, y); return true }
      }
    }
  }
  return false
}

// ---------- Russian names ----------
export function typeRu(t: string): string {
  const m: Record<string,string> = {
    palace:'Дворец', barracks:'Казармы', factory:'Фабрика', turret:'Турель', refinery:'Нефтезавод', generator:'Генератор',
    harvester:'Доставщик', soldier:'Солдат', tank:'Танк',
  }
  return m[t] || t
}
export function unitName(t: UnitType): string {
  return { harvester: 'доставщик', soldier: 'солдат', tank: 'танк' }[t]
}
export function bldName(t: BuildingType): string {
  return { palace: 'дворец', barracks: 'казармы', factory: 'фабрику', turret: 'турель', refinery: 'нефтезавод', generator: 'генератор' }[t]
}
export function factionRu(f: Faction): string {
  return { atreides: 'Атрейдес', harkonnen: 'Харконнен', ordos: 'Ордос', neutral: 'Нейтрал' }[f]
}
