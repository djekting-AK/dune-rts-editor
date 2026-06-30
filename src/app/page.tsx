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
  Download, Upload, Trash2, Undo2, Redo2, Hand, Map as MapIcon, Sparkles,
  Play, Pause, Home, Hammer, Sword, Coins, Skull, Trophy, Eye, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  TERRAIN, TILE_SIZE, drawTerrain, drawTerrainLayer, drawBuilding, drawUnit, drawWorm,
  drawHealthBar, drawSelectionRing, drawMoveMarker,
  drawProjectile, drawExplosion, drawMuzzleFlash,
  drawRangeIndicator, drawFogOfWar, drawEnergyIcon,
  getTilePreview, getBuildingPreview, getUnitPreview,
  clearTerrainCache,
  FACTION_COLORS, type Faction, type BuildingType, type UnitType,
} from '@/lib/tile-renderer'
import {
  createGame, tick, CONFIG, BUILD_COSTS, type GameState, type Unit, type Building,
  canBuild, placeBuilding, queueUnit, commandMove, commandAttack,
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
  // dune patches
  for (let i = 0; i < 5; i++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h), r = 2 + Math.floor(rng() * 3)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      if (dx*dx + dy*dy <= r*r && rng() > 0.3) g[y*w+x] = 2
    }
  }
  // rock plateaus
  for (let i = 0; i < 4; i++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h), r = 1 + Math.floor(rng() * 2)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      if (dx*dx + dy*dy <= r*r) g[y*w+x] = 3
    }
  }
  // mountains (on rock)
  for (let i = 0; i < 3; i++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h)
    if (g[cy*w+cx] === 3) g[cy*w+cx] = 4
  }
  // water lakes
  for (let i = 0; i < 2; i++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h), r = 2
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      if (dx*dx + dy*dy <= r*r) g[y*w+x] = 7
    }
  }
  // spice fields (on sand/dunes) — more, bigger, brighter
  for (let i = 0; i < 9; i++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h), r = 2 + Math.floor(rng() * 2)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const idx = y*w+x
      if ((g[idx] === 1 || g[idx] === 2) && rng() > 0.25) g[idx] = rng() > 0.4 ? 5 : 6
    }
  }
  // clear corners for bases (atreides bottom-left, harkonnen top-right)
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (Math.abs(dx) + Math.abs(dy) <= 3) {
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

  // editor state
  const [gridW, setGridW] = useState(24)
  const [gridH, setGridH] = useState(24)
  const [grid, setGrid] = useState<number[]>(() => generateDefaultMap(24, 24))
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
    // ensure map has some spice & rock
    let hasSpice = grid.some(t => t === 5 || t === 6)
    if (!hasSpice) {
      // add spice patches
      const g = [...grid]
      for (let i = 0; i < 8; i++) {
        const x = Math.floor(Math.random()*gridW), y = Math.floor(Math.random()*gridH)
        for (let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
          const nx=x+dx, ny=y+dy
          if (inBounds(nx,ny,gridW,gridH) && (g[idx(nx,ny,gridW)]===1||g[idx(nx,ny,gridW)]===2)) g[idx(nx,ny,gridW)] = Math.random()>0.5?5:6
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

  if (mode === 'menu') return <MenuScreen mode={mode} setMode={setMode} difficulty={difficulty} setDifficulty={setDifficulty} onStartGame={startGame} onOpenEditor={() => setMode('editor')} />

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
  return <GameScreen difficulty={difficulty} terrain={grid} w={gridW} h={gridH} onExit={() => setMode('menu')} />
}

// ============================================================
//  MENU SCREEN
// ============================================================
function MenuScreen({ setMode, difficulty, setDifficulty, onStartGame, onOpenEditor }: {
  mode: string; setMode: (m:'menu'|'editor'|'game')=>void
  difficulty: 'easy'|'medium'|'hard'; setDifficulty: (d:'easy'|'medium'|'hard')=>void
  onStartGame: ()=>void; onOpenEditor: ()=>void
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
function GameScreen({ difficulty, terrain, w, h, onExit }: {
  difficulty: 'easy'|'medium'|'hard'; terrain: number[]; w: number; h: number; onExit: ()=>void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<GameState>(createGame(w, h, [...terrain], difficulty))
  const [, forceRender] = useState(0)
  const [paused, setPaused] = useState(false)
  const [selected, setSelected] = useState<{type:'unit'|'building', id:number} | null>(null)
  const [buildMode, setBuildMode] = useState<BuildingType | null>(null)
  const [hoverCell, setHoverCell] = useState<{x:number,y:number}|null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [zoom, setZoom] = useState(1)
  const selectedRef = useRef(selected); selectedRef.current = selected
  const buildModeRef = useRef(buildMode); buildModeRef.current = buildMode
  const pausedRef = useRef(paused); pausedRef.current = paused
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const hoverCellRef = useRef(hoverCell); hoverCellRef.current = hoverCell

  // ---- zoom with mouse wheel ----
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => {
      const nz = Math.max(0.7, Math.min(2.5, +(z - Math.sign(e.deltaY) * 0.15).toFixed(2)))
      zoomRef.current = nz
      return nz
    })
  }
  // reset zoom on Esc
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setBuildMode(null); setZoom(1) } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  // ---- game loop (logic) ----
  useEffect(() => {
    const iv = setInterval(() => {
      if (pausedRef.current) return
      if (gameRef.current.over) return
      tick(gameRef.current)
      forceRender(n => n + 1)
    }, 100)
    return () => clearInterval(iv)
  }, [])

  // ---- render loop ----
  useEffect(() => {
    let raf = 0
    const render = () => {
      const s = gameRef.current
      const c = canvasRef.current
      const tNow = Date.now() / 400
      const z = zoomRef.current
      if (c) {
        const ctx = c.getContext('2d')!
        // render at zoom resolution for crisp pixels (1:1 with display)
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const internalW = Math.round(s.width * TILE_SIZE * z * dpr)
        const internalH = Math.round(s.height * TILE_SIZE * z * dpr)
        if (c.width !== internalW || c.height !== internalH) { c.width = internalW; c.height = internalH }
        ctx.setTransform(z * dpr, 0, 0, z * dpr, 0, 0)
        ctx.imageSmoothingEnabled = true
        // terrain (seamless per-pixel base + feature overlays)
        drawTerrainLayer(ctx, s.terrain, s.width, s.height, tNow, s.terrainVersion)
        // build preview
        if (buildModeRef.current && hoverCellRef.current) {
          const ok = canBuild(s, 'atreides', buildModeRef.current, hoverCellRef.current.x, hoverCellRef.current.y)
          ctx.fillStyle = ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'
          ctx.fillRect(hoverCellRef.current.x*TILE_SIZE, hoverCellRef.current.y*TILE_SIZE, TILE_SIZE, TILE_SIZE)
        }
        // buildings
        for (const b of s.buildings) {
          drawBuilding(ctx, b.type, b.owner, b.x*TILE_SIZE, b.y*TILE_SIZE)
          if (b.hp < b.maxHp) drawHealthBar(ctx, b.x*TILE_SIZE+TILE_SIZE/2, b.y*TILE_SIZE-2, TILE_SIZE-4, b.hp/b.maxHp)
          // production indicator
          if (b.queue.length > 0) {
            const q = b.queue[0]
            ctx.fillStyle = '#000'; ctx.fillRect(b.x*TILE_SIZE+2, b.y*TILE_SIZE+TILE_SIZE-6, TILE_SIZE-4, 4)
            ctx.fillStyle = '#22c55e'; ctx.fillRect(b.x*TILE_SIZE+2, b.y*TILE_SIZE+TILE_SIZE-6, (TILE_SIZE-4)*(q.progress/CONFIG[q.type].buildTime), 4)
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
        // units (with bob animation for moving units)
        for (const u of s.units) {
          const moving = u.state === 'move' || u.state === 'attack' || u.state === 'harvest' || u.state === 'return'
          const bob = moving ? Math.sin(tNow * 6 + u.id) * 1 : 0
          drawUnit(ctx, u.type, u.owner, u.x*TILE_SIZE, u.y*TILE_SIZE, bob)
          if (u.hp < u.maxHp) drawHealthBar(ctx, u.x*TILE_SIZE, u.y*TILE_SIZE-TILE_SIZE/2+2, TILE_SIZE-6, u.hp/u.maxHp)
          // cargo indicator for harvesters
          if (u.type === 'harvester' && u.cargo > 0) {
            ctx.fillStyle = '#e85d2f'; ctx.fillRect(u.x*TILE_SIZE-8, u.y*TILE_SIZE-TILE_SIZE/2+6, 16*(u.cargo/u.maxCargo), 3)
            ctx.fillStyle = 'rgba(255,150,80,0.6)'; ctx.fillRect(u.x*TILE_SIZE-8, u.y*TILE_SIZE-TILE_SIZE/2+6, 16*(u.cargo/u.maxCargo), 1)
          }
        }
        // worms (with subtle wiggle + HP bar if damaged)
        for (const w of s.worms) {
          const angle = Math.atan2(w.y - w.ty, w.x - w.tx) + Math.sin(tNow * 3 + w.id) * 0.15
          drawWorm(ctx, w.x*TILE_SIZE, w.y*TILE_SIZE, angle)
          if (w.hp < w.maxHp) drawHealthBar(ctx, w.x*TILE_SIZE, w.y*TILE_SIZE-TILE_SIZE/2-2, TILE_SIZE-4, w.hp/w.maxHp)
        }
        // projectiles
        for (const p of s.projectiles) {
          drawProjectile(ctx, p.x*TILE_SIZE, p.y*TILE_SIZE, p.sx*TILE_SIZE, p.sy*TILE_SIZE, p.color)
        }
        // muzzle flashes
        for (const f of s.flashes) {
          drawMuzzleFlash(ctx, f.x*TILE_SIZE, f.y*TILE_SIZE, f.frame)
        }
        // explosions
        for (const e of s.explosions) {
          drawExplosion(ctx, e.x*TILE_SIZE, e.y*TILE_SIZE, e.frame, e.maxFrame, e.size, e.color)
        }
        // fog of war (drawn BEFORE selection/effects so they stay visible)
        drawFogOfWar(ctx, s.explored, s.visible, s.width, s.height)
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
            ctx.strokeRect(b.x*TILE_SIZE, b.y*TILE_SIZE, TILE_SIZE, TILE_SIZE)
            if (b.type === 'turret') drawRangeIndicator(ctx, b.x*TILE_SIZE+TILE_SIZE/2, b.y*TILE_SIZE+TILE_SIZE/2, CONFIG.turret.range)
          }
        }
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---- input ----
  const cellFromEvt = (e: React.MouseEvent) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect()
    const x = Math.floor(((e.clientX-r.left)/r.width)*gameRef.current.width)
    const y = Math.floor(((e.clientY-r.top)/r.height)*gameRef.current.height)
    if (x<0||y<0||x>=gameRef.current.width||y>=gameRef.current.height) return null
    return { x, y }
  }
  // float coords (for picking units accurately)
  const pointFromEvt = (e: React.MouseEvent) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect()
    const x = ((e.clientX-r.left)/r.width)*gameRef.current.width
    const y = ((e.clientY-r.top)/r.height)*gameRef.current.height
    return { x, y }
  }

  const handleClick = (e: React.MouseEvent) => {
    // Only respond to LEFT mouse button
    if (e.button !== 0) return
    const s = gameRef.current
    const cell = cellFromEvt(e); if (!cell) return
    const pt = pointFromEvt(e)

    // Shift + Left click = move order (alternative to right click for touchpads)
    if (e.shiftKey) {
      const sel = selectedRef.current
      if (sel?.type === 'unit') {
        const u = s.units.find(u=>u.id===sel.id)
        if (u && u.type !== 'harvester') {
          const enemyUnit = pickUnitAt(s, pt.x, pt.y, undefined, 1.0)
          const enemyBld = pickBuildingAt(s, pt.x, pt.y)
          if (enemyUnit && enemyUnit.owner !== 'atreides') {
            commandAttack(s, u, enemyUnit.id, false); toast(`⚔ Атака: ${unitName(enemyUnit.type)}`)
          } else if (enemyBld && enemyBld.owner !== 'atreides') {
            commandAttack(s, u, enemyBld.id, true); toast(`⚔ Атака: ${bldName(enemyBld.type)}`)
          } else {
            commandMove(s, u, cell.x+0.5, cell.y+0.5)
            toast(`→ Движение (${cell.x},${cell.y})`)
          }
          forceRender(n=>n+1); return
        }
      }
    }

    // building placement
    const bm = buildModeRef.current
    if (bm) {
      if (placeBuilding(s, 'atreides', bm, cell.x, cell.y)) {
        toast.success(`Построено: ${typeRu(bm)}`)
        setBuildMode(null)
      } else {
        toast.error('Нельзя строить здесь')
      }
      forceRender(n=>n+1); return
    }

    // select nearest friendly unit, else building (radius picking = forgiving clicks)
    const unit = pickUnitAt(s, pt.x, pt.y, 'atreides', 1.0)
    const bld = pickBuildingAt(s, pt.x, pt.y, 'atreides')
    if (unit) setSelected({ type:'unit', id:unit.id })
    else if (bld) setSelected({ type:'building', id:bld.id })
    else setSelected(null)
    forceRender(n=>n+1)
  }

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const s = gameRef.current
    const cell = cellFromEvt(e); if (!cell) return
    const pt = pointFromEvt(e)
    const sel = selectedRef.current
    if (!sel) {
      toast.info('Сначала выберите юнита (ЛКМ)')
      return
    }
    if (sel.type !== 'unit') {
      toast.info('Здания нельзя двигать — выберите юнита')
      return
    }
    const u = s.units.find(u=>u.id===sel.id)
    if (!u) { toast.error('Юнит потерян'); setSelected(null); return }
    if (u.type === 'harvester') {
      toast.info('Доставщик добывает спайс автоматически')
      return
    }

    // check if clicking on enemy (any enemy unit/building near cursor)
    const enemyUnit = pickUnitAt(s, pt.x, pt.y, undefined, 1.0)
    const enemyBld = pickBuildingAt(s, pt.x, pt.y)
    if (enemyUnit && enemyUnit.owner !== 'atreides') {
      commandAttack(s, u, enemyUnit.id, false); toast(`⚔ Атака: ${unitName(enemyUnit.type)}`)
    } else if (enemyBld && enemyBld.owner !== 'atreides') {
      commandAttack(s, u, enemyBld.id, true); toast(`⚔ Атака: ${bldName(enemyBld.type)}`)
    } else {
      commandMove(s, u, cell.x+0.5, cell.y+0.5)
      toast(`→ Движение (${cell.x},${cell.y})`)
    }
    forceRender(n=>n+1)
  }

  const handleBuild = (type: BuildingType) => {
    const s = gameRef.current
    if (s.players.atreides.credits < BUILD_COSTS[type]) { toast.error('Недостаточно кредитов'); return }
    setBuildMode(type)
    toast.info(`Кликните по карте для постройки: ${typeRu(type)}`)
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
    if (!hasPower(s, 'atreides')) { toast.error('Недостаточно энергии! Постройте генератор'); return }
    if (queueUnit(s, b, type)) toast.success(`В производство: ${unitName(type)}`)
    else toast.error('Недостаточно средств или здание не достроено')
    forceRender(n=>n+1)
  }

  const s = gameRef.current
  const selUnit = selected?.type==='unit' ? s.units.find(u=>u.id===selected.id) : null
  const selBld = selected?.type==='building' ? s.buildings.find(b=>b.id===selected.id) : null
  const myUnits = s.units.filter(u=>u.owner==='atreides')
  const myBldgs = s.buildings.filter(b=>b.owner==='atreides')
  const armyCount = myUnits.filter(u=>u.type!=='harvester').length
  const harvesterCount = myUnits.filter(u=>u.type==='harvester').length

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
      {/* Top HUD */}
      <header className="border-b border-neutral-800 bg-neutral-900/90 backdrop-blur px-4 py-2 flex items-center gap-4 flex-wrap sticky top-0 z-20">
        <Button size="sm" variant="ghost" onClick={onExit}><Home className="w-4 h-4 mr-1"/>Меню</Button>
        <Separator orientation="vertical" className="h-6 bg-neutral-700" />
        <div className="flex items-center gap-1.5 text-amber-400 font-bold">
          <Coins className="w-4 h-4" /> <span className="font-mono">{Math.floor(s.players.atreides.credits)}</span>
        </div>
        {/* Energy indicator */}
        <div className={`flex items-center gap-1.5 font-bold ${hasPower(s, 'atreides') ? 'text-cyan-400' : 'text-red-400'}`}>
          <Zap className="w-4 h-4" />
          <span className="font-mono text-xs">{s.players.atreides.energyMax - s.players.atreides.energyDemand}/{s.players.atreides.energyMax}</span>
        </div>
        <Badge variant="outline" className="border-amber-700/50 text-amber-500">Атрейдес</Badge>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span>Армия: <b className="text-neutral-200">{armyCount}</b></span>
          <span>Доставщики: <b className="text-neutral-200">{harvesterCount}</b></span>
          <span>Здания: <b className="text-neutral-200">{myBldgs.length}</b></span>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={()=>setPaused(p=>!p)}>
          {paused ? <><Play className="w-4 h-4 mr-1"/>Продолжить</> : <><Pause className="w-4 h-4 mr-1"/>Пауза</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={()=>setShowHelp(h=>!h)}><Eye className="w-4 h-4 mr-1"/>Помощь</Button>
      </header>

      {showHelp && (
        <div className="bg-neutral-900 border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400 flex gap-4 flex-wrap">
          <span><b className="text-emerald-400">ЛКМ</b> — выбрать юнит/здание</span>
          <span><b className="text-amber-400">ПКМ</b> — приказ движения/атаки</span>
          <span><b className="text-amber-400">Shift+ЛКМ</b> — приказ (если нет ПКМ)</span>
          <span><b className="text-neutral-200">Колесо</b> — зум</span>
          <span><b className="text-neutral-200">Esc</b> — сброс</span>
          <span><b className="text-neutral-200">Доставщик</b> — авто-добыча спайса</span>
          <span><b className="text-orange-400">Червь</b> — ест юнитов на песке</span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <main className="flex-1 overflow-auto bg-black flex items-start justify-center p-4">
          <div className="shadow-2xl ring-1 ring-neutral-800 relative">
            <canvas ref={canvasRef}
              onMouseDown={handleClick} onContextMenu={handleRightClick}
              onWheel={onWheel}
              onMouseMove={e => {
                const c = cellFromEvt(e); setHoverCell(c)
                // live cursor feedback (no re-render needed)
                const pt = pointFromEvt(e)
                const s2 = gameRef.current
                const hovering = pickUnitAt(s2, pt.x, pt.y, undefined, 1.0) || pickBuildingAt(s2, pt.x, pt.y)
                const canvas = canvasRef.current
                if (canvas) {
                  if (buildMode) canvas.style.cursor = 'crosshair'
                  else if (hovering) canvas.style.cursor = 'pointer'
                  else if (selectedRef.current?.type === 'unit') canvas.style.cursor = 'move'
                  else canvas.style.cursor = 'default'
                }
              }}
              onMouseLeave={() => setHoverCell(null)}
              className="block" style={{ width: `${zoom * 100}%`, aspectRatio: `${gameRef.current.width} / ${gameRef.current.height}`, height: 'auto', cursor: 'default' }} />
            {/* CRT retro overlay — scanlines + vignette + warm grade */}
            <div className="pointer-events-none absolute inset-0 crt-overlay" />
            {/* Win/Lose overlay */}
            {s.over && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur">
                <div className="text-center">
                  {s.winner === 'atreides' ? (
                    <><Trophy className="w-20 h-20 text-amber-400 mx-auto mb-4" />
                    <div className="text-5xl font-black text-amber-400 mb-2">ПОБЕДА</div>
                    <div className="text-neutral-400 mb-6">Дворец Харконнен разрушен!</div></>
                  ) : (
                    <><Skull className="w-20 h-20 text-red-500 mx-auto mb-4" />
                    <div className="text-5xl font-black text-red-500 mb-2">ПОРАЖЕНИЕ</div>
                    <div className="text-neutral-400 mb-6">Ваш дворец пал!</div></>
                  )}
                  <Button onClick={onExit} size="lg" className="bg-amber-600 hover:bg-amber-700">В меню</Button>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right panel */}
        <aside className="w-72 border-l border-neutral-800 bg-neutral-900/50 flex flex-col">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-4">
              {/* Selection info */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">Выбрано</h3>
                {selUnit ? (
                  <div className="p-3 rounded-lg bg-neutral-800/60 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 ring-1 ring-neutral-600 rounded overflow-hidden">
                        <img src={getUnitPreview(selUnit.type, 'atreides', 48)} alt="" className="w-full h-full"/>
                      </div>
                      <div>
                        <div className="text-sm font-medium capitalize">{typeRu(selUnit.type)}</div>
                        <div className="text-xs text-neutral-400">HP {Math.ceil(selUnit.hp)}/{selUnit.maxHp}</div>
                      </div>
                    </div>
                    {selUnit.type === 'harvester' && <div className="text-xs text-orange-400">Спайс: {selUnit.cargo}/{selUnit.maxCargo}</div>}
                    <div className="text-xs text-neutral-400">Состояние: {stateRu(selUnit.state)}</div>
                    <div className="text-[10px] text-neutral-500 pt-1">ПКМ — приказ двигаться/атаковать</div>
                  </div>
                ) : selBld ? (
                  <div className="p-3 rounded-lg bg-neutral-800/60 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 ring-1 ring-neutral-600 rounded overflow-hidden">
                        <img src={getBuildingPreview(selBld.type, 'atreides', 48)} alt="" className="w-full h-full"/>
                      </div>
                      <div>
                        <div className="text-sm font-medium">{typeRu(selBld.type)}</div>
                        <div className="text-xs text-neutral-400">HP {Math.ceil(selBld.hp)}/{selBld.maxHp}</div>
                      </div>
                    </div>
                    {selBld.hp < selBld.maxHp && <div className="text-xs text-amber-500">Строится... {Math.floor(selBld.hp/selBld.maxHp*100)}%</div>}
                    {/* Production buttons */}
                    {selBld.type === 'palace' && (
                      <Button size="sm" className="w-full bg-amber-600 hover:bg-amber-700" onClick={()=>handleProduce('harvester')}>
                        <Hammer className="w-3 h-3 mr-1"/> Доставщик ({CONFIG.harvester.cost})
                      </Button>
                    )}
                    {selBld.type === 'barracks' && (
                      <Button size="sm" className="w-full bg-amber-600 hover:bg-amber-700" onClick={()=>handleProduce('soldier')}>
                        <Sword className="w-3 h-3 mr-1"/> Солдат ({CONFIG.soldier.cost})
                      </Button>
                    )}
                    {selBld.type === 'factory' && (
                      <Button size="sm" className="w-full bg-amber-600 hover:bg-amber-700" onClick={()=>handleProduce('tank')}>
                        <Sword className="w-3 h-3 mr-1"/> Танк ({CONFIG.tank.cost})
                      </Button>
                    )}
                    {selBld.queue.length > 0 && (
                      <div className="text-xs text-neutral-400">В очереди: {selBld.queue.length}</div>
                    )}
                    {selBld.type === 'generator' && (
                      <div className="text-xs text-cyan-400 flex items-center gap-1"><Zap className="w-3 h-3"/> Производит: +{CONFIG.generator.energyOutput} энергии</div>
                    )}
                    {selBld.type === 'turret' && (
                      <div className="text-xs text-neutral-400">Радиус атаки: {CONFIG.turret.range} · Урон: {CONFIG.turret.dmg}</div>
                    )}
                    {'energy' in CONFIG[selBld.type] && (CONFIG[selBld.type] as any).energy > 0 && (
                      <div className="text-xs text-amber-500 flex items-center gap-1"><Zap className="w-3 h-3"/> Расход: {(CONFIG[selBld.type] as any).energy} энергии</div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-neutral-800/40 text-xs text-neutral-500 text-center">Ничего не выбрано</div>
                )}
              </div>

              <Separator className="bg-neutral-800" />

              {/* Build menu */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">Строительство</h3>
                <div className="space-y-1.5">
                  {([
                    ['generator', CONFIG.generator.cost], ['barracks', CONFIG.barracks.cost],
                    ['factory', CONFIG.factory.cost], ['turret', CONFIG.turret.cost],
                    ['refinery', CONFIG.refinery.cost],
                  ] as [BuildingType, number][]).map(([t, cost]) => {
                    const can = s.players.atreides.credits >= cost
                    return (
                      <button key={t} onClick={()=>handleBuild(t)} disabled={!can}
                        className={`w-full flex items-center gap-2 p-2 rounded-lg transition-all ${can?'bg-neutral-800 hover:bg-neutral-700':'bg-neutral-900 opacity-40'}`}>
                        <div className="w-8 h-8 ring-1 ring-neutral-600 rounded overflow-hidden">
                          <img src={getBuildingPreview(t, 'atreides', 40)} alt="" className="w-full h-full"/>
                        </div>
                        <div className="flex-1 text-left">
                          <div className="text-sm">{typeRu(t)}</div>
                        </div>
                        <div className={`text-xs font-mono ${can?'text-amber-400':'text-red-400'}`}>{cost}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <Separator className="bg-neutral-800" />

              {/* Enemy info */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">Враг: Харконнен</h3>
                <div className="text-xs space-y-1 text-neutral-400">
                  <div className="flex justify-between"><span>Кредиты:</span><span className="font-mono text-purple-400">{Math.floor(s.players.harkonnen.credits)}</span></div>
                  <div className="flex justify-between"><span>Юнитов:</span><span className="font-mono">{s.units.filter(u=>u.owner==='harkonnen').length}</span></div>
                  <div className="flex justify-between"><span>Зданий:</span><span className="font-mono">{s.buildings.filter(b=>b.owner==='harkonnen').length}</span></div>
                  <div className="flex justify-between"><span>Червей:</span><span className="font-mono text-orange-500">{s.worms.length}</span></div>
                </div>
              </div>

              <Separator className="bg-neutral-800" />

              {/* Event log */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">События</h3>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {s.events.slice(-10).reverse().map((ev, i) => (
                    <div key={i} className={`text-[11px] leading-tight ${
                      ev.type==='win'?'text-amber-400 font-bold':ev.type==='lose'?'text-red-400 font-bold':
                      ev.type==='warn'?'text-orange-400':ev.type==='death'?'text-red-300':
                      ev.type==='spice'?'text-green-400':ev.type==='build'?'text-blue-300':'text-neutral-400'
                    }`}>{ev.msg}</div>
                  ))}
                  {s.events.length === 0 && <div className="text-[11px] text-neutral-600">Пока тихо...</div>}
                </div>
              </div>
            </div>
          </ScrollArea>
        </aside>
      </div>

      <footer className="border-t border-neutral-800 bg-neutral-900 px-4 py-1.5 text-[11px] text-neutral-500 flex gap-4">
        <span><b className="text-emerald-400">ЛКМ</b> выбрать</span>
        <span><b className="text-amber-400">ПКМ</b> приказ</span>
        <span><b className="text-amber-400">Shift+ЛКМ</b> приказ</span>
        <span><b className="text-neutral-300">Колесо</b> зум</span>
        <span className="ml-auto">Зум: {Math.round(zoom*100)}% · Тик: {s.tick} · Сложность: {difficulty==='easy'?'лёгкая':difficulty==='medium'?'средняя':'тяжёлая'}</span>
      </footer>
    </div>
  )
}

function stateRu(st: string): string {
  return ({idle:'ожидание',move:'движение',attack:'атака',harvest:'сбор',return:'возврат'} as any)[st] || st
}
