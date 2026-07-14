// entity.ts — Base class hierarchy for all game objects
// Entity → Building / Unit → concrete classes
// Abilities via interfaces (IAttacker, IProducer, IHarvester, etc.)

import { Faction, BuildingType, UnitType } from './tile-renderer'

// ============================================================
//  ABILITY INTERFACES (composable capabilities)
// ============================================================

/** Can attack targets (units, buildings, worms) */
export interface IAttacker {
  damage: number
  range: number
  atkCd: number
  cooldown: number
  /** Fire a projectile at target */
  attack(s: GameState, target: Entity): void
}

/** Can produce units (barracks, factory, palace) */
export interface IProducer {
  queue: ProductionItem[]
  /** What unit types this can produce */
  producibleTypes(): UnitType[]
  /** Start producing a unit */
  produce(s: GameState, type: UnitType): boolean
}

/** Can harvest spice (harvester) */
export interface IHarvester {
  cargo: number
  maxCargo: number
  harvestTime: number
}

/** Produces energy (generator, palace) */
export interface IPowerSource {
  energyOutput: number
}

/** Consumes energy (most buildings, some units) */
export interface IPowerConsumer {
  energyDemand: number
}

/** Can research upgrades (barracks, factory, turret) */
export interface IResearcher {
  research?: ResearchState
  startResearch(s: GameState, id: string): boolean
}

/** Has extended vision (radar) */
export interface IVision {
  visionRange: number
}

// ============================================================
//  SHARED TYPES
// ============================================================

export interface ProductionItem {
  type: UnitType
  progress: number
  cost: number
}

export interface ResearchState {
  type: string
  progress: number
  totalTime: number
}

export type UnitState = 'idle' | 'move' | 'attack' | 'harvest' | 'return'

// Forward declaration for GameState (circular dependency)
export interface GameState {
  width: number
  height: number
  terrain: number[]
  entities: Entity[]  // unified list (buildings + units)
  worms: any[]
  projectiles: any[]
  explosions: any[]
  flashes: any[]
  players: Record<Faction, any>
  explored: boolean[]
  visible: boolean[]
  tick: number
  nextId: number
  events: any[]
  difficulty: 'easy' | 'medium' | 'hard'
  over: boolean
  winner: Faction | null
  terrainVersion: number
}

// ============================================================
//  BASE ENTITY (abstract)
// ============================================================

export abstract class Entity {
  id: number
  x: number        // top-left tile (buildings) or float center (units)
  y: number
  w: number = 1    // footprint width in tiles
  h: number = 1    // footprint height in tiles
  hp: number
  maxHp: number
  owner: Faction
  facing: number = 0    // angle in radians (for vehicles)
  solid: boolean = true   // blocks movement
  movable: boolean = false  // can change position
  selectable: boolean = true

  constructor(id: number, x: number, y: number, owner: Faction, hp: number) {
    this.id = id
    this.x = x
    this.y = y
    this.owner = owner
    this.hp = hp
    this.maxHp = hp
  }

  // --- Getters ---
  get isBuilt(): boolean { return this.hp >= this.maxHp }
  get isDead(): boolean { return this.hp <= 0 }
  get cx(): number { return this.x + this.w / 2 }
  get cy(): number { return this.y + this.h / 2 }

  distanceTo(other: Entity): number {
    return Math.hypot(this.cx - other.cx, this.cy - other.cy)
  }

  /** Type identifier for rendering, logging, etc. */
  abstract get type(): string

  /** Called every game tick — update state */
  abstract update(s: GameState): void

  /** Render to canvas — called every frame */
  abstract render(ctx: CanvasRenderingContext2D, animPhase: number): void

  /** Get a description string for UI panel */
  getDescription(): string { return this.type }
}

// ============================================================
//  BUILDING (abstract) extends Entity
// ============================================================

export abstract class Building extends Entity {
  w = 2
  h = 2
  solid = true
  movable = false
  level: number = 1
  cooldown: number = 0
  queue: ProductionItem[] = []   // shared on base for UI access
  research?: ResearchState       // shared on base for UI access

  // --- Energy (override in subclass) ---
  energyDemand(): number { return 0 }
  energyOutput(): number { return 0 }

  // --- Vision (for fog of war) ---
  visionRange(): number { return 3 }

  // --- Abilities (override to enable) ---
  canProduce(): boolean { return false }
  canAttack(): boolean { return false }
  canResearch(): boolean { return false }
  isPowerSource(): boolean { return false }
  isRadar(): boolean { return false }

  /** Called every tick if building is fully built */
  update(s: GameState): void {
    // Base: do nothing. Subclasses override.
  }

  render(ctx: CanvasRenderingContext2D, animPhase: number): void {
    // Delegated to tile-renderer (dimetric sprite system)
  }
}

// ============================================================
//  UNIT (abstract) extends Entity
// ============================================================

export abstract class Unit extends Entity {
  w = 1
  h = 1
  solid = false
  movable = true
  state: UnitState = 'idle'
  tx: number
  ty: number
  speed: number
  cooldown: number = 0
  homeX: number
  homeY: number
  stuckTicks: number = 0
  lastX: number
  lastY: number
  targetUnitId: number | null = null
  targetBldId: number | null = null
  path: { x: number; y: number }[] = []  // A* waypoints (tile centers)
  pathIdx: number = 0                     // current waypoint index
  waitTicks: number = 0                   // ticks waiting for blocked tile

  constructor(id: number, x: number, y: number, owner: Faction, hp: number, speed: number) {
    super(id, x, y, owner, hp)
    this.tx = Math.round(x)
    this.ty = Math.round(y)
    this.speed = speed
    this.homeX = x
    this.homeY = y
    this.lastX = x
    this.lastY = y
  }

  // --- Abilities (override to enable) ---
  canAttack(): boolean { return false }
  canHarvest(): boolean { return false }

  /** Attack stats (if IAttacker) */
  damage(): number { return 0 }
  range(): number { return 0 }
  atkCd(): number { return 0 }

  /** Move toward target tile */
  moveTo(tx: number, ty: number): void {
    this.tx = tx
    this.ty = ty
    this.targetUnitId = null
    this.targetBldId = null
    this.state = 'move'
  }

  /** Attack a target entity */
  attackTarget(targetId: number, isBuilding: boolean): void {
    if (isBuilding) {
      this.targetBldId = targetId
      this.targetUnitId = null
    } else {
      this.targetUnitId = targetId
      this.targetBldId = null
    }
    this.state = 'attack'
  }

  /** Return to home position after combat */
  returnHome(): void {
    const d = Math.hypot(this.x - this.homeX, this.y - this.homeY)
    if (d > 1.5) {
      this.tx = this.homeX
      this.ty = this.homeY
      this.state = 'move'
    } else {
      this.state = 'idle'
    }
    this.targetUnitId = null
    this.targetBldId = null
  }

  update(s: GameState): void {
    // Base movement/AI — subclasses override for specific behavior
    if (this.cooldown > 0) this.cooldown--

    // Stuck detection
    if (Math.abs(this.x - this.lastX) < 0.01 && Math.abs(this.y - this.lastY) < 0.01) {
      this.stuckTicks++
      if (this.stuckTicks > 15 && this.state === 'move') {
        this.state = 'idle'
        this.stuckTicks = 0
      }
    } else {
      this.stuckTicks = 0
    }
    this.lastX = this.x
    this.lastY = this.y
  }
}

// ============================================================
//  CONCRETE BUILDINGS
// ============================================================

export class Palace extends Building implements IProducer {
  w = 2; h = 2
  get type() { return 'palace' }

  energyOutput(): number { return 6 }
  canProduce(): boolean { return true }

  producibleTypes(): UnitType[] { return ['harvester'] }
  produce(s: GameState, type: UnitType): boolean {
    if (type !== 'harvester') return false
    this.queue.push({ type, progress: 0, cost: 150 })
    return true
  }
}

export class Generator extends Building implements IPowerSource {
  w = 2; h = 2
  get type() { return 'generator' }
  energyOutputVal: number = 12

  isPowerSource(): boolean { return true }
  energyOutput(): number { return this.energyOutputVal * this.level }
  energyDemand(): number { return 0 }

  upgrade(): boolean {
    if (this.level >= 3) return false
    this.level++
    this.maxHp += 100
    this.hp = this.maxHp
    return true
  }
}

export class Barracks extends Building implements IProducer, IResearcher, IPowerConsumer {
  w = 2; h = 2
  get type() { return 'barracks' }

  energyDemand(): number { return 3 }
  canProduce(): boolean { return true }
  canResearch(): boolean { return true }
  producibleTypes(): UnitType[] { return ['soldier'] }
  produce(s: GameState, type: UnitType): boolean {
    if (type !== 'soldier') return false
    this.queue.push({ type, progress: 0, cost: 60 })
    return true
  }
  startResearch(s: GameState, id: string): boolean {
    if (this.research) return false
    this.research = { type: id, progress: 0, totalTime: 150 }
    return true
  }
}

export class Factory extends Building implements IProducer, IResearcher, IPowerConsumer {
  w = 3; h = 2
  get type() { return 'factory' }

  energyDemand(): number { return 5 }
  canProduce(): boolean { return true }
  canResearch(): boolean { return true }
  producibleTypes(): UnitType[] { return ['tank'] }
  produce(s: GameState, type: UnitType): boolean {
    if (type !== 'tank') return false
    this.queue.push({ type, progress: 0, cost: 200 })
    return true
  }
  startResearch(s: GameState, id: string): boolean {
    if (this.research) return false
    this.research = { type: id, progress: 0, totalTime: 200 }
    return true
  }
}

export class Turret extends Building implements IAttacker, IResearcher, IPowerConsumer {
  w = 1; h = 1
  get type() { return 'turret' }
  damage = 16
  range = 4.5
  atkCd = 32
  cooldown = 0

  energyDemand(): number { return 2 }
  canAttack(): boolean { return true }
  canResearch(): boolean { return true }

  attack(s: GameState, target: Entity): void {
    // Spawn projectile (delegated to game-engine)
    this.cooldown = this.atkCd
  }
  startResearch(s: GameState, id: string): boolean {
    if (this.research) return false
    this.research = { type: id, progress: 0, totalTime: 150 }
    return true
  }
}

export class Refinery extends Building implements IPowerConsumer {
  w = 2; h = 2
  get type() { return 'refinery' }
  energyDemand(): number { return 2 }

  // Spice storage. Harvesters unload raw spice here; the refinery slowly
  // refines it into credits. Capacity = 3.5 × harvester maxCargo (= 210).
  // While the stock is full, harvesters wait at the unload point.
  spiceStock: number = 0
  maxSpiceStock: number = 210   // 3.5 × 60 (harvester maxCargo)
  // Refining rate: spice units converted to credits per tick.
  // Harvester unloads at 8/tick (80/s), refinery refines at 0.3/tick (3/s).
  // → a full load (60) takes ~20s to refine, so stock accumulates visibly
  // and the 210 buffer actually fills up if multiple harvesters queue.
  refineRate: number = 0.3

  update(s: GameState): void {
    super.update(s)
    if (this.hp < this.maxHp) return  // not built yet
    if (this.spiceStock <= 0) return
    // Refine a small slice each tick → credits
    const convert = Math.min(this.spiceStock, this.refineRate)
    this.spiceStock -= convert
    const credits = Math.round(convert * 5)
    s.players[this.owner].credits += credits
    if (this.owner === 'atreides' && credits > 0 && s.tick % 6 === 0) {
      // log occasionally to avoid spam
      s.events.unshift({ id: s.nextId++, tick: s.tick, type: 'spice', text: `+${credits}$ (переработка спайса)` })
      if (s.events.length > 12) s.events.pop()
    }
  }
}

export class Radar extends Building implements IVision, IPowerConsumer {
  w = 2; h = 2
  get type() { return 'radar' }
  energyDemand(): number { return 3 }
  isRadar(): boolean { return true }
  visionRange(): number { return 12 }
}

export class TechLab extends Building implements IResearcher, IPowerConsumer {
  w = 2; h = 2
  get type() { return 'techlab' }
  energyDemand(): number { return 4 }
  canResearch(): boolean { return true }

  // Tech lab unlocks new unit types and abilities at each level
  // Level 1 (base): basic research (turret dmg, unit speed, etc.)
  // Level 2: unlocks heavy tank
  // Level 3: unlocks stealth soldier + orbital strike
  upgrade(): boolean {
    if (this.level >= 3) return false
    this.level++
    this.maxHp += 100
    this.hp = this.maxHp
    return true
  }
  startResearch(s: GameState, id: string): boolean {
    if (this.research) return false
    this.research = { type: id, progress: 0, totalTime: 200 }
    return true
  }
}

// ============================================================
//  CONCRETE UNITS
// ============================================================

export class Harvester extends Unit implements IHarvester {
  get type() { return 'harvester' }
  cargo: number = 0
  maxCargo: number = 60
  harvestTime: number = 0

  canHarvest(): boolean { return true }

  update(s: GameState): void {
    super.update(s)
    // Harvester AI: find spice → harvest → return to refinery → unload
    // (full logic delegated to game-engine for pathfinding/access)
  }
}

export class Soldier extends Unit implements IAttacker {
  get type() { return 'soldier' }
  damage = 9
  range = 1.8
  atkCd = 28
  cooldown = 0

  canAttack(): boolean { return true }
  attack(s: GameState, target: Entity): void {
    this.cooldown = this.atkCd
  }
}

export class Tank extends Unit implements IAttacker {
  get type() { return 'tank' }
  damage = 22
  range = 2.8
  atkCd = 40
  cooldown = 0

  canAttack(): boolean { return true }
  attack(s: GameState, target: Entity): void {
    this.cooldown = this.atkCd
  }
}

// ============================================================
//  FACTORY — create entities by type
// ============================================================

export function createBuilding(type: BuildingType, id: number, x: number, y: number, owner: Faction): Building {
  const hpMap: Record<string, number> = {
    palace: 1500, generator: 300, barracks: 400, factory: 550,
    turret: 280, refinery: 450, radar: 250, techlab: 350,
  }
  const hp = hpMap[type] || 300
  let b: Building
  switch (type) {
    case 'palace':      b = new Palace(id, x, y, owner, hp); break
    case 'generator':   b = new Generator(id, x, y, owner, hp); break
    case 'barracks':    b = new Barracks(id, x, y, owner, hp); break
    case 'factory':     b = new Factory(id, x, y, owner, hp); break
    case 'turret':      b = new Turret(id, x, y, owner, hp); break
    case 'refinery':    b = new Refinery(id, x, y, owner, hp); break
    case 'radar':       b = new Radar(id, x, y, owner, hp); break
    case 'techlab':     b = new TechLab(id, x, y, owner, hp); break
    default: throw new Error(`Unknown building type: ${type}`)
  }
  b.hp = hp * 0.5  // starts half-built (except palace — set in createGame)
  return b
}

export function createUnit(type: UnitType, id: number, x: number, y: number, owner: Faction): Unit {
  const hpSpeedMap: Record<string, { hp: number; speed: number }> = {
    harvester: { hp: 200, speed: 0.15 },
    soldier:   { hp: 70,  speed: 0.12 },
    tank:      { hp: 160, speed: 0.09 },
  }
  const { hp, speed } = hpSpeedMap[type] || { hp: 100, speed: 0.1 }
  switch (type) {
    case 'harvester': return new Harvester(id, x, y, owner, hp, speed)
    case 'soldier':   return new Soldier(id, x, y, owner, hp, speed)
    case 'tank':      return new Tank(id, x, y, owner, hp, speed)
    default: throw new Error(`Unknown unit type: ${type}`)
  }
}

// ============================================================
//  TYPE GUARDS
// ============================================================

export function isBuilding(e: Entity): e is Building {
  return e instanceof Building
}
export function isUnit(e: Entity): e is Unit {
  return e instanceof Unit
}
export function isAttacker(e: Entity): e is Entity & IAttacker {
  return 'damage' in e && 'range' in e && 'attack' in e
}
export function isProducer(e: Entity): e is Entity & IProducer {
  return 'queue' in e && 'produce' in e
}
export function isHarvester(e: Entity): e is Entity & IHarvester {
  return 'cargo' in e && 'maxCargo' in e
}
export function isPowerSource(e: Entity): e is Entity & IPowerSource {
  return 'energyOutput' in e && typeof (e as any).energyOutput === 'number'
}
export function isResearcher(e: Entity): e is Entity & IResearcher {
  return 'research' in e && 'startResearch' in e
}
