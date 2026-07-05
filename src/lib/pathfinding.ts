// pathfinding.ts — A* pathfinding with obstacle grid + path cache
// Grid recalculated on building placement/destruction.
// Paths cached per unit, computed once when order issued.

type S = { width: number; height: number; terrain: number[]; buildings: any[]; units: any[]; terrainVersion: number; tick: number }

// ============================================================
//  OBSTACLE GRID
// ============================================================

let obstacleGrid: Uint8Array | null = null
let gridVersion = -1

export function getObstacleGrid(s: S): Uint8Array {
  if (!obstacleGrid || gridVersion !== s.terrainVersion) {
    const w = s.width, h = s.height
    obstacleGrid = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      const t = s.terrain[i]
      if (t !== 1 && t !== 2 && t !== 5 && t !== 6) obstacleGrid[i] = 1
    }
    for (const b of s.buildings) {
      for (let dy = 0; dy < b.h; dy++) {
        for (let dx = 0; dx < b.w; dx++) {
          const bx = b.x + dx, by = b.y + dy
          if (bx >= 0 && by >= 0 && bx < w && by < h) obstacleGrid[by * w + bx] = 1
        }
      }
    }
    gridVersion = s.terrainVersion
  }
  return obstacleGrid
}

export function isBlocked(s: S, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return true
  return getObstacleGrid(s)[y * s.width + x] === 1
}

// ============================================================
//  A* PATHFINDING (binary heap)
// ============================================================

function heuristic(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2)
}

export function findPath(s: S, fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number }[] | null {
  const fx = Math.round(fromX), fy = Math.round(fromY)
  const tx = Math.round(toX), ty = Math.round(toY)
  const w = s.width, h = s.height

  if (fx === tx && fy === ty) return [{ x: tx + 0.5, y: ty + 0.5 }]
  if (isBlocked(s, tx, ty)) {
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (!isBlocked(s, tx + dx, ty + dy)) return findPath(s, fromX, fromY, tx + dx, ty + dy)
        }
      }
    }
    return null
  }

  const grid = getObstacleGrid(s)
  const total = w * h
  const gScore = new Float32Array(total).fill(Infinity)
  const cameFrom = new Int32Array(total).fill(-1)
  const closed = new Uint8Array(total)

  // Simple priority queue (sorted array — fine for small maps)
  const openF = new Float32Array(total).fill(Infinity)
  const openIdx = new Int32Array(total).fill(-1)
  let openCount = 0

  const startIdx = fy * w + fx
  gScore[startIdx] = 0
  openF[startIdx] = heuristic(fx, fy, tx, ty)
  openIdx[startIdx] = startIdx
  openCount = 1

  const targetIdx = ty * w + tx
  const dirs = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1]
  let iterations = 0
  const maxIter = 2000

  while (openCount > 0 && iterations < maxIter) {
    iterations++
    // Find min in open set
    let minF = Infinity, minPos = -1
    for (let i = 0; i < total; i++) {
      if (openIdx[i] >= 0 && openF[i] < minF) { minF = openF[i]; minPos = i }
    }
    if (minPos < 0) break
    const current = openIdx[minPos]
    openIdx[minPos] = -1
    openCount--

    if (current === targetIdx) {
      const path: { x: number; y: number }[] = []
      let cur = targetIdx
      while (cur >= 0) {
        const cx = cur % w, cy = (cur - cx) / w
        path.unshift({ x: cx + 0.5, y: cy + 0.5 })
        cur = cameFrom[cur]
      }
      return simplifyPath(path)
    }

    if (closed[current]) continue
    closed[current] = 1

    const cx = current % w, cy = (current - cx) / w
    for (let d = 0; d < 16; d += 2) {
      const nx = cx + dirs[d], ny = cy + dirs[d + 1]
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const ni = ny * w + nx
      if (closed[ni] || grid[ni] === 1) continue
      if (d >= 8) {
        const ddx = dirs[d], ddy = dirs[d + 1]
        if (grid[cy * w + (cx + ddx)] === 1 || grid[(cy + ddy) * w + cx] === 1) continue
      }
      const cost = (d >= 8) ? 1.414 : 1.0
      const tg = gScore[current] + cost
      if (tg < gScore[ni]) {
        gScore[ni] = tg
        cameFrom[ni] = current
        const f = tg + heuristic(nx, ny, tx, ty)
        if (openIdx[ni] < 0) openCount++
        openF[ni] = f
        openIdx[ni] = ni
      }
    }
  }
  return null
}

function simplifyPath(path: { x: number; y: number }[]): { x: number; y: number }[] {
  if (path.length <= 2) return path
  const result: { x: number; y: number }[] = [path[0]]
  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1]
    const cur = path[i]
    const next = path[i + 1]
    const dx1 = cur.x - prev.x, dy1 = cur.y - prev.y
    const dx2 = next.x - cur.x, dy2 = next.y - cur.y
    if (Math.abs(dx1 * dy2 - dx2 * dy1) > 0.01) result.push(cur)
  }
  result.push(path[path.length - 1])
  return result
}

// ============================================================
//  UNIT MOVEMENT
// ============================================================

function isTileOccupiedByUnit(s: S, tileX: number, tileY: number, exceptId: number): boolean {
  for (const u of s.units) {
    if (u.id === exceptId) continue
    if (Math.round(u.x) === tileX && Math.round(u.y) === tileY) return true
  }
  return false
}

export function followPath(s: S, u: any, speed: number): boolean {
  if (!u.path || u.path.length === 0 || u.pathIdx >= u.path.length) {
    return moveDirectly(s, u, u.tx, u.ty, speed)
  }
  const wp = u.path[u.pathIdx]
  const d = Math.hypot(wp.x - u.x, wp.y - u.y)
  if (d < 0.3) {
    u.pathIdx++
    u.waitTicks = 0
    if (u.pathIdx >= u.path.length) {
      u.path = []
      u.pathIdx = 0
      return moveDirectly(s, u, u.tx, u.ty, speed)
    }
    return false
  }
  const nextTileX = Math.round(wp.x), nextTileY = Math.round(wp.y)
  if (isTileOccupiedByUnit(s, nextTileX, nextTileY, u.id)) {
    u.waitTicks++
    if (u.waitTicks > 30) {
      u.path = []
      u.pathIdx = 0
      u.waitTicks = 0
    }
    return false
  }
  u.waitTicks = 0
  return moveDirectly(s, u, wp.x, wp.y, speed)
}

function moveDirectly(s: S, u: any, tx: number, ty: number, speed: number): boolean {
  const dx = tx - u.x, dy = ty - u.y
  const d = Math.hypot(dx, dy)
  if (d < 0.05) return true
  u.facing = Math.atan2(dy, dx)
  if (d < speed * 2) {
    u.x = Math.max(0.5, Math.min(s.width - 0.5, u.x + (dx / d) * Math.min(speed, d)))
    u.y = Math.max(0.5, Math.min(s.height - 0.5, u.y + (dy / d) * Math.min(speed, d)))
    return d < 0.3
  }
  const moveX = (dx / d) * speed
  const moveY = (dy / d) * speed
  const newX = u.x + moveX, newY = u.y + moveY
  const tileX = Math.round(newX), tileY = Math.round(newY)
  // Try diagonal first
  if (!isBlocked(s, tileX, tileY) && !isTileOccupiedByUnit(s, tileX, tileY, u.id)) {
    u.x = Math.max(0.5, Math.min(s.width - 0.5, newX))
    u.y = Math.max(0.5, Math.min(s.height - 0.5, newY))
    return false
  }
  // Slide X
  if (!isBlocked(s, Math.round(newX), Math.round(u.y)) && !isTileOccupiedByUnit(s, Math.round(newX), Math.round(u.y), u.id)) {
    u.x = Math.max(0.5, Math.min(s.width - 0.5, newX))
    return false
  }
  // Slide Y
  if (!isBlocked(s, Math.round(u.x), Math.round(newY)) && !isTileOccupiedByUnit(s, Math.round(u.x), Math.round(newY), u.id)) {
    u.y = Math.max(0.5, Math.min(s.height - 0.5, newY))
    return false
  }
  // All blocked — try perpendicular nudge to unstick
  const perp = [u.x + moveY, u.y - moveX, u.x - moveY, u.y + moveX]
  for (let i = 0; i < 4; i += 2) {
    const px = perp[i], py = perp[i + 1]
    if (!isBlocked(s, Math.round(px), Math.round(py)) && !isTileOccupiedByUnit(s, Math.round(px), Math.round(py), u.id)) {
      u.x = Math.max(0.5, Math.min(s.width - 0.5, px))
      u.y = Math.max(0.5, Math.min(s.height - 0.5, py))
      return false
    }
  }
  // Truly stuck — replan path next tick
  u.path = []
  u.pathIdx = 0
  return false
}

// ============================================================
//  PATH CACHE
// ============================================================

export function computePath(s: S, u: any): void {
  const path = findPath(s, u.x, u.y, u.tx, u.ty)
  if (path && path.length > 1) {
    u.path = path
    u.pathIdx = 1
    u.waitTicks = 0
  } else {
    // A* failed — clear path, unit will use direct movement (followPath fallback)
    u.path = []
    u.pathIdx = 0
  }
}

export function invalidatePathCache(): void {
  obstacleGrid = null
  gridVersion = -1
}
