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
  Download, Upload, Trash2, Undo2, Redo2, Play, Hand, Map as MapIcon
} from 'lucide-react'
import { toast } from 'sonner'

// ---------- Tile definitions ----------
type Tool = 'brush' | 'eraser' | 'fill' | 'rect' | 'pan'

interface TileDef {
  id: number
  name: string
  color: string
  icon: string
  category: 'terrain' | 'resource' | 'building' | 'unit'
  walkable: boolean
}

const TILES: TileDef[] = [
  { id: 0,  name: 'Пустота',      color: '#0a0a0a', icon: '∅', category: 'terrain',  walkable: false },
  { id: 1,  name: 'Песок',        color: '#d9a441', icon: '·', category: 'terrain',  walkable: true  },
  { id: 2,  name: 'Дюны',         color: '#b8842e', icon: '≈', category: 'terrain',  walkable: true  },
  { id: 3,  name: 'Скала',        color: '#6b6b6b', icon: '▲', category: 'terrain',  walkable: false },
  { id: 4,  name: 'Горы',         color: '#3d3d3d', icon: '▲', category: 'terrain',  walkable: false },
  { id: 5,  name: 'Спайс',        color: '#e85d2f', icon: '✦', category: 'resource', walkable: true  },
  { id: 6,  name: 'Спайс (богатый)', color: '#c43d1a', icon: '✸', category: 'resource', walkable: true },
  { id: 7,  name: 'Вода',         color: '#2b7a9e', icon: '≈', category: 'terrain',  walkable: false },
  { id: 8,  name: 'Дворец',       color: '#8b1a1a', icon: '♔', category: 'building', walkable: false },
  { id: 9,  name: 'База Атрейдес', color: '#1a4d8b', icon: '⌂', category: 'building', walkable: false },
  { id: 10, name: 'База Харконнен', color: '#5b1a8b', icon: '⌂', category: 'building', walkable: false },
  { id: 11, name: 'База Ордос',   color: '#1a8b4d', icon: '⌂', category: 'building', walkable: false },
  { id: 12, name: 'Казармы',      color: '#7a5c3a', icon: '▤', category: 'building', walkable: false },
  { id: 13, name: 'Турель',       color: '#4a4a4a', icon: '◉', category: 'building', walkable: false },
  { id: 14, name: 'Солдат',       color: '#d9d9d9', icon: '♙', category: 'unit',     walkable: true  },
  { id: 15, name: 'Танк',         color: '#5a5a5a', icon: '▣', category: 'unit',     walkable: true  },
  { id: 16, name: 'Червь',        color: '#8b4513', icon: '〜', category: 'unit',     walkable: false },
  { id: 17, name: 'Доставщик',    color: '#e0c060', icon: '◆', category: 'unit',     walkable: true  },
]

const TILE_MAP = new Map(TILES.map(t => [t.id, t]))
const CATEGORIES = ['terrain', 'resource', 'building', 'unit'] as const
const CATEGORY_LABELS: Record<string, string> = {
  terrain: 'Рельеф', resource: 'Ресурсы', building: 'Здания', unit: 'Юниты'
}

const DEFAULT_W = 48
const DEFAULT_H = 48
const TILE_PX = 16

// ---------- Helpers ----------
function emptyGrid(w: number, h: number): number[] {
  return new Array(w * h).fill(1) // sand by default
}

function floodFill(grid: number[], w: number, h: number, x: number, y: number, target: number, replacement: number): number[] {
  if (target === replacement) return grid
  const result = [...grid]
  const stack = [[x, y]]
  while (stack.length) {
    const [cx, cy] = stack.pop()!
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue
    const idx = cy * w + cx
    if (result[idx] !== target) continue
    result[idx] = replacement
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
  return result
}

// ---------- Component ----------
export default function EditorPage() {
  const [gridW, setGridW] = useState(DEFAULT_W)
  const [gridH, setGridH] = useState(DEFAULT_H)
  const [grid, setGrid] = useState<number[]>(() => emptyGrid(DEFAULT_W, DEFAULT_H))
  const [selectedTile, setSelectedTile] = useState(1)
  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(1)
  const [showGrid, setShowGrid] = useState(true)
  const [history, setHistory] = useState<number[][]>([])
  const [redoStack, setRedoStack] = useState<number[][]>([])
  const [mapName, setMapName] = useState('Новая карта')
  const [hoverCell, setHoverCell] = useState<{x:number,y:number}|null>(null)
  const [rectStart, setRectStart] = useState<{x:number,y:number}|null>(null)
  const [previewGrid, setPreviewGrid] = useState<number[] | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const miniRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const panRef = useRef({ x: 0, y: 0, scale: 1, dragging: false, lastX: 0, lastY: 0 })

  // ----- Drawing -----
  const draw = useCallback((g: number[] = grid, preview?: number[] | null) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const w = gridW, h = gridH
    canvas.width = w * TILE_PX
    canvas.height = h * TILE_PX

    // background
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const data = preview ?? g
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = data[y * w + x]
        const tile = TILE_MAP.get(id)
        if (!tile) continue
        ctx.fillStyle = tile.color
        ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX)
        // icon for non-terrain
        if (tile.category !== 'terrain' && tile.icon !== '∅') {
          ctx.fillStyle = tile.category === 'unit' ? '#000' : 'rgba(0,0,0,0.4)'
          ctx.font = `${TILE_PX - 4}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(tile.icon, x * TILE_PX + TILE_PX / 2, y * TILE_PX + TILE_PX / 2 + 1)
        }
      }
    }

    // grid lines
    if (showGrid) {
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'
      ctx.lineWidth = 1
      for (let x = 0; x <= w; x++) {
        ctx.beginPath()
        ctx.moveTo(x * TILE_PX + 0.5, 0)
        ctx.lineTo(x * TILE_PX + 0.5, h * TILE_PX)
        ctx.stroke()
      }
      for (let y = 0; y <= h; y++) {
        ctx.beginPath()
        ctx.moveTo(0, y * TILE_PX + 0.5)
        ctx.lineTo(w * TILE_PX, y * TILE_PX + 0.5)
        ctx.stroke()
      }
    }

    // hover highlight
    if (hoverCell) {
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      const s = brushSize
      ctx.strokeRect(
        (hoverCell.x - Math.floor(s / 2)) * TILE_PX + 1,
        (hoverCell.y - Math.floor(s / 2)) * TILE_PX + 1,
        s * TILE_PX - 2,
        s * TILE_PX - 2
      )
    }

    // rect preview
    if (tool === 'rect' && rectStart && hoverCell) {
      ctx.strokeStyle = TILE_MAP.get(selectedTile)?.color || '#fff'
      ctx.lineWidth = 2
      const x1 = Math.min(rectStart.x, hoverCell.x)
      const y1 = Math.min(rectStart.y, hoverCell.y)
      const x2 = Math.max(rectStart.x, hoverCell.x)
      const y2 = Math.max(rectStart.y, hoverCell.y)
      ctx.strokeRect(x1 * TILE_PX, y1 * TILE_PX, (x2 - x1 + 1) * TILE_PX, (y2 - y1 + 1) * TILE_PX)
    }
  }, [grid, gridW, gridH, showGrid, hoverCell, brushSize, tool, rectStart, selectedTile])

  const drawMini = useCallback(() => {
    const c = miniRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const s = 4
    c.width = gridW * s
    c.height = gridH * s
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const id = grid[y * gridW + x]
        const tile = TILE_MAP.get(id)
        if (!tile) continue
        ctx.fillStyle = tile.color
        ctx.fillRect(x * s, y * s, s, s)
      }
    }
  }, [grid, gridW, gridH])

  useEffect(() => { draw() }, [draw])
  useEffect(() => { drawMini() }, [drawMini])

  // ----- History -----
  const pushHistory = useCallback((prev: number[]) => {
    setHistory(h => {
      const next = [...h, prev]
      if (next.length > 50) next.shift()
      return next
    })
    setRedoStack([])
  }, [])

  // ----- Painting -----
  const paintAt = useCallback((x: number, y: number, g: number[], tile: number): number[] => {
    const result = [...g]
    const half = Math.floor(brushSize / 2)
    for (let dy = 0; dy < brushSize; dy++) {
      for (let dx = 0; dx < brushSize; dx++) {
        const nx = x - half + dx
        const ny = y - half + dy
        if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue
        result[ny * gridW + nx] = tile
      }
    }
    return result
  }, [brushSize, gridW, gridH])

  const getCellFromEvent = (e: React.MouseEvent): {x:number,y:number} | null => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = Math.floor(((e.clientX - rect.left) * scaleX) / TILE_PX)
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / TILE_PX)
    if (x < 0 || y < 0 || x >= gridW || y >= gridH) return null
    return { x, y }
  }

  const handleDown = (e: React.MouseEvent) => {
    const cell = getCellFromEvent(e)
    if (!cell) return
    if (tool === 'pan' || e.button === 1) return

    pushHistory(grid)

    if (tool === 'fill') {
      const target = grid[cell.y * gridW + cell.x]
      setGrid(floodFill(grid, gridW, gridH, cell.x, cell.y, target, selectedTile))
      return
    }

    if (tool === 'rect') {
      setRectStart(cell)
      return
    }

    isDrawing.current = true
    if (tool === 'eraser') {
      setGrid(prev => paintAt(cell.x, cell.y, prev, 0))
    } else {
      setGrid(prev => paintAt(cell.x, cell.y, prev, selectedTile))
    }
  }

  const handleMove = (e: React.MouseEvent) => {
    const cell = getCellFromEvent(e)
    setHoverCell(cell)
    if (!cell) return

    if (tool === 'rect' && rectStart) {
      const half = Math.floor(brushSize / 2)
      const x1 = Math.min(rectStart.x, cell.x)
      const y1 = Math.min(rectStart.y, cell.y)
      const x2 = Math.max(rectStart.x, cell.x)
      const y2 = Math.max(rectStart.y, cell.y)
      const preview = [...grid]
      for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
          for (let dy = 0; dy < brushSize; dy++) {
            for (let dx = 0; dx < brushSize; dx++) {
              const nx = x - half + dx
              const ny = y - half + dy
              if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue
              preview[ny * gridW + nx] = selectedTile
            }
          }
        }
      }
      setPreviewGrid(preview)
      return
    }

    if (!isDrawing.current) return
    if (tool === 'eraser') {
      setGrid(prev => paintAt(cell.x, cell.y, prev, 0))
    } else if (tool === 'brush') {
      setGrid(prev => paintAt(cell.x, cell.y, prev, selectedTile))
    }
  }

  const handleUp = () => {
    if (tool === 'rect' && rectStart && previewGrid) {
      setGrid(previewGrid)
      setPreviewGrid(null)
      setRectStart(null)
    }
    isDrawing.current = false
  }

  const handleLeave = () => {
    setHoverCell(null)
    isDrawing.current = false
    if (previewGrid) { setPreviewGrid(null); setRectStart(null) }
  }

  // ----- Actions -----
  const undo = () => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory(h => h.slice(0, -1))
    setRedoStack(r => [...r, grid])
    setGrid(prev)
  }
  const redo = () => {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setRedoStack(r => r.slice(0, -1))
    setHistory(h => [...h, grid])
    setGrid(next)
  }
  const clear = () => {
    pushHistory(grid)
    setGrid(emptyGrid(gridW, gridH))
    toast.success('Карта очищена')
  }
  const fillAll = () => {
    pushHistory(grid)
    setGrid(new Array(gridW * gridH).fill(selectedTile))
    toast.success(`Заполнено: ${TILE_MAP.get(selectedTile)?.name}`)
  }

  const resize = (w: number, h: number) => {
    pushHistory(grid)
    const ng = emptyGrid(w, h)
    for (let y = 0; y < Math.min(h, gridH); y++) {
      for (let x = 0; x < Math.min(w, gridW); x++) {
        ng[y * w + x] = grid[y * gridW + x]
      }
    }
    setGridW(w); setGridH(h); setGrid(ng)
  }

  // ----- Persistence -----
  const saveLocal = () => {
    const data = { name: mapName, w: gridW, h: gridH, grid, version: 1, saved: Date.now() }
    localStorage.setItem('dune-map', JSON.stringify(data))
    toast.success(`Карта "${mapName}" сохранена`)
  }
  const loadLocal = () => {
    const raw = localStorage.getItem('dune-map')
    if (!raw) { toast.error('Нет сохранённой карты'); return }
    try {
      const data = JSON.parse(raw)
      setGridW(data.w); setGridH(data.h); setGrid(data.grid); setMapName(data.name)
      setHistory([]); setRedoStack([])
      toast.success(`Загружено: "${data.name}"`)
    } catch { toast.error('Ошибка чтения') }
  }
  const exportJson = () => {
    const data = { name: mapName, w: gridW, h: gridH, grid, version: 1 }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${mapName.replace(/\s+/g, '_')}.json`; a.click()
    URL.revokeObjectURL(url)
    toast.success('Экспортировано в JSON')
  }
  const importJson = () => fileInputRef.current?.click()
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        setGridW(data.w); setGridH(data.h); setGrid(data.grid); setMapName(data.name || 'Импорт')
        setHistory([]); setRedoStack([])
        toast.success(`Импортировано: ${data.name}`)
      } catch { toast.error('Неверный файл') }
    }
    reader.readAsText(f)
    e.target.value = ''
  }

  const stats = useMemo(() => {
    const counts: Record<number, number> = {}
    grid.forEach(id => { counts[id] = (counts[id] || 0) + 1 })
    return Object.entries(counts)
      .map(([id, c]) => ({ tile: TILE_MAP.get(Number(id))!, count: c }))
      .filter(s => s.tile && s.tile.id !== 0)
      .sort((a, b) => b.count - a.count)
  }, [grid])

  const tools: { id: Tool; icon: any; label: string; hotkey: string }[] = [
    { id: 'brush',  icon: Brush,       label: 'Кисть',  hotkey: 'B' },
    { id: 'eraser', icon: Eraser,      label: 'Ластик', hotkey: 'E' },
    { id: 'fill',   icon: PaintBucket, label: 'Заливка', hotkey: 'F' },
    { id: 'rect',   icon: Square,      label: 'Прямоугольник', hotkey: 'R' },
    { id: 'pan',    icon: Hand,        label: 'Панорама', hotkey: 'H' },
  ]

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const key = e.key.toLowerCase()
      if (key === 'b') setTool('brush')
      else if (key === 'e') setTool('eraser')
      else if (key === 'f') setTool('fill')
      else if (key === 'r') setTool('rect')
      else if (key === 'h') setTool('pan')
      else if (key === 'g') setShowGrid(s => !s)
      else if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      else if ((e.ctrlKey || e.metaKey) && key === 's') { e.preventDefault(); saveLocal() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [history, redoStack, grid, mapName])

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur px-4 py-2 flex items-center gap-3 flex-wrap sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-amber-500 to-orange-700 flex items-center justify-center font-bold text-sm">D</div>
          <h1 className="text-lg font-bold tracking-tight">Dune Map Editor</h1>
          <Badge variant="outline" className="text-amber-500 border-amber-700/50">v1.0</Badge>
        </div>
        <Separator orientation="vertical" className="h-6 bg-neutral-700" />
        <Input
          value={mapName}
          onChange={e => setMapName(e.target.value)}
          className="w-48 h-8 bg-neutral-800 border-neutral-700"
          placeholder="Название карты"
        />
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={undo} disabled={!history.length} title="Ctrl+Z">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={redo} disabled={!redoStack.length} title="Ctrl+Y">
            <Redo2 className="w-4 h-4" />
          </Button>
          <Separator orientation="vertical" className="h-6 mx-1 bg-neutral-700" />
          <Button size="sm" variant="ghost" onClick={saveLocal} title="Ctrl+S"><Save className="w-4 h-4 mr-1" />Сохранить</Button>
          <Button size="sm" variant="ghost" onClick={loadLocal}><FolderOpen className="w-4 h-4 mr-1" />Загрузить</Button>
          <Button size="sm" variant="ghost" onClick={exportJson}><Download className="w-4 h-4 mr-1" />Экспорт</Button>
          <Button size="sm" variant="ghost" onClick={importJson}><Upload className="w-4 h-4 mr-1" />Импорт</Button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={onFile} />
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left toolbar */}
        <aside className="w-16 border-r border-neutral-800 bg-neutral-900/50 flex flex-col items-center py-3 gap-1">
          {tools.map(t => {
            const Icon = t.icon
            return (
              <Button
                key={t.id}
                size="icon"
                variant={tool === t.id ? 'default' : 'ghost'}
                onClick={() => setTool(t.id)}
                className={`w-11 h-11 ${tool === t.id ? 'bg-amber-600 hover:bg-amber-600' : ''}`}
                title={`${t.label} (${t.hotkey})`}
              >
                <Icon className="w-5 h-5" />
              </Button>
            )
          })}
          <Separator className="my-2 bg-neutral-700 w-8" />
          <Button size="icon" variant={showGrid ? 'default' : 'ghost'} onClick={() => setShowGrid(s => !s)} title="Сетка (G)" className={`w-11 h-11 ${showGrid ? 'bg-amber-600 hover:bg-amber-600' : ''}`}>
            <Grid3x3 className="w-5 h-5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={fillAll} title="Залить всё" className="w-11 h-11">
            <PaintBucket className="w-5 h-5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={clear} title="Очистить" className="w-11 h-11 text-red-400 hover:text-red-300">
            <Trash2 className="w-5 h-5" />
          </Button>
        </aside>

        {/* Canvas area */}
        <main className="flex-1 overflow-auto bg-neutral-950 flex items-start justify-center p-6"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '24px 24px'
          }}
        >
          <div className="shadow-2xl shadow-black/60 ring-1 ring-neutral-800">
            <canvas
              ref={canvasRef}
              onMouseDown={handleDown}
              onMouseMove={handleMove}
              onMouseUp={handleUp}
              onMouseLeave={handleLeave}
              onContextMenu={e => e.preventDefault()}
              className="block cursor-crosshair"
              style={{ imageRendering: 'pixelated', maxWidth: '100%' }}
            />
          </div>
        </main>

        {/* Right panel */}
        <aside className="w-72 border-l border-neutral-800 bg-neutral-900/50 flex flex-col">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-4">
              {/* Selected tile */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">Текущий тайл</h3>
                <div className="flex items-center gap-3 p-2 rounded-lg bg-neutral-800/60">
                  <div className="w-10 h-10 rounded flex items-center justify-center text-lg font-bold border border-neutral-700"
                       style={{ background: TILE_MAP.get(selectedTile)?.color, color: '#000' }}>
                    {TILE_MAP.get(selectedTile)?.icon}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{TILE_MAP.get(selectedTile)?.name}</div>
                    <div className="text-xs text-neutral-400">
                      {TILE_MAP.get(selectedTile)?.walkable ? 'проходимо' : 'непроходимо'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Brush size */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs uppercase text-neutral-400">Размер кисти</Label>
                  <span className="text-xs text-amber-500 font-mono">{brushSize}×{brushSize}</span>
                </div>
                <Slider value={[brushSize]} min={1} max={5} step={1} onValueChange={v => setBrushSize(v[0])} />
              </div>

              <Separator className="bg-neutral-800" />

              {/* Tile palette */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">Палитра тайлов</h3>
                <div className="space-y-3">
                  {CATEGORIES.map(cat => (
                    <div key={cat}>
                      <div className="text-[10px] font-medium text-neutral-500 mb-1 px-1">{CATEGORY_LABELS[cat]}</div>
                      <div className="grid grid-cols-4 gap-1">
                        {TILES.filter(t => t.category === cat).map(t => (
                          <button
                            key={t.id}
                            onClick={() => setSelectedTile(t.id)}
                            title={t.name}
                            className={`aspect-square rounded flex items-center justify-center text-sm font-bold transition-all ${
                              selectedTile === t.id
                                ? 'ring-2 ring-amber-400 scale-105'
                                : 'ring-1 ring-neutral-700 hover:ring-neutral-500'
                            }`}
                            style={{ background: t.color, color: t.category === 'unit' ? '#000' : 'rgba(0,0,0,0.5)' }}
                          >
                            {t.icon}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Separator className="bg-neutral-800" />

              {/* Map size */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">Размер карты</h3>
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs mb-1"><span>Ширина</span><span className="text-amber-500">{gridW}</span></div>
                    <Slider value={[gridW]} min={16} max={96} step={4} onValueChange={v => resize(v[0], gridH)} />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1"><span>Высота</span><span className="text-amber-500">{gridH}</span></div>
                    <Slider value={[gridH]} min={16} max={96} step={4} onValueChange={v => resize(gridW, v[0])} />
                  </div>
                </div>
              </div>

              <Separator className="bg-neutral-800" />

              {/* Minimap */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2 flex items-center gap-1"><MapIcon className="w-3 h-3" /> Мини-карта</h3>
                <div className="bg-black rounded p-1 flex justify-center">
                  <canvas ref={miniRef} style={{ imageRendering: 'pixelated', maxWidth: '100%' }} />
                </div>
              </div>

              <Separator className="bg-neutral-800" />

              {/* Stats */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-400 mb-2">Статистика</h3>
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {stats.map(s => (
                    <div key={s.tile.id} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-sm" style={{ background: s.tile.color }} />
                        <span className="text-neutral-300">{s.tile.name}</span>
                      </div>
                      <span className="text-neutral-500 font-mono">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>

          {/* Footer status */}
          <div className="border-t border-neutral-800 p-2 text-[10px] text-neutral-500 space-y-0.5">
            <div className="flex justify-between"><span>Курсор:</span><span className="font-mono">{hoverCell ? `${hoverCell.x},${hoverCell.y}` : '—'}</span></div>
            <div className="flex justify-between"><span>История:</span><span className="font-mono">{history.length}/50</span></div>
            <div className="flex justify-between"><span>Тайлов:</span><span className="font-mono">{gridW * gridH}</span></div>
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="border-t border-neutral-800 bg-neutral-900 px-4 py-1.5 text-[11px] text-neutral-500 flex items-center gap-4 flex-wrap">
        <span>Горячие клавиши:</span>
        <kbd className="px-1 rounded bg-neutral-800">B</kbd>кисть
        <kbd className="px-1 rounded bg-neutral-800">E</kbd>ластик
        <kbd className="px-1 rounded bg-neutral-800">F</kbd>заливка
        <kbd className="px-1 rounded bg-neutral-800">R</kbd>прямоугольник
        <kbd className="px-1 rounded bg-neutral-800">H</kbd>панорама
        <kbd className="px-1 rounded bg-neutral-800">G</kbd>сетка
        <kbd className="px-1 rounded bg-neutral-800">Ctrl+Z/Y</kbd>отмена/повтор
        <kbd className="px-1 rounded bg-neutral-800">Ctrl+S</kbd>сохранить
      </footer>
    </div>
  )
}
