'use client'

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Brush, Eraser, PaintBucket, Square, Grid3x3, Save, FolderOpen,
  Download, Upload, Trash2, Undo2, Redo2, Hand, Sparkles,
  Play, Pause, Home, Hammer, Sword, Coins, Skull, Trophy, Eye, Zap, Maximize, Minimize,
  ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  TERRAIN, TILE_SIZE, drawTerrainLayer, drawBuilding, drawUnit, drawWorm,
  drawHealthBar, drawSelectionRing, drawMoveMarker,
  drawProjectile, drawExplosion, drawMuzzleFlash,
  drawRangeIndicator, drawFogOfWar, drawEnergyIcon,
  getTilePreview, getBuildingPreview, getUnitPreview,
  clearTerrainCache,
  FACTION_COLORS, type Faction, type BuildingType, type UnitType,
} from '@/lib/tile-renderer'
import {
  createGame, tick, CONFIG, BUILD_COSTS, FOOTPRINT, TECHNOLOGIES, BUILDING_UPGRADES, UPGRADE_DEFS, type GameState, type Unit, type Building,
  canBuild, placeBuilding, queueUnit, commandMove, commandAttack,
  cancelQueueItem, startTechResearch, startBuildingUpgrade, isTechResearched, getUpgrade, getUpgradeLevel, upgradeCost, upgradeTime, isUpgradeLevelUnlocked, upgradeGenerator, upgradeTurret,
  idx, isWalkable, isBuildable, buildingAt, dist, inBounds,
  pickUnitAt, pickBuildingAt, hasPower,
  typeRu, unitName, bldName, factionRu,
} from '@/lib/game-engine'

// ============================================================
//  EDITOR
// ============================================================
type Tool = 'brush' | 'eraser' | 'fill' | 'rect'

const TERRAIN_LIST = Object.values(TERRAIN)
const EDITOR_TILES = [
  { id: 0, cat: 'terrain' }, { id: 1, cat: 'terrain' }, { id: 2, cat: 'terrain' },
  { id: 3, cat: 'terrain' }, { id: 4, cat: 'terrain' }, { id: 5, cat: 'terrain' },
  { id: 6, cat: 'terrain' }, { id: 7, cat: 'terrain' },
]
const CATEGORY_LABELS: Record<string, string> = {
  terrain: 'Рельеф', resource: 'Ресурсы', building: 'Здания', unit: 'Юниты'
}

function emptyGrid(w: number, h: number): number[] {
  return new Array(w * h).fill(1)
}

// Generate a varied, visually interesting default map (sand + spice + dunes + rock + water)
function generateDefaultMap(w: number, h: number): number[] {
  const g = new Array(w * h).fill(1)
  const rng = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff } })()

  // ---- Terrain features for visual interest ----
  // 1. Large dune seas (rolling sand areas, 6-8 patches)
  const duneCount = Math.max(6, Math.floor(w * h / 400))
  for (let i = 0; i < duneCount; i++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h)
    const r = 3 + Math.floor(rng() * 4)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      if (dx*dx + dy*dy <= r*r && rng() > 0.3) g[y*w+x] = 2
    }
  }
  // 2. Rock plateaus (buildable but visually distinct, 5-7 patches)
  const rockCount = Math.max(5, Math.floor(w * h / 500))
  for (let i = 0; i < rockCount; i++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h)
    const r = 2 + Math.floor(rng() * 3)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      if (dx*dx + dy*dy <= r*r) g[y*w+x] = 3
    }
  }
  // 3. Mountain peaks (on rock, 4-6 of them)
  const mountainCount = Math.max(4, Math.floor(w * h / 700))
  for (let i = 0; i < mountainCount; i++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h)
    if (g[cy*w+cx] === 3) {
      // cluster of mountains
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx+dx, y = cy+dy
        if (x>=0&&y>=0&&x<w&&y<h && g[y*w+x]===3 && rng()>0.5) g[y*w+x]=4
      }
    }
  }
  // 4. Water lakes / oases (2-3, create strategic chokepoints)
  const waterCount = Math.max(2, Math.floor(w * h / 900))
  for (let i = 0; i < waterCount; i++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h)
    const r = 2 + Math.floor(rng() * 2)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      if (dx*dx + dy*dy <= r*r) g[y*w+x] = 7
    }
  }
  // 5. Spice fields — more, larger, scattered (main resource driver)
  //    Rich spice (6) near sand, regular spice (5) elsewhere
  const spiceCount = Math.max(7, Math.floor(w * h / 250))
  for (let i = 0; i < spiceCount; i++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h)
    const r = 2 + Math.floor(rng() * 3)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const idx = y*w+x
      // spice can be on sand or dunes, not on rock/water/mountain
      if (g[idx] === 1 || g[idx] === 2) {
        if (rng() > 0.25) g[idx] = rng() > 0.4 ? 5 : 6
      }
    }
  }
  // 6. A diagonal spice-rich "vein" through the map center (creates
  //    contested territory players will fight over)
  const veinLen = Math.floor(Math.min(w, h) * 0.7)
  const startX = Math.floor(w * 0.15), startY = Math.floor(h * 0.15)
  for (let i = 0; i < veinLen; i++) {
    const t = i / veinLen
    // gentle curve
    const cx = Math.floor(startX + t * (w * 0.7) + Math.sin(t * Math.PI) * 3)
    const cy = Math.floor(startY + t * (h * 0.7) + Math.cos(t * Math.PI) * 3)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx+dx, y = cy+dy
      if (x<0||y<0||x>=w||y>=h) continue
      const idx = y*w+x
      if (g[idx] === 1 || g[idx] === 2) {
        if (rng() > 0.3) g[idx] = rng() > 0.3 ? 6 : 5  // mostly rich spice
      }
    }
  }
  // 7. clear corners for bases (atreides left, harkonnen right)
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (Math.abs(dx) + Math.abs(dy) <= 4) {
      if (3+dx >= 0 && Math.floor(h/2)+dy >= 0 && 3+dx < w && Math.floor(h/2)+dy < h) g[(Math.floor(h/2)+dy)*w + (3+dx)] = 1
      if (w-4+dx >= 0 && Math.floor(h/2)+dy >= 0 && w-4+dx < w && Math.floor(h/2)+dy < h) g[(Math.floor(h/2)+dy)*w + (w-4+dx)] = 1
    }
  }
  return g
}

function floodFill(grid: number[], w: number, h: number, x: number, y: number, target: number, repl: number): number[] {
  if (target === repl) return grid
  const r = [...grid]; const st = [[x, y]]
  while (st.length) {
    const [cx, cy] = st.pop()!
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue
    const i = cy * w + cx
    if (r[i] !== target) continue
    r[i] = repl
    st.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1])
  }
  return r
}

// ============================================================
//  MAIN COMPONENT
// ============================================================
export default function EditorPage() {
  const [mode, setMode] = useState<'menu' | 'editor' | 'game'>('menu')
  const [difficulty, setDifficulty] = useState<'easy'|'medium'|'hard'>('medium')
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Fullscreen API — hides browser UI (kiosk mode)
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }, [])
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // editor state
  const [gridW, setGridW] = useState(64)
  const [gridH, setGridH] = useState(64)
  const [grid, setGrid] = useState<number[]>(() => generateDefaultMap(64, 64))
  const [terrainVer, setTerrainVer] = useState(0)  // bump to invalidate terrain cache
  // invalidate terrain cache whenever grid changes
  useEffect(() => { clearTerrainCache(); setTerrainVer(v => v + 1) }, [grid, gridW, gridH])
  const [selectedTile, setSelectedTile] = useState(1)
  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(1)
  const [showGrid, setShowGrid] = useState(false)
  const [history, setHistory] = useState<number[][]>([])
  const [redoStack, setRedoStack] = useState<number[][]>([])
  const [mapName, setMapName] = useState('Арракис')
  const [hoverCell, setHoverCell] = useState<{x:number,y:number}|null>(null)
  const [rectStart, setRectStart] = useState<{x:number,y:number}|null>(null)
  const [previewGrid, setPreviewGrid] = useState<number[] | null>(null)
  const editorCanvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // tile previews
  const [previews, setPreviews] = useState<Record<number, string>>({})
  useEffect(() => {
    const p: Record<number, string> = {}
    for (const t of EDITOR_TILES) p[t.id] = getTilePreview(t.id, 40)
    setPreviews(p)
  }, [])

  // ---- editor drawing ----
  const drawEditor = useCallback(() => {
    const c = editorCanvasRef.current; if (!c) return
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    c.width = gridW * TILE_SIZE; c.height = gridH * TILE_SIZE
    const g = previewGrid ?? grid
    drawTerrainLayer(ctx, g, gridW, gridH, Date.now() / 400, terrainVer)
    if (showGrid) {
      ctx.strokeStyle = 'rgba(80,50,15,0.18)'; ctx.lineWidth = 1
      for (let x = 0; x <= gridW; x++) { ctx.beginPath(); ctx.moveTo(x*TILE_SIZE+0.5,0); ctx.lineTo(x*TILE_SIZE+0.5,gridH*TILE_SIZE); ctx.stroke() }
      for (let y = 0; y <= gridH; y++) { ctx.beginPath(); ctx.moveTo(0,y*TILE_SIZE+0.5); ctx.lineTo(gridW*TILE_SIZE,y*TILE_SIZE+0.5); ctx.stroke() }
    }
    if (hoverCell) {
      const s = brushSize; const half = Math.floor(s/2)
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2
      ctx.strokeRect((hoverCell.x-half)*TILE_SIZE+1, (hoverCell.y-half)*TILE_SIZE+1, s*TILE_SIZE-2, s*TILE_SIZE-2)
    }
    if (tool === 'rect' && rectStart && hoverCell) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([4,4])
      const x1=Math.min(rectStart.x,hoverCell.x), y1=Math.min(rectStart.y,hoverCell.y)
      const x2=Math.max(rectStart.x,hoverCell.x), y2=Math.max(rectStart.y,hoverCell.y)
      ctx.strokeRect(x1*TILE_SIZE, y1*TILE_SIZE, (x2-x1+1)*TILE_SIZE, (y2-y1+1)*TILE_SIZE)
      ctx.setLineDash([])
    }
  }, [grid, gridW, gridH, showGrid, hoverCell, brushSize, tool, rectStart, previewGrid, terrainVer])

  useEffect(() => { if (mode === 'editor') drawEditor() }, [drawEditor, mode])

  const pushHistory = (prev: number[]) => {
    setHistory(h => { const n = [...h, prev]; return n.length > 50 ? n.slice(-50) : n })
    setRedoStack([])
  }
  const paintAt = (x: number, y: number, g: number[], tile: number): number[] => {
    const r = [...g]; const half = Math.floor(brushSize/2)
    for (let dy = 0; dy < brushSize; dy++)
      for (let dx = 0; dx < brushSize; dx++) {
        const nx = x-half+dx, ny = y-half+dy
        if (nx<0||ny<0||nx>=gridW||ny>=gridH) continue
        r[ny*gridW+nx] = tile
      }
    return r
  }
  const cellFromEvt = (e: React.MouseEvent) => {
    const c = editorCanvasRef.current!; const r = c.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * gridW)
    const y = Math.floor(((e.clientY - r.top) / r.height) * gridH)
    if (x<0||y<0||x>=gridW||y>=gridH) return null
    return { x, y }
  }
  const onDown = (e: React.MouseEvent) => {
    const cell = cellFromEvt(e); if (!cell) return
    pushHistory(grid)
    if (tool === 'fill') {
      const t = grid[cell.y*gridW+cell.x]
      setGrid(floodFill(grid, gridW, gridH, cell.x, cell.y, t, selectedTile)); return
    }
    if (tool === 'rect') { setRectStart(cell); return }
    isDrawing.current = true
    setGrid(prev => paintAt(cell.x, cell.y, prev, tool === 'eraser' ? 0 : selectedTile))
  }
  const onMove = (e: React.MouseEvent) => {
    const cell = cellFromEvt(e); setHoverCell(cell); if (!cell) return
    if (tool === 'rect' && rectStart) {
      const half = Math.floor(brushSize/2)
      const x1=Math.min(rectStart.x,cell.x), y1=Math.min(rectStart.y,cell.y)
      const x2=Math.max(rectStart.x,cell.x), y2=Math.max(rectStart.y,cell.y)
      const p = [...grid]
      for (let y=y1;y<=y2;y++) for (let x=x1;x<=x2;x++)
        for (let dy=0;dy<brushSize;dy++) for (let dx=0;dx<brushSize;dx++) {
          const nx=x-half+dx, ny=y-half+dy
          if (nx<0||ny<0||nx>=gridW||ny>=gridH) continue
          p[ny*gridW+nx] = selectedTile
        }
      setPreviewGrid(p); return
    }
    if (!isDrawing.current) return
    setGrid(prev => paintAt(cell.x, cell.y, prev, tool === 'eraser' ? 0 : selectedTile))
  }
  const onUp = () => {
    if (tool === 'rect' && rectStart && previewGrid) { setGrid(previewGrid); setPreviewGrid(null); setRectStart(null) }
    isDrawing.current = false
  }
  const onLeave = () => { setHoverCell(null); isDrawing.current = false; if (previewGrid) { setPreviewGrid(null); setRectStart(null) } }

  const undo = () => { if (!history.length) return; const p = history[history.length-1]; setHistory(h=>h.slice(0,-1)); setRedoStack(r=>[...r,grid]); setGrid(p) }
  const redo = () => { if (!redoStack.length) return; const n = redoStack[redoStack.length-1]; setRedoStack(r=>r.slice(0,-1)); setHistory(h=>[...h,grid]); setGrid(n) }
  const clearMap = () => { pushHistory(grid); setGrid(emptyGrid(gridW, gridH)); toast.success('Карта очищена') }
  const randomMap = () => { pushHistory(grid); setGrid(generateDefaultMap(gridW, gridH)); toast.success('Карта сгенерирована') }
  const resize = (w: number, h: number) => {
    pushHistory(grid); const ng = emptyGrid(w, h)
    for (let y=0;y<Math.min(h,gridH);y++) for (let x=0;x<Math.min(w,gridW);x++) ng[y*w+x] = grid[y*gridW+x]
    setGridW(w); setGridH(h); setGrid(ng)
  }
  const saveLocal = () => { localStorage.setItem('dune-map', JSON.stringify({name:mapName,w:gridW,h:gridH,grid})); toast.success(`"${mapName}" сохранена`) }
  const loadLocal = () => {
    const raw = localStorage.getItem('dune-map'); if (!raw) { toast.error('Нет сохранения'); return }
    try { const d = JSON.parse(raw); setGridW(d.w); setGridH(d.h); setGrid(d.grid); setMapName(d.name); setHistory([]); setRedoStack([]); toast.success(`Загружено: ${d.name}`) }
    catch { toast.error('Ошибка') }
  }
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({name:mapName,w:gridW,h:gridH,grid},null,2)], {type:'application/json'})
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href=url; a.download=`${mapName.replace(/\s+/g,'_')}.json`; a.click(); URL.revokeObjectURL(url); toast.success('Экспорт JSON')
  }
  const importJson = () => fileInputRef.current?.click()
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = () => { try { const d=JSON.parse(rd.result as string); setGridW(d.w); setGridH(d.h); setGrid(d.grid); setMapName(d.name||'Импорт'); setHistory([]); setRedoStack([]); toast.success('Импорт OK') } catch { toast.error('Неверный файл') } }
    rd.readAsText(f); e.target.value=''
  }

  const startGame = () => {
    // ensure map has some spice (only on sand)
    let hasSpice = grid.some(t => t === 5 || t === 6)
    if (!hasSpice) {
      const g = [...grid]
      for (let i = 0; i < 5; i++) {
        const x = Math.floor(Math.random()*gridW), y = Math.floor(Math.random()*gridH)
        for (let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) {
          const nx=x+dx, ny=y+dy
          if (inBounds(nx,ny,gridW,gridH) && g[idx(nx,ny,gridW)]===1 && Math.random()>0.4) g[idx(nx,ny,gridW)] = Math.random()>0.5?5:6
        }
      }
      setGrid(g)
    }
    setMode('game')
  }

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (mode !== 'editor') return
      const k = e.key.toLowerCase()
      if (k==='b') setTool('brush')
      else if (k==='e') setTool('eraser')
      else if (k==='f') setTool('fill')
      else if (k==='r') setTool('rect')
      else if (k==='g') setShowGrid(s=>!s)
      else if ((e.ctrlKey||e.metaKey)&&k==='z'&&!e.shiftKey){e.preventDefault();undo()}
      else if ((e.ctrlKey||e.metaKey)&&(k==='y'||(k==='z'&&e.shiftKey))){e.preventDefault();redo()}
      else if ((e.ctrlKey||e.metaKey)&&k==='s'){e.preventDefault();saveLocal()}
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, history, redoStack, grid, mapName, gridW, gridH])

  if (mode === 'menu') return <MenuScreen mode={mode} setMode={setMode} difficulty={difficulty} setDifficulty={setDifficulty} onStartGame={startGame} onOpenEditor={() => setMode('editor')} isFullscreen={isFullscreen} toggleFullscreen={toggleFullscreen} />

  if (mode === 'editor') {
    const tools: {id:Tool;icon:any;label:string}[] = [
      {id:'brush',icon:Brush,label:'Кисть'},{id:'eraser',icon:Eraser,label:'Ластик'},
      {id:'fill',icon:PaintBucket,label:'Заливка'},{id:'rect',icon:Square,label:'Прямоуг.'},
    ]
    return (
      <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
        <header className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur px-4 py-2 flex items-center gap-3 flex-wrap sticky top-0 z-20">
          <Button size="sm" variant="ghost" onClick={() => setMode('menu')}><Home className="w-4 h-4 mr-1"/>Меню</Button>
          <Separator orientation="vertical" className="h-6 bg-neutral-700" />
          <h1 className="text-lg font-bold">Редактор карт</h1>
          <Input value={mapName} onChange={e=>setMapName(e.target.value)} className="w-44 h-8 bg-neutral-800 border-neutral-700" />
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={undo} disabled={!history.length}><Undo2 className="w-4 h-4"/></Button>
          <Button size="sm" variant="ghost" onClick={redo} disabled={!redoStack.length}><Redo2 className="w-4 h-4"/></Button>
          <Separator orientation="vertical" className="h-6 mx-1 bg-neutral-700" />
          <Button size="sm" variant="ghost" onClick={saveLocal}><Save className="w-4 h-4 mr-1"/>Сохр.</Button>
          <Button size="sm" variant="ghost" onClick={loadLocal}><FolderOpen className="w-4 h-4 mr-1"/>Загр.</Button>
          <Button size="sm" variant="ghost" onClick={exportJson}><Download className="w-4 h-4 mr-1"/>Эксп.</Button>
          <Button size="sm" variant="ghost" onClick={importJson}><Upload className="w-4 h-4 mr-1"/>Имп.</Button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={onFile} />
          <Separator orientation="vertical" className="h-6 mx-1 bg-neutral-700" />
          <Button size="sm" onClick={startGame} className="bg-amber-600 hover:bg-amber-700"><Play className="w-4 h-4 mr-1"/>Играть</Button>
        </header>
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-16 border-r border-neutral-800 bg-neutral-900/50 flex flex-col items-center py-3 gap-1">
            {tools.map(t => { const I=t.icon; return (
              <Button key={t.id} size="icon" variant={tool===t.id?'default':'ghost'} onClick={()=>setTool(t.id)}
                className={`w-11 h-11 ${tool===t.id?'bg-amber-600 hover:bg-amber-600':''}`} title={t.label}>
                <I className="w-5 h-5" />
              </Button>
            )})}
            <Separator className="my-2 bg-neutral-700 w-8" />
            <Button size="icon" variant={showGrid?'default':'ghost'} onClick={()=>setShowGrid(s=>!s)} className={`w-11 h-11 ${showGrid?'bg-amber-600 hover:bg-amber-600':''}`} title="Сетка"><Grid3x3 className="w-5 h-5"/></Button>
            <Button size="icon" variant="ghost" onClick={randomMap} title="Случайная карта" className="w-11 h-11 text-emerald-400"><Sparkles className="w-5 h-5"/></Button>
            <Button size="icon" variant="ghost" onClick={clearMap} title="Очистить" className="w-11 h-11 text-red-400"><Trash2 className="w-5 h-5"/></Button>
          </aside>
          <main className="flex-1 overflow-auto bg-neutral-950 flex items-start justify-center p-6"
            style={{backgroundImage:'radial-gradient(circle,rgba(255,255,255,0.04) 1px,transparent 1px)',backgroundSize:'24px 24px'}}>
            <div className="shadow-2xl shadow-black/60 ring-1 ring-neutral-800 relative">
              <canvas ref={editorCanvasRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onLeave}
                className="block cursor-crosshair" style={{maxWidth:'100%'}} />
              <div className="pointer-events-none absolute inset-0 crt-overlay" />
            </div>
          </main>
          <aside className="w-64 border-l border-neutral-800 bg-neutral-900/50 flex flex-col">
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">Тайл</h3>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-neutral-800/60">
                    {previews[selectedTile] && <img src={previews[selectedTile]} alt="" className="w-10 h-10 rounded ring-1 ring-neutral-700" />}
                    <div><div className="text-sm font-medium">{TERRAIN[selectedTile]?.name}</div>
                    <div className="text-xs text-neutral-400">{TERRAIN[selectedTile]?.walkable?'проходимо':'непроходимо'}</div></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1"><Label className="text-xs uppercase text-neutral-400">Кисть</Label><span className="text-xs text-amber-500">{brushSize}×{brushSize}</span></div>
                  <Slider value={[brushSize]} min={1} max={5} step={1} onValueChange={v=>setBrushSize(v[0])} />
                </div>
                <Separator className="bg-neutral-800" />
                <div>
                  <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">Палитра</h3>
                  <div className="grid grid-cols-4 gap-1">
                    {EDITOR_TILES.map(t => (
                      <button key={t.id} onClick={()=>setSelectedTile(t.id)} title={TERRAIN[t.id]?.name}
                        className={`aspect-square rounded transition-all ${selectedTile===t.id?'ring-2 ring-amber-400 scale-105':'ring-1 ring-neutral-700 hover:ring-neutral-500'} overflow-hidden`}>
                        {previews[t.id] && <img src={previews[t.id]} alt="" className="w-full h-full" />}
                      </button>
                    ))}
                  </div>
                </div>
                <Separator className="bg-neutral-800" />
                <div>
                  <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">Размер</h3>
                  <div className="space-y-2">
                    <div><div className="flex justify-between text-xs mb-1"><span>Ширина</span><span className="text-amber-500">{gridW}</span></div>
                    <Slider value={[gridW]} min={20} max={64} step={4} onValueChange={v=>resize(v[0],gridH)} /></div>
                    <div><div className="flex justify-between text-xs mb-1"><span>Высота</span><span className="text-amber-500">{gridH}</span></div>
                    <Slider value={[gridH]} min={20} max={64} step={4} onValueChange={v=>resize(gridW,v[0])} /></div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </aside>
        </div>
        <footer className="border-t border-neutral-800 bg-neutral-900 px-4 py-1.5 text-[11px] text-neutral-500 flex gap-3 flex-wrap">
          <kbd className="px-1 rounded bg-neutral-800">B</kbd>кисть <kbd className="px-1 rounded bg-neutral-800">E</kbd>ластик
          <kbd className="px-1 rounded bg-neutral-800">F</kbd>заливка <kbd className="px-1 rounded bg-neutral-800">R</kbd>прямоуг.
          <kbd className="px-1 rounded bg-neutral-800">G</kbd>сетка <kbd className="px-1 rounded bg-neutral-800">Ctrl+Z</kbd>отмена
          <span className="ml-auto">Курсор: {hoverCell?`${hoverCell.x},${hoverCell.y}`:'—'} · История: {history.length}/50</span>
        </footer>
      </div>
    )
  }

  // GAME MODE
  return <GameScreen difficulty={difficulty} terrain={grid} w={gridW} h={gridH} onExit={() => setMode('menu')} isFullscreen={isFullscreen} toggleFullscreen={toggleFullscreen} />
}

// ============================================================
//  MENU SCREEN
// ============================================================
function MenuScreen({ setMode, difficulty, setDifficulty, onStartGame, onOpenEditor, isFullscreen, toggleFullscreen }: {
  mode: string; setMode: (m:'menu'|'editor'|'game')=>void
  difficulty: 'easy'|'medium'|'hard'; setDifficulty: (d:'easy'|'medium'|'hard')=>void
  onStartGame: ()=>void; onOpenEditor: ()=>void
  isFullscreen: boolean; toggleFullscreen: ()=>void
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-neutral-100 relative overflow-hidden"
      style={{background:'radial-gradient(ellipse at center, #2a1a08 0%, #0a0604 70%)'}}>
      {/* decorative dunes */}
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage:'repeating-linear-gradient(180deg, transparent 0px, transparent 40px, rgba(217,164,65,0.1) 40px, rgba(217,164,65,0.1) 42px)',
      }} />
      <div className="relative z-10 text-center px-6 max-w-2xl">
        <div className="mb-2 text-7xl font-black tracking-tighter bg-gradient-to-b from-amber-300 to-orange-700 bg-clip-text text-transparent">DUNE</div>
        <div className="text-amber-500/80 text-sm tracking-[0.4em] uppercase mb-8">Война за спайс</div>

        <div className="bg-neutral-900/70 backdrop-blur border border-neutral-700 rounded-2xl p-8 space-y-6">
          <div>
            <div className="text-xs uppercase text-neutral-400 mb-2">Сложность</div>
            <div className="grid grid-cols-3 gap-2">
              {(['easy','medium','hard'] as const).map(d => (
                <button key={d} onClick={()=>setDifficulty(d)}
                  className={`py-3 rounded-lg font-semibold transition-all ${difficulty===d?'bg-amber-600 text-white':'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}>
                  {d==='easy'?'Лёгкая':d==='medium'?'Средняя':'Тяжёлая'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" onClick={onStartGame} className="bg-gradient-to-b from-amber-500 to-orange-700 hover:from-amber-400 hover:to-orange-600 text-white h-14 text-base">
              <Sword className="w-5 h-5 mr-2" /> Сражение
            </Button>
            <Button size="lg" variant="outline" onClick={onOpenEditor} className="h-14 text-base border-neutral-600 bg-neutral-800/50 hover:bg-neutral-800">
              <Hammer className="w-5 h-5 mr-2" /> Редактор
            </Button>
          </div>

          {/* Fullscreen toggle — kiosk mode */}
          <Button size="sm" variant="ghost" onClick={toggleFullscreen} className="w-full h-10 text-sm touch-manipulation">
            {isFullscreen ? <><Minimize className="w-4 h-4 mr-2"/> Выйти из полного экрана</> : <><Maximize className="w-4 h-4 mr-2"/> Полный экран (киоск)</>}
          </Button>

          <div className="text-xs text-neutral-500 text-left space-y-1 pt-2 border-t border-neutral-800">
            <p>• Вы — Дом Атрейдес (синий). Враг — Харконнен (фиолетовый).</p>
            <p>• Добывайте спайс доставщиками, стройте казармы и фабрики.</p>
            <p>• Уничтожьте дворец врага — победа. Берегите свой.</p>
            <p>• На песке появляется Шай-Хулуд — он пожирает юниты!</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
//  GAME SCREEN
// ============================================================

// Cache of semi-transparent building preview images for the build-mode ghost.
// Keyed by building type. Loaded lazily from getBuildingPreview data URLs.
const buildingPreviewImgCache = new Map<string, HTMLImageElement>()
function getBuildingPreviewImg(type: BuildingType): HTMLImageElement | null {
  if (typeof window === 'undefined') return null
  let img = buildingPreviewImgCache.get(type)
  if (!img) {
    img = new Image()
    img.src = getBuildingPreview(type, 'atreides', 96, FOOTPRINT[type].w, FOOTPRINT[type].h)
    buildingPreviewImgCache.set(type, img)
  }
  return img
}

function GameScreen({ difficulty, terrain, w, h, onExit, isFullscreen, toggleFullscreen }: {
  difficulty: 'easy'|'medium'|'hard'; terrain: number[]; w: number; h: number; onExit: ()=>void
  isFullscreen: boolean; toggleFullscreen: ()=>void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<GameState>(createGame(w, h, [...terrain], difficulty))

  // Center viewport on player's palace at game start
  const centerOnBase = useCallback(() => {
    const wrap = canvasWrapRef.current
    if (!wrap) return
    const s = gameRef.current
    const palace = s.buildings.find(b => b.owner === 'atreides' && b.type === 'palace')
    if (!palace) return
    const z = zoomRef.current
    // palace center in world pixels
    const baseX = (palace.x + palace.w / 2) * TILE_SIZE
    const baseY = (palace.y + palace.h / 2) * TILE_SIZE
    // pan so base center → screen center: pan = screenCenter - baseCenter*zoom
    const panX = wrap.clientWidth / 2 - baseX * z
    const panY = wrap.clientHeight / 2 - baseY * z
    const np = { x: panX, y: panY }
    panRef.current = np
    setPan(np)
  }, [])

  // Center on base when game starts (after canvas mount)
  useEffect(() => {
    const t = setTimeout(centerOnBase, 100)
    return () => clearTimeout(t)
  }, [centerOnBase])
  // offscreen cache for terrain layer (expensive to redraw every frame)
  const terrainCacheRef = useRef<HTMLCanvasElement | null>(null)
  const terrainCacheVerRef = useRef<number>(-1)
  // offscreen cache for fog of war (updated every few ticks)
  const fogCacheRef = useRef<HTMLCanvasElement | null>(null)
  const fogCacheTickRef = useRef<number>(-1)
  const [, forceRender] = useState(0)
  const [paused, setPaused] = useState(false)
  const [selected, setSelected] = useState<{type:'unit'|'building', id:number} | null>(null)
  const [buildMode, setBuildMode] = useState<BuildingType | null>(null)
  const [hoverCell, setHoverCell] = useState<{x:number,y:number}|null>(null)
  // Build preview: once the user single-clicks in build mode, a semi-transparent
  // building outline is "dropped" here. It follows the cursor until a double-click
  // confirms placement. null = no preview dropped yet (just hover ghost).
  const [buildPreview, setBuildPreview] = useState<{x:number,y:number}|null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [zoom, setZoom] = useState(1.0)
  const [pan, setPan] = useState<{x: number; y: number}>({x: 0, y: 0})
  const [panelOpen, setPanelOpen] = useState(false)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef(selected); selectedRef.current = selected
  const buildModeRef = useRef(buildMode); buildModeRef.current = buildMode
  const pausedRef = useRef(paused); pausedRef.current = paused
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const panRef = useRef(pan); panRef.current = pan
  const hoverCellRef = useRef(hoverCell); hoverCellRef.current = hoverCell
  const buildPreviewRef = useRef(buildPreview); buildPreviewRef.current = buildPreview
  // last build tap (cell + time) for double-click detection (mouse + touch)
  const lastBuildTapRef = useRef<{x:number,y:number,time:number}|null>(null)
  const panelOpenRef = useRef(panelOpen); panelOpenRef.current = panelOpen
  // mouse middle-button pan
  const mousePanRef = useRef<{x:number;y:number;panning:boolean} | null>(null)
  // Pointer events (unified mouse + touch)
  // lastTouchTime dedups mouse compat events that fire after touch on mobile
  const pointerStateRef = useRef<{startX:number;startY:number;lastX:number;lastY:number;moved:boolean;isDown:boolean;isTwoFinger:boolean;pinchDist:number;lastTouchTime:number}>({startX:0,startY:0,lastX:0,lastY:0,moved:false,isDown:false,isTwoFinger:false,pinchDist:0,lastTouchTime:0})
  // touch state: track single-finger drag for pan vs tap
  const touchStateRef = useRef<{startX:number, startY:number, lastX:number, lastY:number, moved:boolean, startTime:number}>({startX:0, startY:0, lastX:0, lastY:0, moved:false, startTime:0})

  // ---- zoom with mouse wheel ----
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => {
      const nz = Math.max(0.7, Math.min(2.5, +(z - Math.sign(e.deltaY) * 0.15).toFixed(2)))
      zoomRef.current = nz
      return nz
    })
  }
  // ---- pinch-to-zoom (two fingers) + pan (one finger drag) ----
  const pinchRef = useRef<{ dist: number } | null>(null)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1]
      pinchRef.current = { dist: Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY) }
      touchStateRef.current.moved = true  // disable tap when pinching
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      touchStateRef.current = { startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastY: t.clientY, moved: false, startTime: Date.now() }
    }
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // pinch zoom
      e.preventDefault()
      const t0 = e.touches[0], t1 = e.touches[1]
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY)
      if (pinchRef.current) {
        const ratio = dist / pinchRef.current.dist
        setZoom(z => {
          const nz = Math.max(0.7, Math.min(2.5, +(z * ratio).toFixed(2)))
          zoomRef.current = nz
          return nz
        })
      }
      pinchRef.current = { dist }
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      const ts = touchStateRef.current
      const dx = t.clientX - ts.lastX
      const dy = t.clientY - ts.lastY
      const totalDx = t.clientX - ts.startX
      const totalDy = t.clientY - ts.startY
      // if moved more than 8px, it's a drag (pan), not a tap
      if (Math.hypot(totalDx, totalDy) > 8) {
        ts.moved = true
        e.preventDefault()
        setPan(p => {
          const np = { x: p.x + dx, y: p.y + dy }
          panRef.current = np
          return np
        })
      }
      ts.lastX = t.clientX
      ts.lastY = t.clientY
    }
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    pinchRef.current = null
    const ts = touchStateRef.current
    if (ts.moved) return
    const touch = e.changedTouches[0]
    if (!touch) return
    const fakeEvt = { clientX: touch.clientX, clientY: touch.clientY, button: 0, shiftKey: false, preventDefault: () => {} } as any
    handleTap(fakeEvt)
  }

  // ---- Pointer events (unified mouse + touch) ----
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 1) {
      mousePanRef.current = {x:e.clientX, y:e.clientY, panning:true}
      return
    }
    if (e.button !== 0 && e.pointerType !== 'touch') return
    // Suppress mouse compat events that fire ~300ms after a touch tap
    // (prevents double-firing of handleTap on mobile → panel flicker)
    if (e.pointerType === 'mouse' && pointerStateRef.current.lastTouchTime && Date.now() - pointerStateRef.current.lastTouchTime < 800) {
      return
    }
    const ps = pointerStateRef.current
    ps.startX = e.clientX
    ps.startY = e.clientY
    ps.lastX = e.clientX
    ps.lastY = e.clientY
    ps.moved = false
    ps.isDown = true
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const ps = pointerStateRef.current
    // Always track hover cell (for build preview ghost + dropped preview follow)
    const cell = cellFromEvt(e)
    if (cell && (hoverCellRef.current?.x !== cell.x || hoverCellRef.current?.y !== cell.y)) {
      setHoverCell(cell)
      // If a build preview is dropped, it follows the cursor/finger
      if (buildModeRef.current && buildPreviewRef.current) {
        setBuildPreview({ x: cell.x, y: cell.y })
      }
    }

    if (!ps.isDown) return

    const dx = e.clientX - ps.lastX
    const dy = e.clientY - ps.lastY
    const totalDx = e.clientX - ps.startX
    const totalDy = e.clientY - ps.startY

    // In build mode with a dropped preview, dragging repositions the preview
    // (already updated above via hover follow) — do NOT pan. Just mark as moved
    // so the pointer-up doesn't fire a tap (which would double-place).
    if (buildModeRef.current && buildPreviewRef.current) {
      if (Math.hypot(totalDx, totalDy) > 8) ps.moved = true
      ps.lastX = e.clientX
      ps.lastY = e.clientY
      return
    }

    // If moved > 8px → it's a drag (pan), not a tap
    if (Math.hypot(totalDx, totalDy) > 8) {
      ps.moved = true
      setPan(p => {
        const np = { x: p.x + dx, y: p.y + dy }
        panRef.current = np
        return np
      })
    }
    ps.lastX = e.clientX
    ps.lastY = e.clientY
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    const ps = pointerStateRef.current
    if (!ps.isDown) return
    ps.isDown = false

    // Record touch time so subsequent mouse compat events can be suppressed
    if (e.pointerType === 'touch') {
      ps.lastTouchTime = Date.now()
    }

    if (mousePanRef.current) {
      mousePanRef.current.panning = false
    }

    // If not moved → it's a tap
    if (!ps.moved) {
      const fakeEvt = { clientX: e.clientX, clientY: e.clientY, button: 0, shiftKey: false, preventDefault: () => {} } as any
      handleTap(fakeEvt)
    }
  }

  // Unified tap/click handler — used by both mouse and touch
  // IMPORTANT: each branch must `return` so only ONE path runs per tap.
  // Previous version used sequential `if` blocks which caused the panel to
  // flicker/close because later blocks overrode earlier state updates.
  const handleTap = (e: any) => {
    const s = gameRef.current
    const cell = cellFromEvt(e); if (!cell) return
    const pt = pointFromEvt(e)
    const sel = selectedRef.current
    const bm = buildModeRef.current

    // 1. Build mode — preview + double-click to place
    //    First tap: drop/move the semi-transparent preview at the tapped cell.
    //    The preview then follows the cursor (see handlePointerMove).
    //    Second tap on the SAME cell within 400ms: place the building & exit.
    if (bm) {
      const now = Date.now()
      const last = lastBuildTapRef.current
      const isDoubleTap = !!last && last.x === cell.x && last.y === cell.y && (now - last.time) < 400
      if (isDoubleTap) {
        if (canBuild(s, 'atreides', bm, cell.x, cell.y)) {
          placeBuilding(s, 'atreides', bm, cell.x, cell.y)
        } else {
          toast.error('Здесь нельзя строить')
        }
        setBuildMode(null)
        setBuildPreview(null)
        lastBuildTapRef.current = null
        return
      }
      // Single tap → drop/move preview to this cell
      setBuildPreview({ x: cell.x, y: cell.y })
      lastBuildTapRef.current = { x: cell.x, y: cell.y, time: now }
      return
    }

    // 2. Determine what's at the tap point
    // Priority: friendly building > friendly unit > enemy unit > enemy building
    // (buildings are large & stationary — they must take priority over nearby
    // wandering units, otherwise a harvester near the Palace steals the click
    // and the selection panel flickers closed)
    const tappedBld = pickBuildingAt(s, pt.x, pt.y, 'atreides')
    const tappedUnit = tappedBld ? null : pickUnitAt(s, pt.x, pt.y, 'atreides', 1.5)
    const tappedEnemy = (tappedBld || tappedUnit) ? null : pickUnitAt(s, pt.x, pt.y, undefined, 1.5)
    const tappedEnemyBld = (tappedBld || tappedUnit || tappedEnemy) ? null : pickBuildingAt(s, pt.x, pt.y)

    // 3. A BUILDING is currently selected
    if (sel?.type === 'building') {
      if (tappedBld) {
        // switch to another (or same) building — panel stays open
        setSelected({ type:'building', id:tappedBld.id })
        setPanelOpen(true)
      } else if (tappedUnit) {
        // select a friendly unit instead — close panel (units open panel on 2nd tap)
        setSelected({ type:'unit', id:tappedUnit.id })
        setPanelOpen(false)
      } else {
        // tap on empty / enemy → deselect & close panel
        setSelected(null)
        setPanelOpen(false)
      }
      return
    }

    // 4. A UNIT is currently selected
    if (sel?.type === 'unit') {
      const u = s.units.find(u => u.id === sel.id)
      if (!u) {
        // selected unit no longer exists — clear and fall through to "nothing selected"
        setSelected(null)
        setPanelOpen(false)
      } else {
        if (tappedUnit && tappedUnit.id === u.id) {
          // tap same unit → toggle panel
          setPanelOpen(p => !p)
        } else if (tappedUnit) {
          // tap another friendly unit → switch selection (no panel)
          setSelected({ type:'unit', id:tappedUnit.id })
        } else if (tappedBld) {
          // tap friendly building → switch selection + open panel
          setSelected({ type:'building', id:tappedBld.id })
          setPanelOpen(true)
        } else if (tappedEnemy && tappedEnemy.owner !== 'atreides') {
          commandAttack(s, u, tappedEnemy.id, false)
          setPanelOpen(false)
        } else if (tappedEnemyBld && tappedEnemyBld.owner !== 'atreides') {
          commandAttack(s, u, tappedEnemyBld.id, true)
          setPanelOpen(false)
        } else {
          // tap on empty map → move order (harvesters auto-harvest, ignore)
          if (u.type !== 'harvester') {
            commandMove(s, u, cell.x + 0.5, cell.y + 0.5)
          }
          setPanelOpen(false)
        }
        return
      }
    }

    // 5. Nothing selected (or selection was just cleared above)
    if (tappedBld) {
      // building → select + open panel immediately
      setSelected({ type:'building', id:tappedBld.id })
      setPanelOpen(true)
    } else if (tappedUnit) {
      // unit → select (no panel — opens on 2nd tap)
      setSelected({ type:'unit', id:tappedUnit.id })
    }
    // empty → nothing
  }

  // Deselect function (called by ✕ button in HUD or Esc)
  const deselect = () => {
    setSelected(null)
    setPanelOpen(false)
    setBuildMode(null)
    setBuildPreview(null)
    lastBuildTapRef.current = null
  }
  // reset zoom/pan on Esc
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setBuildMode(null); setBuildPreview(null); lastBuildTapRef.current = null; setSelected(null); setPanelOpen(false); setZoom(1.0); centerOnBase() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  // ---- game loop (logic) ----
  // Tick at 10fps; throttle React re-renders to ~4fps (UI panel doesn't need 10fps)
  useEffect(() => {
    let tickCount = 0
    const iv = setInterval(() => {
      if (pausedRef.current) return
      if (gameRef.current.over) return
      tick(gameRef.current)
      tickCount++
      // only re-render React panel every 3 ticks (~300ms) — canvas updates via rAF independently
      if (tickCount % 3 === 0) forceRender(n => n + 1)
    }, 100)
    return () => clearInterval(iv)
  }, [])

  // ---- render loop ----
  useEffect(() => {
    let raf = 0
    const render = () => {
      const s = gameRef.current
      const c = canvasRef.current
      const wrap = canvasWrapRef.current
      const tNow = Date.now() / 400
      const z = zoomRef.current
      const p = panRef.current
      if (c && wrap) {
        const ctx = c.getContext('2d')!
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        // Canvas fills wrapper exactly (viewport = screen)
        const wrapW = wrap.clientWidth
        const wrapH = wrap.clientHeight
        const internalW = Math.round(wrapW * dpr)
        const internalH = Math.round(wrapH * dpr)
        if (c.width !== internalW || c.height !== internalH) { c.width = internalW; c.height = internalH }
        c.style.width = `${wrapW}px`
        c.style.height = `${wrapH}px`
        c.style.position = 'absolute'
        c.style.left = '0px'
        c.style.top = '0px'
        // CLEAR canvas each frame (prevents artifacts/trailing when panning)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, internalW, internalH)
        ctx.fillStyle = '#0a0604'
        ctx.fillRect(0, 0, internalW, internalH)
        // Transform: apply zoom + pan so map is drawn at TILE_SIZE * zoom,
        // centered according to pan offset (in CSS pixels, scaled by dpr)
        const scale = z * dpr
        ctx.setTransform(scale, 0, 0, scale, p.x * dpr, p.y * dpr)
        ctx.imageSmoothingEnabled = true

        // --- TERRAIN CACHE: redraw only when terrainVersion changes ---
        if (terrainCacheVerRef.current !== s.terrainVersion || !terrainCacheRef.current) {
          const tw = s.width * TILE_SIZE, th = s.height * TILE_SIZE
          if (!terrainCacheRef.current) {
            terrainCacheRef.current = document.createElement('canvas')
          }
          terrainCacheRef.current.width = tw
          terrainCacheRef.current.height = th
          const tctx = terrainCacheRef.current.getContext('2d')!
          tctx.imageSmoothingEnabled = true
          drawTerrainLayer(tctx, s.terrain, s.width, s.height, tNow, s.terrainVersion)
          terrainCacheVerRef.current = s.terrainVersion
        }
        // blit cached terrain
        ctx.drawImage(terrainCacheRef.current, 0, 0)

        // build preview — two modes:
        //  (a) hover ghost: buildMode active but no preview dropped yet → faint ghost at hoverCell
        //  (b) dropped preview: semi-transparent building image + dashed outline + gap ring
        //      at buildPreview position (follows cursor, see handlePointerMove)
        if (buildModeRef.current) {
          const bm = buildModeRef.current
          const fp = FOOTPRINT[bm]
          // dropped preview takes priority; fall back to hover ghost
          const pv = buildPreviewRef.current || hoverCellRef.current
          if (pv) {
            const px = pv.x, py = pv.y
            const ok = canBuild(s, 'atreides', bm, px, py)
            const x0 = px * TILE_SIZE, y0 = py * TILE_SIZE
            const w0 = fp.w * TILE_SIZE, h0 = fp.h * TILE_SIZE
            // 1. 1-tile gap ring (faint) — shows the required spacing around the building
            ctx.save()
            ctx.fillStyle = ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'
            ctx.fillRect(x0 - TILE_SIZE, y0 - TILE_SIZE, w0 + 2 * TILE_SIZE, h0 + 2 * TILE_SIZE)
            ctx.restore()
            // 2. semi-transparent fill of the footprint
            ctx.save()
            ctx.fillStyle = ok ? 'rgba(34,197,94,0.28)' : 'rgba(239,68,68,0.28)'
            ctx.fillRect(x0, y0, w0, h0)
            // 3. semi-transparent building image (ghost) if loaded
            const img = getBuildingPreviewImg(bm)
            if (img && img.complete && img.naturalWidth > 0) {
              ctx.globalAlpha = 0.55
              ctx.drawImage(img, x0, y0, w0, h0)
              ctx.globalAlpha = 1
            }
            ctx.restore()
            // 4. dashed outline (full alpha) — the "обводка здания"
            ctx.save()
            ctx.strokeStyle = ok ? '#22c55e' : '#ef4444'
            ctx.lineWidth = 2
            ctx.setLineDash([6, 4])
            ctx.lineDashOffset = -tNow * 8  // marching ants
            ctx.strokeRect(x0 + 1, y0 + 1, w0 - 2, h0 - 2)
            ctx.restore()
            // 5. gap-ring dashed border (very faint) — visual hint for the spacing rule
            ctx.save()
            ctx.strokeStyle = ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'
            ctx.lineWidth = 1
            ctx.setLineDash([3, 3])
            ctx.strokeRect(x0 - TILE_SIZE + 1, y0 - TILE_SIZE + 1, w0 + 2 * TILE_SIZE - 2, h0 + 2 * TILE_SIZE - 2)
            ctx.restore()
            // 6. hint text (only for dropped preview)
            if (buildPreviewRef.current) {
              ctx.save()
              ctx.fillStyle = ok ? '#86efac' : '#fca5a5'
              ctx.font = 'bold 11px system-ui, sans-serif'
              ctx.textAlign = 'center'
              ctx.fillText(ok ? 'двойной клик — построить' : 'нельзя строить здесь', x0 + w0 / 2, y0 - 6)
              ctx.restore()
            }
          }
        }
        // buildings — viewport culling (skip off-screen for ~3× fewer draw calls)
        const vMargin = 2  // tiles of margin for smooth panning
        const vMinTx = -p.x / (z * TILE_SIZE) - vMargin
        const vMaxTx = (wrapW - p.x) / (z * TILE_SIZE) + vMargin
        const vMinTy = -p.y / (z * TILE_SIZE) - vMargin
        const vMaxTy = (wrapH - p.y) / (z * TILE_SIZE) + vMargin
        const inView = (tx: number, ty: number, tw = 1, th = 1) =>
          tx + tw >= vMinTx && tx <= vMaxTx && ty + th >= vMinTy && ty <= vMaxTy

        for (const b of s.buildings) {
          if (!inView(b.x, b.y, b.w, b.h)) continue
          drawBuilding(ctx, b.type, b.owner, b.x*TILE_SIZE, b.y*TILE_SIZE, b.w, b.h, b.hp, b.maxHp, hasPower(s, b.owner), tNow, b.level || 1)
          if (b.hp < b.maxHp) drawHealthBar(ctx, b.x*TILE_SIZE+b.w*TILE_SIZE/2, b.y*TILE_SIZE-2, b.w*TILE_SIZE-4, b.hp/b.maxHp)
          // production indicator
          if (b.queue.length > 0) {
            const q = b.queue[0]
            ctx.fillStyle = '#000'; ctx.fillRect(b.x*TILE_SIZE+2, b.y*TILE_SIZE+b.h*TILE_SIZE-6, b.w*TILE_SIZE-4, 4)
            ctx.fillStyle = '#22c55e'; ctx.fillRect(b.x*TILE_SIZE+2, b.y*TILE_SIZE+b.h*TILE_SIZE-6, (b.w*TILE_SIZE-4)*(q.progress/CONFIG[q.type].buildTime), 4)
          }
          // refinery spice stock indicator (top bar — orange)
          if (b.type === 'refinery') {
            const ref = b as any
            const stock = ref.spiceStock ?? 0
            const max = ref.maxSpiceStock ?? 210
            if (max > 0) {
              const pct = Math.min(1, stock / max)
              const barW = b.w * TILE_SIZE - 4
              const barX = b.x * TILE_SIZE + 2
              const barY = b.y * TILE_SIZE + 2
              ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(barX, barY, barW, 4)
              // color shifts amber→red as it fills
              const r = 249, g = Math.round(115 + (1 - pct) * 40), bl = Math.round(22 + (1 - pct) * 20)
              ctx.fillStyle = pct >= 1 ? '#ef4444' : `rgb(${r},${g},${bl})`
              ctx.fillRect(barX, barY, barW * pct, 4)
              // subtle white outline
              ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1
              ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, 3)
            }
          }
        }
        // move markers for selected
        const sel = selectedRef.current
        if (sel?.type === 'unit') {
          const u = s.units.find(u=>u.id===sel.id)
          if (u && (u.state === 'move' || u.state === 'attack')) {
            drawMoveMarker(ctx, u.tx, u.ty, u.owner==='atreides'?'#22c55e':'#ef4444')
          }
        }
        // units (with bob animation for moving units) — viewport culling
        for (const u of s.units) {
          if (!inView(u.x, u.y)) continue
          const moving = u.state === 'move' || u.state === 'attack' || u.state === 'harvest' || u.state === 'return'
          const bob = moving ? Math.sin(tNow * 6 + u.id) * 1 : 0
          drawUnit(ctx, u.type, u.owner, u.x*TILE_SIZE, u.y*TILE_SIZE, bob, u.facing, tNow, u.state)
          if (u.hp < u.maxHp) drawHealthBar(ctx, u.x*TILE_SIZE, u.y*TILE_SIZE-TILE_SIZE/2+2, TILE_SIZE-6, u.hp/u.maxHp)
          // cargo indicator for harvesters
          if (u.type === 'harvester' && u.cargo > 0) {
            ctx.fillStyle = '#e85d2f'; ctx.fillRect(u.x*TILE_SIZE-8, u.y*TILE_SIZE-TILE_SIZE/2+6, 16*(u.cargo/u.maxCargo), 3)
            ctx.fillStyle = 'rgba(255,150,80,0.6)'; ctx.fillRect(u.x*TILE_SIZE-8, u.y*TILE_SIZE-TILE_SIZE/2+6, 16*(u.cargo/u.maxCargo), 1)
          }
        }
        // worms (with subtle wiggle + HP bar if damaged)
        for (const w of s.worms) {
          if (!inView(w.x, w.y)) continue
          const angle = Math.atan2(w.y - w.ty, w.x - w.tx) + Math.sin(tNow * 3 + w.id) * 0.15
          drawWorm(ctx, w.x*TILE_SIZE, w.y*TILE_SIZE, angle)
          if (w.hp < w.maxHp) drawHealthBar(ctx, w.x*TILE_SIZE, w.y*TILE_SIZE-TILE_SIZE/2-2, TILE_SIZE-4, w.hp/w.maxHp)
        }
        // projectiles
        for (const p of s.projectiles) {
          if (!inView(p.x, p.y)) continue
          drawProjectile(ctx, p.x*TILE_SIZE, p.y*TILE_SIZE, p.sx*TILE_SIZE, p.sy*TILE_SIZE, p.color, !!p.beam)
        }
        // muzzle flashes
        for (const f of s.flashes) {
          if (!inView(f.x, f.y)) continue
          drawMuzzleFlash(ctx, f.x*TILE_SIZE, f.y*TILE_SIZE, f.frame)
        }
        // explosions
        for (const e of s.explosions) {
          if (!inView(e.x, e.y)) continue
          drawExplosion(ctx, e.x*TILE_SIZE, e.y*TILE_SIZE, e.frame, e.maxFrame, e.size, e.color)
        }
        // fog of war — cached, update every 5 ticks (not every frame)
        if (fogCacheTickRef.current < Math.floor(s.tick / 5) || !fogCacheRef.current) {
          if (!fogCacheRef.current) fogCacheRef.current = document.createElement('canvas')
          fogCacheRef.current.width = s.width * TILE_SIZE
          fogCacheRef.current.height = s.height * TILE_SIZE
          const fctx = fogCacheRef.current.getContext('2d')!
          fctx.clearRect(0, 0, fogCacheRef.current.width, fogCacheRef.current.height)
          drawFogOfWar(fctx, s.explored, s.visible, s.width, s.height)
          fogCacheTickRef.current = Math.floor(s.tick / 5)
        }
        ctx.drawImage(fogCacheRef.current, 0, 0)
        // selection highlight + range indicator (drawn on top of fog)
        if (sel?.type === 'unit') {
          const u = s.units.find(u=>u.id===sel.id)
          if (u) {
            drawSelectionRing(ctx, u.x*TILE_SIZE, u.y*TILE_SIZE, '#4ade80')
            const cfg = CONFIG[u.type] as any
            if (cfg.range > 0) drawRangeIndicator(ctx, u.x*TILE_SIZE, u.y*TILE_SIZE, cfg.range)
          }
        } else if (sel?.type === 'building') {
          const b = s.buildings.find(b=>b.id===sel.id)
          if (b) {
            ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2
            ctx.strokeRect(b.x*TILE_SIZE, b.y*TILE_SIZE, b.w*TILE_SIZE, b.h*TILE_SIZE)
            if (b.type === 'turret') {
              const tRange = CONFIG.turret.range * getUpgrade(s, 'atreides', 'turretRange')
              drawRangeIndicator(ctx, b.x*TILE_SIZE+b.w*TILE_SIZE/2, b.y*TILE_SIZE+b.h*TILE_SIZE/2, tRange)
            }
          }
        }
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---- input ----
  // Convert screen coords → world tile coords (accounting for pan + zoom)
  const screenToWorld = (clientX: number, clientY: number) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    const z = zoomRef.current
    const p = panRef.current
    // screen pixel relative to canvas top-left
    const sx = clientX - r.left
    const sy = clientY - r.top
    // subtract pan, divide by zoom → world pixel; then /TILE_SIZE → tile
    const wx = (sx - p.x) / z / TILE_SIZE
    const wy = (sy - p.y) / z / TILE_SIZE
    return { x: wx, y: wy }
  }
  const cellFromEvt = (e: any) => {
    const w = screenToWorld(e.clientX, e.clientY)
    const x = Math.floor(w.x), y = Math.floor(w.y)
    if (x<0||y<0||x>=gameRef.current.width||y>=gameRef.current.height) return null
    return { x, y }
  }
  const pointFromEvt = (e: any) => screenToWorld(e.clientX, e.clientY)

  const handleClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    handleTap(e)
  }

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const s = gameRef.current
    // Right-click cancels build mode (standard RTS convention)
    if (buildModeRef.current) {
      setBuildMode(null)
      setBuildPreview(null)
      lastBuildTapRef.current = null
      return
    }
    const cell = cellFromEvt(e); if (!cell) return
    const pt = pointFromEvt(e)
    const sel = selectedRef.current
    if (!sel) {
      
      return
    }
    if (sel.type !== 'unit') {
      
      return
    }
    const u = s.units.find(u=>u.id===sel.id)
    if (!u) { return }
    if (u.type === 'harvester') {
      
      return
    }

    // check if clicking on enemy (any enemy unit/building near cursor)
    const enemyUnit = pickUnitAt(s, pt.x, pt.y, undefined, 1.5)
    const enemyBld = pickBuildingAt(s, pt.x, pt.y)
    if (enemyUnit && enemyUnit.owner !== 'atreides') {
      commandAttack(s, u, enemyUnit.id, false)
    } else if (enemyBld && enemyBld.owner !== 'atreides') {
      commandAttack(s, u, enemyBld.id, true)
    } else {
      commandMove(s, u, cell.x+0.5, cell.y+0.5)
    }
  }

  const handleBuild = (type: BuildingType) => {
    const s = gameRef.current
    if (s.players.atreides.credits < BUILD_COSTS[type]) { return }
    setBuildMode(type)
    setBuildPreview(null)
    lastBuildTapRef.current = null
    setSelected(null)
    setPanelOpen(false)
  }

  const handleProduce = (type: UnitType) => {
    const s = gameRef.current
    const sel = selectedRef.current
    if (!sel || sel.type !== 'building') return
    const b = s.buildings.find(b=>b.id===sel.id); if (!b) return
    const prodMap: Record<BuildingType, UnitType[]> = {
      palace:['harvester'], barracks:['soldier'], factory:['tank'], turret:[], refinery:[], generator:[]
    }
    if (!prodMap[b.type].includes(type)) return
    if (!hasPower(s, 'atreides')) { return }
    if (queueUnit(s, b, type)) { /* ok — event logged in engine */ }
    
  }

  const s = gameRef.current
  const selUnit = selected?.type==='unit' ? s.units.find(u=>u.id===selected.id) : null
  const selBld = selected?.type==='building' ? s.buildings.find(b=>b.id===selected.id) : null
  const myUnits = s.units.filter(u=>u.owner==='atreides')
  const myBldgs = s.buildings.filter(b=>b.owner==='atreides')
  const armyCount = myUnits.filter(u=>u.type!=='harvester').length
  const harvesterCount = myUnits.filter(u=>u.type==='harvester').length

  return (
    <div className="fixed inset-0 flex flex-col bg-neutral-950 text-neutral-100 select-none" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Top HUD — compact, wraps on mobile */}
      <header className="border-b border-neutral-800 bg-neutral-900/95 backdrop-blur px-2 py-1.5 flex items-center gap-1.5 sm:gap-3 flex-wrap shrink-0 z-20">
        <Button size="sm" variant="ghost" onClick={onExit} className="h-9 px-2.5 touch-manipulation">
          <Home className="w-4 h-4"/>
        </Button>
        <div className="flex items-center gap-1 text-amber-400 font-bold text-sm">
          <Coins className="w-4 h-4" /> <span className="font-mono">{Math.floor(s.players.atreides.credits)}</span>
        </div>
        <div className={`flex items-center gap-1 font-bold text-xs ${hasPower(s, 'atreides') ? 'text-cyan-400' : 'text-red-400'}`}>
          <Zap className="w-3.5 h-3.5" />
          <span className="font-mono">{s.players.atreides.energyMax - s.players.atreides.energyDemand}/{s.players.atreides.energyMax}</span>
        </div>
        <div className="hidden xs:flex items-center gap-2 text-[11px] text-neutral-400">
          <span>⚔{armyCount}</span>
          <span>🚚{harvesterCount}</span>
          <span>🏗{myBldgs.length}</span>
        </div>
        <div className="flex-1" />
        {selected && (
          <Button size="sm" variant="ghost" onClick={deselect} className="h-9 px-2.5 touch-manipulation text-red-400" title="Снять выделение">
            ✕
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={centerOnBase} className="h-9 px-2.5 touch-manipulation" title="Центрировать на базе">
          <Home className="w-4 h-4"/>
        </Button>
        <Button size="sm" variant="ghost" onClick={toggleFullscreen} className="h-9 px-2.5 touch-manipulation" title="Полный экран">
          {isFullscreen ? <Minimize className="w-4 h-4"/> : <Maximize className="w-4 h-4"/>}
        </Button>
        <Button size="sm" variant="ghost" onClick={()=>setPaused(p=>!p)} className="h-9 px-2.5 touch-manipulation">
          {paused ? <Play className="w-4 h-4"/> : <Pause className="w-4 h-4"/>}
        </Button>
        <Button size="sm" variant="ghost" onClick={()=>setPanelOpen(p=>!p)} className="h-9 px-2.5 touch-manipulation lg:hidden">
          ☰
        </Button>
      </header>

      {/* Help bar — collapsible */}
      {showHelp && (
        <div className="bg-neutral-900 border-b border-neutral-800 px-3 py-1.5 text-[10px] text-neutral-400 flex gap-2 flex-wrap shrink-0">
          <span><b className="text-emerald-400">Тап</b> выбрать</span>
          <span><b className="text-amber-400">Тап по карте</b> приказ</span>
          <span><b className="text-amber-400"> Стройка: клик</b> превью · <b className="text-emerald-400">2 клика</b> поставить</span>
          <span><b className="text-neutral-200">Щипок</b> зум</span>
          <span className="hidden sm:inline"><b className="text-neutral-200"> ПКМ</b> отмена стройки</span>
          <span className="hidden sm:inline"><b className="text-neutral-200"> Колесо</b> зум</span>
          <span><b className="text-neutral-200"> Esc</b> сброс</span>
        </div>
      )}

      {/* Main game area — canvas fills available space */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <main className="flex-1 overflow-hidden bg-black relative" ref={canvasWrapRef} style={{ touchAction: 'none' }}>
          <canvas ref={canvasRef}
            onPointerDown={handlePointerDown}
            onContextMenu={handleRightClick}
            onWheel={onWheel}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => { setHoverCell(null); if (mousePanRef.current) mousePanRef.current.panning = false }}
            className="block" style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'default', touchAction: 'none' }} />
          {/* CRT retro overlay */}
          <div className="pointer-events-none absolute inset-0 crt-overlay" />
          {/* Build mode hint banner */}
          {buildMode && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-amber-600/90 text-white text-[11px] font-medium shadow-lg flex items-center gap-2 pointer-events-none">
              <Hammer className="w-3.5 h-3.5"/>
              <span>Стройка: {typeRu(buildMode)}</span>
              <span className="text-amber-200">·</span>
              <span className="text-amber-100">{buildPreview ? 'двойной клик — построить' : 'клик — разместить превью'}</span>
              <span className="text-amber-200">·</span>
              <span className="text-amber-200">ПКМ/Esc — отмена</span>
            </div>
          )}
          {/* Win/Lose overlay */}
          {s.over && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/85 backdrop-blur z-30">
              <div className="text-center px-4">
                {s.winner === 'atreides' ? (
                  <><Trophy className="w-16 h-16 text-amber-400 mx-auto mb-3" />
                  <div className="text-4xl font-black text-amber-400 mb-2">ПОБЕДА</div>
                  <div className="text-neutral-400 mb-5 text-sm">Дворец Харконнен разрушен!</div></>
                ) : (
                  <><Skull className="w-16 h-16 text-red-500 mx-auto mb-3" />
                  <div className="text-4xl font-black text-red-500 mb-2">ПОРАЖЕНИЕ</div>
                  <div className="text-neutral-400 mb-5 text-sm">Ваш дворец пал!</div></>
                )}
                <Button onClick={onExit} size="lg" className="bg-amber-600 hover:bg-amber-700 h-12 px-8 text-base">В меню</Button>
              </div>
            </div>
          )}
        </main>

        {/* Side panel — drawer on mobile, fixed on desktop */}
        <aside className={`
          ${panelOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
          fixed lg:static inset-y-0 right-0 top-[49px] lg:top-0
          w-[85vw] max-w-[320px] lg:w-72
          border-l border-neutral-800 bg-neutral-900/95 backdrop-blur
          flex flex-col z-30 transition-transform duration-200
          lg:translate-x-0
        `}>
          {/* Panel header with close button (mobile) */}
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-neutral-800 lg:hidden">
            <span className="text-[11px] text-neutral-500 uppercase">Панель</span>
            <button onClick={deselect} className="touch-manipulation text-neutral-400 hover:text-white text-lg leading-none px-2">✕</button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2.5 space-y-3">
              {/* Selection info */}
              <div>
                <h3 className="text-[11px] font-semibold uppercase text-neutral-400 mb-1.5">Выбрано</h3>
                {selUnit ? (
                  <div className="p-2.5 rounded-lg bg-neutral-800/60 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-11 h-11 ring-1 ring-neutral-600 rounded overflow-hidden shrink-0">
                        <img src={getUnitPreview(selUnit.type, 'atreides', 48)} alt="" className="w-full h-full"/>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium capitalize">{typeRu(selUnit.type)}</div>
                        <div className="text-xs text-neutral-400">HP {Math.ceil(selUnit.hp)}/{selUnit.maxHp}</div>
                      </div>
                    </div>
                    {selUnit.type === 'harvester' && <div className="text-xs text-orange-400">Спайс: {selUnit.cargo}/{selUnit.maxCargo}</div>}
                    <div className="text-xs text-neutral-400">Состояние: {stateRu(selUnit.state)}</div>
                    <div className="text-[10px] text-neutral-500 pt-1">Тап по карте — приказ</div>
                    {/* Delete unit button */}
                    <Button size="sm" variant="destructive" className="w-full h-9 touch-manipulation"
                      onClick={() => {
                        const s = gameRef.current
                        s.units = s.units.filter(u => u.id !== selUnit.id)
                        setSelected(null)
                      }}>
                      <Trash2 className="w-3.5 h-3.5 mr-1.5"/> Уничтожить
                    </Button>
                  </div>
                ) : selBld ? (
                  <div className="p-2.5 rounded-lg bg-neutral-800/60 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-11 h-11 ring-1 ring-neutral-600 rounded overflow-hidden shrink-0">
                        <img src={getBuildingPreview(selBld.type, 'atreides', 48, selBld.w, selBld.h, selBld.level || 1)} alt="" className="w-full h-full"/>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{typeRu(selBld.type)}</div>
                        <div className="text-xs text-neutral-400">HP {Math.ceil(selBld.hp)}/{selBld.maxHp}</div>
                      </div>
                    </div>
                    {selBld.hp < selBld.maxHp && <div className="text-xs text-amber-500">Строится... {Math.floor(selBld.hp/selBld.maxHp*100)}%</div>}
                    {/* Production buttons — large touch targets */}
                    {selBld.type === 'palace' && (
                      <Button size="sm" className="w-full h-10 bg-amber-600 hover:bg-amber-700 touch-manipulation" onClick={()=>handleProduce('harvester')}>
                        <Hammer className="w-4 h-4 mr-1.5"/> Доставщик ({CONFIG.harvester.cost})
                      </Button>
                    )}
                    {selBld.type === 'barracks' && (
                      <Button size="sm" className="w-full h-10 bg-amber-600 hover:bg-amber-700 touch-manipulation" onClick={()=>handleProduce('soldier')}>
                        <Sword className="w-4 h-4 mr-1.5"/> Солдат ({CONFIG.soldier.cost})
                      </Button>
                    )}
                    {selBld.type === 'factory' && (
                      <Button size="sm" className="w-full h-10 bg-amber-600 hover:bg-amber-700 touch-manipulation" onClick={()=>handleProduce('tank')}>
                        <Sword className="w-4 h-4 mr-1.5"/> Танк ({CONFIG.tank.cost})
                      </Button>
                    )}
                    {selBld.queue.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-neutral-500 uppercase">Очередь (тап — отмена):</div>
                        {selBld.queue.map((q, i) => (
                          <button key={i} onClick={() => { cancelQueueItem(s, selBld, i) }}
                            className="w-full flex items-center gap-1.5 p-1.5 rounded bg-neutral-700/60 hover:bg-red-900/60 text-left transition-colors group touch-manipulation">
                            <img src={getUnitPreview(q.type, 'atreides', 20)} alt="" className="w-5 h-5"/>
                            <div className="flex-1">
                              <div className="text-[11px] text-neutral-200">{unitName(q.type)}</div>
                              <div className="h-1 bg-neutral-900 rounded overflow-hidden">
                                {i === 0 && <div className="h-full bg-amber-500" style={{width: `${(q.progress/CONFIG[q.type].buildTime)*100}%`}}/>}
                              </div>
                            </div>
                            <span className="text-[10px] text-neutral-500 group-hover:text-red-400">✕</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {/* TechLab: research technologies */}
                    {/* ===== Level-based upgrade UI (works for ALL building types) ===== */}
                    {selBld.hp >= selBld.maxHp && (() => {
                      // Find upgrades applicable to this building type
                      const applicable = UPGRADE_DEFS.filter(d => d.building === selBld.type)
                      if (applicable.length === 0) return null
                      // Is a research in progress?
                      const researching = selBld.research
                      const researchDef = researching?.type.startsWith('upg_')
                        ? UPGRADE_DEFS.find(d => d.key === researching!.type.substring(4))
                        : null
                      return (
                        <div className="space-y-1">
                          <div className="text-[10px] text-cyan-400 uppercase">Улучшения (уровни 1-10):</div>
                          {researching && researchDef ? (
                            <div className="p-1.5 rounded bg-cyan-900/30">
                              <div className="text-[11px] text-cyan-300">
                                {researchDef.name} → ур.{getUpgradeLevel(s, 'atreides', researchDef.key) + 1}
                              </div>
                              <div className="h-1.5 bg-neutral-900 rounded overflow-hidden mt-1">
                                <div className="h-full bg-cyan-500" style={{width: `${(researching.progress/researching.totalTime)*100}%`}}/>
                              </div>
                            </div>
                          ) : researching ? (
                            // Tech research in progress (techlab)
                            <div className="p-1.5 rounded bg-purple-900/30">
                              <div className="text-[11px] text-purple-300">
                                {TECHNOLOGIES.find(t => 'tech_' + t.id === researching.type)?.name || 'Исследование...'}
                              </div>
                              <div className="h-1.5 bg-neutral-900 rounded overflow-hidden mt-1">
                                <div className="h-full bg-purple-500" style={{width: `${(researching.progress/researching.totalTime)*100}%`}}/>
                              </div>
                            </div>
                          ) : (
                            applicable.map(def => {
                              const currentLevel = getUpgradeLevel(s, 'atreides', def.key)
                              const targetLevel = currentLevel + 1
                              const maxed = currentLevel >= def.maxLevel
                              const unlocked = isUpgradeLevelUnlocked(s, 'atreides', def.key, targetLevel)
                              const cost = upgradeCost(def.key, targetLevel)
                              const canAfford = s.players.atreides.credits >= cost
                              const mult = getUpgrade(s, 'atreides', def.key)
                              return (
                                <div key={def.key} className={`p-1.5 rounded text-[11px] ${maxed ? 'bg-green-900/20' : unlocked ? (canAfford ? 'bg-neutral-700/60' : 'bg-neutral-800/60') : 'bg-neutral-900/60 opacity-60'}`}>
                                  <div className="flex justify-between items-center">
                                    <span className="text-neutral-200">{def.name}</span>
                                    <span className="font-mono text-[10px]">
                                      {maxed ? <span className="text-green-400">MAX</span> : !unlocked ? <span className="text-neutral-600">🔒</span> : <span className="text-cyan-400">{cost}$</span>}
                                    </span>
                                  </div>
                                  {/* Level bar 1-10 */}
                                  <div className="flex gap-0.5 mt-1">
                                    {Array.from({length: 10}, (_, i) => (
                                      <div key={i} className={`h-1 flex-1 rounded-sm ${i < currentLevel ? 'bg-cyan-400' : i === currentLevel && !maxed && unlocked ? 'bg-cyan-700' : 'bg-neutral-700'}`}/>
                                    ))}
                                  </div>
                                  <div className="flex justify-between mt-0.5">
                                    <span className="text-[9px] text-neutral-500">ур.{currentLevel} · ×{mult.toFixed(2)}</span>
                                    {!maxed && !unlocked && <span className="text-[9px] text-neutral-600">нужна технология</span>}
                                  </div>
                                  {!maxed && unlocked && (
                                    <button
                                      onClick={() => { startBuildingUpgrade(s, selBld, def.key) }}
                                      disabled={!canAfford}
                                      className={`w-full mt-1 h-7 rounded text-[10px] font-medium touch-manipulation ${canAfford ? 'bg-cyan-700 hover:bg-cyan-600 text-white' : 'bg-neutral-800 text-neutral-600'}`}>
                                      → ур.{targetLevel} ({cost}$)
                                    </button>
                                  )}
                                </div>
                              )
                            })
                          )}
                        </div>
                      )
                    })()}
                    {/* ===== TechLab: research technologies (tier 1 + tier 2) ===== */}
                    {selBld.type === 'techlab' && selBld.hp >= selBld.maxHp && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-purple-400 uppercase">Технологии:</div>
                        {!selBld.research ? (
                          <>
                            <div className="text-[9px] text-neutral-500 mb-0.5">Уровень 1 (открывает улучшения 4-6):</div>
                            {TECHNOLOGIES.filter(t => t.tier === 1).map(tech => {
                              const researched = isTechResearched(s, 'atreides', tech.id)
                              const can = s.players.atreides.credits >= tech.cost && !researched
                              return (
                                <button key={tech.id} onClick={() => { startTechResearch(s, selBld, tech.id) }}
                                  disabled={!can}
                                  className={`w-full text-left p-1.5 rounded text-[11px] transition-colors touch-manipulation ${researched ? 'bg-green-900/30 opacity-60' : can ? 'bg-neutral-700/60 hover:bg-purple-900/40' : 'bg-neutral-900 opacity-40'}`}>
                                  <div className="flex justify-between">
                                    <span className={researched ? 'text-green-400' : 'text-neutral-200'}>{researched ? '✓ ' : ''}{tech.name}</span>
                                    {!researched && <span className="text-purple-400 font-mono">{tech.cost}$</span>}
                                  </div>
                                  <div className="text-[9px] text-neutral-500">{tech.desc}</div>
                                </button>
                              )
                            })}
                            <div className="text-[9px] text-neutral-500 mb-0.5 mt-1">Уровень 2 (открывает улучшения 7-10, требует все технологии ур.1):</div>
                            {TECHNOLOGIES.filter(t => t.tier === 2).map(tech => {
                              const researched = isTechResearched(s, 'atreides', tech.id)
                              const tier1Researched = TECHNOLOGIES.filter(t => t.tier === 1).every(t => isTechResearched(s, 'atreides', t.id))
                              const can = s.players.atreides.credits >= tech.cost && !researched && tier1Researched
                              return (
                                <button key={tech.id} onClick={() => { startTechResearch(s, selBld, tech.id) }}
                                  disabled={!can}
                                  className={`w-full text-left p-1.5 rounded text-[11px] transition-colors touch-manipulation ${researched ? 'bg-green-900/30 opacity-60' : can ? 'bg-neutral-700/60 hover:bg-purple-900/40' : 'bg-neutral-900 opacity-40'}`}>
                                  <div className="flex justify-between">
                                    <span className={researched ? 'text-green-400' : 'text-neutral-200'}>{researched ? '✓ ' : ''}{tech.name}</span>
                                    {!researched && <span className="text-purple-400 font-mono">{tech.cost}$</span>}
                                  </div>
                                  <div className="text-[9px] text-neutral-500">{tier1Researched ? tech.desc : '🔒 Сначала исследуйте все технологии ур.1'}</div>
                                </button>
                              )
                            })}
                          </>
                        ) : null}
                      </div>
                    )}
                    {/* ===== Building-specific info panels ===== */}
                    {selBld.type === 'generator' && (
                      <div className="text-xs text-cyan-400 flex items-center gap-1">
                        <Zap className="w-3 h-3"/> Производит: +{Math.round(CONFIG.generator.energyOutput * selBld.level * getUpgrade(s, 'atreides', 'genOutput'))} энергии
                      </div>
                    )}
                    {selBld.type === 'radar' && (
                      <div className="text-xs text-green-400 space-y-0.5">
                        <div className="flex items-center gap-1"><Eye className="w-3 h-3"/> Радар: открывает туман войны</div>
                        <div className="text-[10px] text-neutral-500">Радиус: {CONFIG.radar.visionRange} тайлов</div>
                      </div>
                    )}
                    {selBld.type === 'techlab' && (
                      <div className="text-xs text-purple-400 space-y-0.5">
                        <div className="flex items-center gap-1">🔬 Центр исследований</div>
                        <div className="text-[10px] text-neutral-500">Исследуйте технологии, затем улучшайте здания до ур.10</div>
                      </div>
                    )}
                    {selBld.type === 'refinery' && (() => {
                      const ref = selBld as any
                      const stock = ref.spiceStock ?? 0
                      const capMult = getUpgrade(s, 'atreides', 'refineryCap')
                      const rateMult = getUpgrade(s, 'atreides', 'refineryRate')
                      const baseMax = ref.baseMaxSpiceStock ?? 210
                      const max = Math.round(baseMax * capMult)
                      const pct = max > 0 ? Math.min(100, Math.round((stock / max) * 100)) : 0
                      const status = pct >= 100 ? 'Переполнен — ждите' : stock > 0 ? 'Перерабатывает...' : 'Ожидает спайс'
                      const statusColor = pct >= 100 ? 'text-red-400' : stock > 0 ? 'text-emerald-400' : 'text-neutral-500'
                      return (
                        <div className="text-xs space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-orange-400 font-medium">🏭 Спайс-завод</span>
                            <span className={`text-[10px] ${statusColor}`}>{status}</span>
                          </div>
                          <div>
                            <div className="flex items-center justify-between text-[10px] text-neutral-400 mb-0.5">
                              <span>Склад спайса</span>
                              <span>{Math.round(stock)} / {max}</span>
                            </div>
                            <div className="h-2 bg-neutral-900 rounded overflow-hidden ring-1 ring-neutral-700">
                              <div className="h-full transition-all duration-200" style={{ width: `${pct}%`, background: pct >= 100 ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : 'linear-gradient(90deg,#f97316,#fbbf24)' }} />
                            </div>
                          </div>
                          <div className="text-[10px] text-neutral-500">
                            Вместимость ×{capMult.toFixed(1)} · Скорость ×{rateMult.toFixed(1)}
                          </div>
                        </div>
                      )
                    })()}
                    {selBld.type === 'turret' && (() => {
                      const tier = selBld.level || 1
                      const tierName = tier === 3 ? 'Лазер' : tier === 2 ? 'Бронебойные пули' : 'Пулемёт'
                      const tierColor = tier === 3 ? 'text-cyan-400' : tier === 2 ? 'text-orange-400' : 'text-yellow-400'
                      const tierDmgMult = tier === 3 ? 2.5 : tier === 2 ? 1.5 : 1.0
                      const tierRangeMult = tier === 3 ? 1.35 : tier === 2 ? 1.10 : 1.0
                      const dmg = (CONFIG.turret.dmg * getUpgrade(s, 'atreides', 'turretDmg') * tierDmgMult)
                      const range = (CONFIG.turret.range * getUpgrade(s, 'atreides', 'turretRange') * tierRangeMult)
                      return (
                        <div className="text-xs space-y-0.5">
                          <div className="flex items-center gap-1">
                            <span className="text-neutral-500">Тир {tier}:</span>
                            <span className={`font-medium ${tierColor}`}>{tierName}</span>
                          </div>
                          <div className="text-neutral-400">Радиус: {range.toFixed(1)} · Урон: {dmg.toFixed(0)}</div>
                        </div>
                      )
                    })()}
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg bg-neutral-800/40 text-xs text-neutral-500 text-center">Ничего не выбрано</div>
                )}
              </div>

              <Separator className="bg-neutral-800" />

              {/* Build menu — grid of large touch buttons on mobile */}
              <div>
                <h3 className="text-[11px] font-semibold uppercase text-neutral-400 mb-1.5">Строительство</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    ['generator', CONFIG.generator.cost], ['barracks', CONFIG.barracks.cost],
                    ['factory', CONFIG.factory.cost], ['turret', CONFIG.turret.cost],
                    ['refinery', CONFIG.refinery.cost], ['radar', CONFIG.radar.cost],
                    ['techlab', CONFIG.techlab.cost],
                  ] as [BuildingType, number][]).map(([t, cost]) => {
                    const can = s.players.atreides.credits >= cost
                    const active = buildMode === t
                    return (
                      <button key={t} onClick={()=>handleBuild(t)} disabled={!can}
                        className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-all touch-manipulation ${active?'bg-amber-700 ring-2 ring-amber-400':can?'bg-neutral-800 hover:bg-neutral-700':'bg-neutral-900 opacity-40'}`}>
                        <div className="w-9 h-9 ring-1 ring-neutral-600 rounded overflow-hidden">
                          <img src={getBuildingPreview(t, 'atreides', 36, FOOTPRINT[t].w, FOOTPRINT[t].h)} alt="" className="w-full h-full"/>
                        </div>
                        <div className="text-[10px] leading-tight text-center">{typeRu(t)}</div>
                        <div className={`text-[10px] font-mono ${can?'text-amber-400':'text-red-400'}`}>{cost}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <Separator className="bg-neutral-800" />

              {/* Enemy info */}
              <div>
                <h3 className="text-[11px] font-semibold uppercase text-neutral-400 mb-1">Харконнен</h3>
                <div className="text-[11px] space-y-0.5 text-neutral-400">
                  <div className="flex justify-between"><span>Кредиты:</span><span className="font-mono text-purple-400">{Math.floor(s.players.harkonnen.credits)}</span></div>
                  <div className="flex justify-between"><span>Юнитов:</span><span className="font-mono">{s.units.filter(u=>u.owner==='harkonnen').length}</span></div>
                  <div className="flex justify-between"><span>Зданий:</span><span className="font-mono">{s.buildings.filter(b=>b.owner==='harkonnen').length}</span></div>
                  <div className="flex justify-between"><span>Червей:</span><span className="font-mono text-orange-500">{s.worms.length}</span></div>
                </div>
              </div>

              <Separator className="bg-neutral-800" />

              {/* Event log */}
              <div>
                <h3 className="text-[11px] font-semibold uppercase text-neutral-400 mb-1">События</h3>
                <div className="space-y-0.5 max-h-32 overflow-y-auto pr-1">
                  {s.events.slice(-8).reverse().map((ev, i) => (
                    <div key={i} className={`text-[10px] leading-tight ${
                      ev.type==='win'?'text-amber-400 font-bold':ev.type==='lose'?'text-red-400 font-bold':
                      ev.type==='warn'?'text-orange-400':ev.type==='death'?'text-red-300':
                      ev.type==='spice'?'text-green-400':ev.type==='build'?'text-blue-300':'text-neutral-400'
                    }`}>{ev.msg}</div>
                  ))}
                  {s.events.length === 0 && <div className="text-[10px] text-neutral-600">Пока тихо...</div>}
                </div>
              </div>
            </div>
          </ScrollArea>
        </aside>
      </div>

      {/* Bottom bar — shows latest event + controls hint */}
      <footer className="border-t border-neutral-800 bg-neutral-900 px-2 py-1 flex items-center gap-2 shrink-0 overflow-hidden">
        <button onClick={()=>setShowHelp(h=>!h)} className="touch-manipulation text-neutral-400 underline text-[10px] shrink-0">?</button>
        {/* Latest event ticker */}
        <div className="flex-1 min-w-0 text-[10px] truncate">
          {s.events.length > 0 ? (
            <span className={
              s.events[s.events.length-1].type==='win'?'text-amber-400 font-bold':
              s.events[s.events.length-1].type==='lose'?'text-red-400 font-bold':
              s.events[s.events.length-1].type==='warn'?'text-orange-400':
              s.events[s.events.length-1].type==='death'?'text-red-300':
              s.events[s.events.length-1].type==='spice'?'text-green-400':
              s.events[s.events.length-1].type==='build'?'text-blue-300':'text-neutral-400'
            }>› {s.events[s.events.length-1].msg}</span>
          ) : (
            <span className="text-neutral-600">Тап — выбрать · Тап по карте — приказ · 2 пальца — зум · 1 палец drag — карта</span>
          )}
        </div>
        <span className="text-[10px] text-neutral-500 shrink-0">{Math.round(zoom*100)}% · {s.tick}</span>
      </footer>
    </div>
  )
}

function stateRu(st: string): string {
  return ({idle:'ожидание',move:'движение',attack:'атака',harvest:'сбор',return:'возврат'} as any)[st] || st
}
