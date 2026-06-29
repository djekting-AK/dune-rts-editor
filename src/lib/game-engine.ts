// game-engine.ts — Full RTS game logic: units, combat, AI, economy, worm

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
}

export interface Worm {
  id: number
  x: number
  y: number
  tx: number
  ty: number
  life: number
  cooldown: number
}

export interface GameEvent {
  type: 'combat' | 'build' | 'death' | 'spice' | 'warn' | 'win' | 'lose'
  msg: string
  t: number
}

export interface Player {
  faction: Faction
  credits: number
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
  players: Record<Faction, Player>
  tick: number
  nextId: number
  events: GameEvent[]
  difficulty: 'easy' | 'medium' | 'hard'
  over: boolean
  winner: Faction | null
}

// ---------- Config ----------
export const CONFIG = {
  harvester: { cost: 150, hp: 200, speed: 0.08, maxCargo: 60, buildTime: 120, dmg: 0, range: 0, atkCd: 0 },
  soldier:   { cost: 60,  hp: 70,  speed: 0.12,  maxCargo: 0,  buildTime: 60,  dmg: 9,  range: 1.8, atkCd: 28 },
  tank:      { cost: 200, hp: 160, speed: 0.09,  maxCargo: 0,  buildTime: 100, dmg: 22, range: 2.8, atkCd: 40 },
  barracks:  { cost: 150, hp: 400, buildTime: 200 },
  factory:   { cost: 300, hp: 550, buildTime: 300 },
  turret:    { cost: 100, hp: 280, buildTime: 120, dmg: 16, range: 3.5, atkCd: 32 },
  refinery:  { cost: 200, hp: 450, buildTime: 180 },
  palace:    { cost: 0,   hp: 1500, buildTime: 0 },
  spiceValue: { 5: 1, 6: 2 },
  wormInterval: 1400,
  wormLife: 600,
  startingCredits: 600,
}

export const BUILD_COSTS: Record<string, number> = {
  barracks: CONFIG.barracks.cost,
  factory: CONFIG.factory.cost,
  turret: CONFIG.turret.cost,
  refinery: CONFIG.refinery.cost,
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
export function isBuildable(terrain: number[], x: number, y: number, w: number, h: number) {
  if (!inBounds(x, y, w, h)) return false
  const t = terrain[idx(x, y, w)]
  return t === 1 || t === 2 || t === 3
}

export function buildingAt(s: GameState, x: number, y: number): Building | null {
  return s.buildings.find(b => b.x === x && b.y === y) || null
}

// ---------- Init ----------
export function createGame(width: number, height: number, terrain: number[], difficulty: 'easy'|'medium'|'hard'): GameState {
  const s: GameState = {
    width, height, terrain,
    buildings: [], units: [], worms: [],
    players: {
      atreides: { faction: 'atreides', credits: CONFIG.startingCredits, alive: true, isAI: false },
      harkonnen: { faction: 'harkonnen', credits: CONFIG.startingCredits, alive: true, isAI: true },
      ordos: { faction: 'ordos', credits: 0, alive: false, isAI: true },
      neutral: { faction: 'neutral', credits: 0, alive: false, isAI: false },
    },
    tick: 0, nextId: 1, events: [], difficulty, over: false, winner: null,
  }
  // AI bonus
  if (difficulty === 'medium') s.players.harkonnen.credits += 200
  if (difficulty === 'hard') { s.players.harkonnen.credits += 500 }

  // place palaces at opposite corners
  const px1 = 3, py1 = Math.floor(height / 2)
  const px2 = width - 4, py2 = Math.floor(height / 2)
  // ensure buildable
  for (const [bx, by, fac] of [[px1, py1, 'atreides'], [px2, py2, 'harkonnen']] as const) {
    for (let dy = 0; dy < 1; dy++)
      for (let dx = 0; dx < 1; dx++) {
        if (inBounds(bx, by, width, height)) terrain[idx(bx, by, width)] = 3 // rock platform
      }
    s.buildings.push({
      id: s.nextId++, type: 'palace', x: bx, y: by, owner: fac,
      hp: CONFIG.palace.hp, maxHp: CONFIG.palace.hp, cooldown: 0, queue: [],
    })
    // start with a harvester
    s.units.push(makeUnit(s, 'harvester', fac, bx, by + 1.5))
  }
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
  }
}

// ---------- Events ----------
export function logEvent(s: GameState, type: GameEvent['type'], msg: string) {
  s.events.push({ type, msg, t: s.tick })
  if (s.events.length > 30) s.events.shift()
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
  const cfg = CONFIG[type]
  s.buildings.push({
    id: s.nextId++, type, x, y, owner,
    hp: cfg.hp * 0.5, maxHp: cfg.hp, // starts half-built
    cooldown: 0, queue: [],
  })
  logEvent(s, 'build', `${owner === 'atreides' ? 'Вы строите' : 'ИИ строит'}: ${typeRu(type)}`)
  return true
}

export function queueUnit(s: GameState, bld: Building, type: UnitType): boolean {
  const cost = CONFIG[type].cost
  if (s.players[bld.owner].credits < cost) return false
  if (bld.hp < bld.maxHp * 0.5) return false // not built yet
  s.players[bld.owner].credits -= cost
  bld.queue.push({ type, progress: 0, cost })
  return true
}

// ---------- Unit commands (player) ----------
export function commandMove(s: GameState, unit: Unit, tx: number, ty: number) {
  // if target tile is not walkable, find nearest walkable tile nearby
  let fx = tx, fy = ty
  if (!isWalkable(s.terrain, Math.round(tx), Math.round(ty), s.width, s.height)) {
    let found = false
    for (let r = 1; r <= 6 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const cx = Math.round(tx) + dx, cy = Math.round(ty) + dy
          if (isWalkable(s.terrain, cx, cy, s.width, s.height)) {
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
  if (isBuilding) {
    unit.targetBldId = targetId
    unit.targetUnitId = null
  } else {
    unit.targetUnitId = targetId
    unit.targetBldId = null
  }
  unit.state = 'attack'
}

// ---------- Picking (selection) ----------
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
  updateWorms(s)
  if (s.players.harkonnen.alive) updateAI(s)

  // check win/lose
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
    if (b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + 2) // construction / repair

    // production
    if (b.queue.length > 0 && b.hp >= b.maxHp * 0.5) {
      const q = b.queue[0]
      q.progress++
      const cfg = CONFIG[q.type]
      if (q.progress >= cfg.buildTime) {
        // spawn unit near building
        const spawn = findSpawnTile(s, b)
        if (spawn) {
          const u = makeUnit(s, q.type, b.owner, spawn.x, spawn.y)
          s.units.push(u)
          b.queue.shift()
          if (b.owner === 'atreides') logEvent(s, 'build', `Создан: ${unitName(q.type)}`)
        } else {
          // no space — wait until a tile frees up (don't lose the queued unit)
          q.progress = cfg.buildTime
        }
      }
    }

    // turret auto-attack
    if (b.type === 'turret' && b.hp >= b.maxHp * 0.5) {
      b.cooldown = Math.max(0, b.cooldown - 1)
      if (b.cooldown === 0) {
        const target = findNearestEnemy(s, b.x, b.y, b.owner, CONFIG.turret.range)
        if (target) {
          target.hp -= CONFIG.turret.dmg
          b.cooldown = CONFIG.turret.atkCd
          if (target.hp <= 0) logEvent(s, 'death', `Турель уничтожила ${'cargo' in target ? unitName((target as Unit).type) : bldName((target as Building).type)}`)
        }
      }
    }
  }
  // remove dead buildings
  s.buildings = s.buildings.filter(b => b.hp > 0)
}

function findSpawnTile(s: GameState, b: Building): { x: number; y: number } | null {
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = b.x + dx, y = b.y + dy
        if (!isWalkable(s.terrain, x, y, s.width, s.height)) continue
        // skip if another building occupies this tile
        if (s.buildings.some(bb => bb.x === x && bb.y === y)) continue
        // skip if another unit is already here
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
    const d = dist(x, y, b.x, b.y)
    if (d < bestD) { bestD = d; best = b }
  }
  return best
}

function findNearestEnemyBuilding(s: GameState, x: number, y: number, owner: Faction, range = 99): Building | null {
  let best: Building | null = null
  let bestD = range
  for (const b of s.buildings) {
    if (b.owner === owner) continue
    const d = dist(x, y, b.x, b.y)
    if (d < bestD) { bestD = d; best = b }
  }
  return best
}

function findNearestSpice(s: GameState, x: number, y: number, range = 30): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestD = range
  // search spiral
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
    if (best && r > 4) break // found something close enough
  }
  return best
}

function findNearestFriendlyBuilding(s: GameState, x: number, y: number, owner: Faction, type?: BuildingType): Building | null {
  let best: Building | null = null
  let bestD = 99
  for (const b of s.buildings) {
    if (b.owner !== owner) continue
    if (type && b.type !== type) continue
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

    // ---- Harvester AI ----
    if (u.type === 'harvester') {
      if (u.state === 'idle') {
        if (u.cargo >= u.maxCargo) {
          const b = findNearestFriendlyBuilding(s, u.x, u.y, u.owner)
          if (b) { u.tx = b.x; u.ty = b.y; u.state = 'return' }
        } else {
          const sp = findNearestSpice(s, u.x, u.y)
          if (sp) { u.tx = sp.x; u.ty = sp.y; u.state = 'harvest' }
        }
      } else if (u.state === 'harvest') {
        // move toward spice
        const d = dist(u.x, u.y, u.tx, u.ty)
        if (d < 0.8) {
          // harvest
          u.harvestTime++
          if (u.harvestTime >= 8) {
            u.harvestTime = 0
            const tx = Math.floor(u.tx), ty = Math.floor(u.ty)
            if (inBounds(tx, ty, s.width, s.height)) {
              const ti = idx(tx, ty, s.width)
              const tval = s.terrain[ti]
              const gain = CONFIG.spiceValue[tval as 5 | 6] || 1
              u.cargo = Math.min(u.maxCargo, u.cargo + gain * 4)
              // deplete spice
              if (tval === 6) s.terrain[ti] = 5
              else if (tval === 5) s.terrain[ti] = 1
            }
            if (u.cargo >= u.maxCargo) {
              const b = findNearestFriendlyBuilding(s, u.x, u.y, u.owner)
              if (b) { u.tx = b.x; u.ty = b.y; u.state = 'return' }
              else u.state = 'idle'
            }
          }
        } else {
          moveToward(s, u, u.tx, u.ty, cfg.speed)
        }
      } else if (u.state === 'return') {
        const d = dist(u.x, u.y, u.tx, u.ty)
        if (d < 1.2) {
          // deposit
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

    // ---- Combat units ----
    if (u.state === 'idle') {
      // auto-acquire targets
      const enemy = findNearestEnemy(s, u.x, u.y, u.owner, cfg.range + 2)
      if (enemy) {
        if ('type' in enemy && (enemy.type === 'harvester' || enemy.type === 'soldier' || enemy.type === 'tank')) {
          u.targetUnitId = enemy.id
        } else {
          u.targetBldId = enemy.id
        }
        u.state = 'attack'
      }
    }

    if (u.state === 'attack') {
      let target: Unit | Building | null = null
      if (u.targetUnitId) target = s.units.find(x => x.id === u.targetUnitId) || null
      if (!target && u.targetBldId) target = s.buildings.find(x => x.id === u.targetBldId) || null
      if (!target) { u.state = 'idle'; u.targetUnitId = null; u.targetBldId = null; continue }

      const d = dist(u.x, u.y, (target as any).x, (target as any).y)
      if (d <= cfg.range) {
        // in range — attack
        if (u.cooldown <= 0) {
          (target as any).hp -= cfg.dmg
          u.cooldown = cfg.atkCd
          if (target.hp <= 0) {
            logEvent(s, 'death', `${unitName(u.type)} (${factionRu(u.owner)}) уничтожил ${'cargo' in target ? unitName((target as Unit).type) : bldName((target as Building).type)}`)
            u.targetUnitId = null; u.targetBldId = null
            u.state = 'idle'
          }
        }
      } else {
        // move toward target
        moveToward(s, u, (target as any).x, (target as any).y, cfg.speed)
      }
    }

    if (u.state === 'move') {
      const d = dist(u.x, u.y, u.tx, u.ty)
      if (d < 0.4) {
        u.state = 'idle'
      } else {
        moveToward(s, u, u.tx, u.ty, cfg.speed)
        // auto-attack only if enemy is right next to us (don't break long moves)
        const enemy = findNearestEnemy(s, u.x, u.y, u.owner, cfg.range * 0.6)
        if (enemy && 'type' in enemy) {
          u.targetUnitId = enemy.id
          u.state = 'attack'
        }
      }
    }
  }
  // remove dead units
  s.units = s.units.filter(u => u.hp > 0)
}

function moveToward(s: GameState, u: Unit, tx: number, ty: number, speed: number) {
  const dx = tx - u.x, dy = ty - u.y
  const d = Math.hypot(dx, dy)
  if (d < 0.05) return
  const ux = (dx / d) * speed
  const uy = (dy / d) * speed
  // candidate positions: full diagonal, x-only, y-only
  const candidates = [
    [u.x + ux, u.y + uy],
    [u.x + ux, u.y],        // x-only slide
    [u.x, u.y + uy],        // y-only slide
  ]
  for (const [nx, ny] of candidates) {
    const tileX = Math.round(nx), tileY = Math.round(ny)
    if (isWalkable(s.terrain, tileX, tileY, s.width, s.height)) {
      u.x = Math.max(0.5, Math.min(s.width - 0.5, nx))
      u.y = Math.max(0.5, Math.min(s.height - 0.5, ny))
      return
    }
  }
  // all blocked — try perpendicular nudge to unstick
  const nudge = 0.04
  const perp = [[u.x + uy, u.y - ux], [u.x - uy, u.y + ux], [u.x + ux*2, u.y], [u.x, u.y + uy*2]]
  for (const [nx, ny] of perp) {
    if (isWalkable(s.terrain, Math.round(nx), Math.round(ny), s.width, s.height)) {
      u.x = Math.max(0.5, Math.min(s.width - 0.5, nx + nudge * (Math.random()-0.5)))
      u.y = Math.max(0.5, Math.min(s.height - 0.5, ny + nudge * (Math.random()-0.5)))
      return
    }
  }
}

// ---------- Worm ----------
function updateWorms(s: GameState) {
  // spawn
  if (s.tick % CONFIG.wormInterval === 0 && s.worms.length < 1 && s.tick > 1000) {
    // find random sand tile far from bases
    for (let tries = 0; tries < 30; tries++) {
      const x = Math.floor(Math.random() * s.width)
      const y = Math.floor(Math.random() * s.height)
      const t = s.terrain[idx(x, y, s.width)]
      if (t === 1 || t === 2 || t === 5 || t === 6) {
        s.worms.push({ id: s.nextId++, x: x + 0.5, y: y + 0.5, tx: x + 0.5, ty: y + 0.5, life: CONFIG.wormLife, cooldown: 0 })
        logEvent(s, 'warn', 'Шай-Хулуд пробуждается!')
        break
      }
    }
  }

  for (const w of s.worms) {
    w.life--
    // find nearest unit on sand — prefer combat units, only target harvesters if very close
    let best: Unit | null = null
    let bestD = 8
    let bestHarvester: Unit | null = null
    let bestHD = 3
    for (const u of s.units) {
      const tx = Math.floor(u.x), ty = Math.floor(u.y)
      if (!inBounds(tx, ty, s.width, s.height)) continue
      const t = s.terrain[idx(tx, ty, s.width)]
      if (t !== 1 && t !== 2 && t !== 5 && t !== 6) continue
      const d = dist(w.x, w.y, u.x, u.y)
      if (u.type === 'harvester') {
        if (d < bestHD) { bestHD = d; bestHarvester = u }
      } else {
        if (d < bestD) { bestD = d; best = u }
      }
    }
    if (!best && bestHarvester) best = bestHarvester
    if (best) { w.tx = best.x; w.ty = best.y }
    else {
      // wander
      if (w.cooldown <= 0) {
        w.tx = Math.random() * s.width
        w.ty = Math.random() * s.height
        w.cooldown = 60
      }
      w.cooldown--
    }
    // move
    const dx = w.tx - w.x, dy = w.ty - w.y
    const d = Math.hypot(dx, dy)
    if (d > 0.1) {
      const sp = 0.035
      w.x += (dx / d) * sp
      w.y += (dy / d) * sp
    }
    // eat
    if (best && dist(w.x, w.y, best.x, best.y) < 0.8) {
      best.hp = 0
      logEvent(s, 'warn', `Червь сожрал ${unitName(best.type)}!`)
    }
  }
  s.worms = s.worms.filter(w => w.life > 0)
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

  const interval = s.difficulty === 'hard' ? 20 : s.difficulty === 'medium' ? 35 : 50
  if (s.tick % interval !== 0) return

  // build harvesters
  if (harvesters.length < 2 && player.credits >= CONFIG.harvester.cost && palace.queue.length === 0) {
    queueUnit(s, palace, 'harvester')
  }
  // build barracks
  if (!hasBarracks && player.credits >= CONFIG.barracks.cost) {
    tryAIBuild(s, owner, 'barracks', palace)
  }
  // build factory
  if (hasBarracks && !hasFactory && player.credits >= CONFIG.factory.cost) {
    tryAIBuild(s, owner, 'factory', palace)
  }
  // build turret if under pressure
  if (army.length < 3 && player.credits >= CONFIG.turret.cost && myBldgs.filter(b=>b.type==='turret').length < 2) {
    tryAIBuild(s, owner, 'turret', palace)
  }
  // produce army
  const barracks = myBldgs.find(b => b.type === 'barracks')
  if (barracks && barracks.queue.length === 0 && player.credits >= CONFIG.soldier.cost) {
    queueUnit(s, barracks, 'soldier')
  }
  const factory = myBldgs.find(b => b.type === 'factory')
  if (factory && factory.queue.length === 0 && player.credits >= CONFIG.tank.cost) {
    queueUnit(s, factory, 'tank')
  }

  // army orders
  const playerPalace = s.buildings.find(b => b.owner === 'atreides' && b.type === 'palace')
  const threat = s.units.filter(u => u.owner === 'atreides' && u.type !== 'harvester' && dist(u.x, u.y, palace.x, palace.y) < 6)
  if (threat.length > 0 && army.length > 0) {
    // defend: attack threats
    for (const a of army) {
      if (a.state === 'idle' || (a.state === 'move' && dist(a.x, a.y, palace.x, palace.y) > 8)) {
        commandAttack(s, a, threat[0].id, false)
      }
    }
  } else if (army.length >= (s.difficulty === 'hard' ? 4 : 6) && playerPalace) {
    // attack wave
    for (const a of army) {
      if (a.state === 'idle') {
        commandAttack(s, a, playerPalace.id, true)
      }
    }
  }
}

function tryAIBuild(s: GameState, owner: Faction, type: BuildingType, near: Building) {
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = near.x + dx, y = near.y + dy
        if (canBuild(s, owner, type, x, y)) {
          placeBuilding(s, owner, type, x, y)
          return true
        }
      }
    }
  }
  return false
}

// ---------- Russian names ----------
export function typeRu(t: string): string {
  const m: Record<string,string> = {
    palace:'Дворец', barracks:'Казармы', factory:'Фабрика', turret:'Турель', refinery:'Нефтезавод',
    harvester:'Доставщик', soldier:'Солдат', tank:'Танк',
  }
  return m[t] || t
}
export function unitName(t: UnitType): string {
  return { harvester: 'доставщик', soldier: 'солдат', tank: 'танк' }[t]
}
export function bldName(t: BuildingType): string {
  return { palace: 'дворец', barracks: 'казармы', factory: 'фабрику', turret: 'турель', refinery: 'нефтезавод' }[t]
}
export function factionRu(f: Faction): string {
  return { atreides: 'Атрейдес', harkonnen: 'Харконнен', ordos: 'Ордос', neutral: 'Нейтрал' }[f]
}
