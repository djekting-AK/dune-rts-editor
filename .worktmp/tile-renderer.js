// src/lib/tile-renderer.ts
var TILE_SIZE = 40;
var TERRAIN = {
  0: { id: 0, name: "Пустота", category: "terrain", walkable: false, buildable: false },
  1: { id: 1, name: "Песок", category: "terrain", walkable: true, buildable: true },
  2: { id: 2, name: "Дюны", category: "terrain", walkable: true, buildable: true },
  3: { id: 3, name: "Скала", category: "terrain", walkable: false, buildable: true },
  4: { id: 4, name: "Горы", category: "terrain", walkable: false, buildable: false },
  5: { id: 5, name: "Спайс", category: "terrain", walkable: true, buildable: false },
  6: { id: 6, name: "Богатый спайс", category: "terrain", walkable: true, buildable: false },
  7: { id: 7, name: "Вода", category: "terrain", walkable: false, buildable: false }
};
function hash(x, y, seed = 0) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647 | 0;
  h = (h ^ h >>> 13) * 1274126177;
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}
function mulberry(seed) {
  let a = seed | 0;
  return () => {
    a = a + 1831565813 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 429496296;
  };
}
function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}
function rrect(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const fade = (t) => t * t * (3 - 2 * t);
  const u = fade(xf), v = fade(yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, octaves = 3) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0;i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}
var sandBaseCache = new Map;
var terrainBaseCache = new Map;
function clearTerrainCache() {
  terrainBaseCache.clear();
  sandBaseCache.clear();
}
function getTerrainBase(terrain, mapW, mapH, version) {
  const key = `${mapW}x${mapH}-v${version}`;
  let c = terrainBaseCache.get(key);
  if (c)
    return c;
  const scale = 2;
  const w = Math.ceil(mapW * TILE_SIZE / scale);
  const h = Math.ceil(mapH * TILE_SIZE / scale);
  c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const typeColor = (t, wx, wy) => {
    if (t === 0)
      return [8, 6, 4];
    if (t === 1 || t === 2 || t === 5 || t === 6) {
      const n = fbm(wx * 0.35, wy * 0.35, 4);
      const n2 = fbm(wx * 1.2 + 100, wy * 1.2 + 100, 2);
      const tn = Math.max(0, Math.min(1, n / 0.7));
      const tn2 = Math.max(0, Math.min(1, n2 / 0.6));
      let r = 195 + tn * 45 + (tn2 - 0.5) * 12;
      let g = 145 + tn * 38 + (tn2 - 0.5) * 10;
      let b = 68 + tn * 27 + (tn2 - 0.5) * 6;
      if (t === 5) {
        r = r * 0.7 + 232 * 0.3;
        g = g * 0.7 + 93 * 0.3;
        b = b * 0.7 + 47 * 0.3;
      } else if (t === 6) {
        r = r * 0.6 + 200 * 0.4;
        g = g * 0.6 + 60 * 0.4;
        b = b * 0.6 + 30 * 0.4;
      }
      if (t === 2) {
        r *= 0.88;
        g *= 0.86;
        b *= 0.82;
      }
      return [r, g, b];
    }
    if (t === 3) {
      const n = fbm(wx * 0.3, wy * 0.3, 4);
      const n2 = fbm(wx * 1.5 + 50, wy * 1.5 + 50, 2);
      const tn = n / 0.7;
      const tn2 = (n2 - 0.5) * 20;
      return [118 + tn * 32 + tn2, 113 + tn * 30 + tn2, 103 + tn * 26 + tn2];
    }
    if (t === 4) {
      const n = fbm(wx * 0.3, wy * 0.3, 4);
      return [82 + n * 25, 75 + n * 22, 65 + n * 18];
    }
    if (t === 7) {
      const n = fbm(wx * 0.4, wy * 0.4, 3);
      return [40 + n * 30, 120 + n * 40, 170 + n * 40];
    }
    return [8, 6, 4];
  };
  const typeAt = (wx, wy) => {
    const tx = Math.floor(wx), ty = Math.floor(wy);
    return tx >= 0 && ty >= 0 && tx < mapW && ty < mapH ? terrain[ty * mapW + tx] : 0;
  };
  for (let y = 0;y < h; y++) {
    for (let x = 0;x < w; x++) {
      const wx = x * scale / TILE_SIZE;
      const wy = y * scale / TILE_SIZE;
      const i = (y * w + x) * 4;
      const t0 = typeAt(wx, wy);
      const offsets = [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]];
      let r = 0, g = 0, b = 0, total = 0;
      const [cr, cg, cb] = typeColor(t0, wx, wy);
      r += cr;
      g += cg;
      b += cb;
      total += 1;
      for (const [dx, dy] of offsets) {
        const tn = typeAt(wx + dx, wy + dy);
        if (tn !== t0) {
          const [nr, ng, nb] = typeColor(tn, wx + dx, wy + dy);
          r += nr * 0.3;
          g += ng * 0.3;
          b += nb * 0.3;
          total += 0.3;
        }
      }
      r /= total;
      g /= total;
      b /= total;
      data[i] = Math.max(0, Math.min(255, Math.round(r)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  terrainBaseCache.set(key, c);
  for (const k of terrainBaseCache.keys()) {
    if (k !== key)
      terrainBaseCache.delete(k);
  }
  return c;
}
function drawSeamlessTile(ctx, tileId, gx, gy, animPhase) {
  const s = TILE_SIZE;
  const ox = gx * s, oy = gy * s;
  ctx.save();
  ctx.translate(ox, oy);
  if (tileId === 0) {
    ctx.fillStyle = "#080604";
    ctx.fillRect(0, 0, s, s);
  } else if (tileId === 1) {
    const rng = mulberry(gx * 73856093 ^ gy * 19349663);
    ctx.fillStyle = "rgba(120,70,20,0.06)";
    for (let i = 0;i < 4; i++)
      ctx.fillRect(rng() * s, rng() * s, 1, 1);
  } else if (tileId === 2) {
    const rng = mulberry(gx * 73856093 ^ gy * 19349663);
    ctx.fillStyle = "rgba(120,70,20,0.06)";
    for (let i = 0;i < 4; i++)
      ctx.fillRect(rng() * s, rng() * s, 1, 1);
    ctx.strokeStyle = "rgba(120,75,20,0.4)";
    ctx.lineWidth = 1.5;
    for (let i = 0;i < 3; i++) {
      const yo = i * (s / 3) + 5;
      ctx.beginPath();
      ctx.moveTo(-1, yo);
      for (let x = 0;x <= s; x += 3) {
        const wy = yo + Math.sin((gx * s + x) * 0.13 + gy * 0.6) * 3;
        ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,225,150,0.32)";
    ctx.lineWidth = 1;
    for (let i = 0;i < 3; i++) {
      const yo = i * (s / 3) + 3.5;
      ctx.beginPath();
      ctx.moveTo(-1, yo);
      for (let x = 0;x <= s; x += 3) {
        const wy = yo + Math.sin((gx * s + x) * 0.13 + gy * 0.6) * 3;
        ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }
  } else if (tileId === 3) {
    const n = fbm(gx * 0.2, gy * 0.2, 3);
    const t = n / 0.7;
    const r = Math.round(118 + t * 32);
    const g = Math.round(113 + t * 30);
    const b = Math.round(103 + t * 26);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, s, s);
    const rng = mulberry(gx * 12345 ^ gy * 54321);
    ctx.fillStyle = "rgba(50,45,35,0.45)";
    for (let i = 0;i < 4; i++) {
      ctx.fillRect(rng() * s, rng() * s, 2 + rng() * 4, 1);
    }
    ctx.fillStyle = "rgba(180,175,165,0.35)";
    for (let i = 0;i < 5; i++)
      ctx.fillRect(rng() * s, rng() * s, 1, 1);
  } else if (tileId === 4) {
    const n = fbm(gx * 0.2, gy * 0.2, 3);
    ctx.fillStyle = `rgb(${82 + n * 22},${75 + n * 20},${65 + n * 16})`;
    ctx.fillRect(0, 0, s, s);
    const peakGrad = ctx.createRadialGradient(s / 2, s * 0.6, 2, s / 2, s * 0.6, s * 0.55);
    peakGrad.addColorStop(0, "#9a8e7e");
    peakGrad.addColorStop(0.5, "#6a5e50");
    peakGrad.addColorStop(1, "rgba(58,50,40,0)");
    ctx.fillStyle = peakGrad;
    ctx.fillRect(0, 0, s, s);
    const snow = ctx.createRadialGradient(s / 2, s * 0.25, 1, s / 2, s * 0.25, s * 0.2);
    snow.addColorStop(0, "rgba(245,245,250,0.95)");
    snow.addColorStop(1, "rgba(245,245,250,0)");
    ctx.fillStyle = snow;
    ctx.fillRect(0, 0, s, s);
  } else if (tileId === 5 || tileId === 6) {
    const rich = tileId === 6;
    ctx.fillStyle = rich ? "rgba(200,60,30,0.22)" : "rgba(232,93,47,0.16)";
    ctx.fillRect(0, 0, s, s);
    const rng = mulberry(gx * 3333 ^ gy * 7777);
    const count = rich ? 5 : 4;
    for (let i = 0;i < count; i++) {
      const cx = 4 + rng() * (s - 8), cy = 4 + rng() * (s - 8);
      const rad = 4 + rng() * 4;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      glow.addColorStop(0, rich ? "rgba(255,100,50,0.85)" : "rgba(255,140,70,0.7)");
      glow.addColorStop(0.5, rich ? "rgba(220,60,30,0.5)" : "rgba(232,93,47,0.4)");
      glow.addColorStop(1, "rgba(232,93,47,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      ctx.fillStyle = rich ? "#ff7050" : "#ff9060";
      ctx.fillRect(cx - 1, cy - 1, 2, 2);
    }
  } else if (tileId === 7) {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, "#3aa0c8");
    g.addColorStop(1, "#1a5e80");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(150,220,240,0.4)";
    ctx.lineWidth = 1;
    const phase = animPhase * 0.6;
    for (let i = 0;i < 4; i++) {
      const yo = (i * (s / 4) + phase) % s;
      ctx.beginPath();
      ctx.moveTo(-1, yo);
      for (let x = 0;x <= s; x += 3) {
        const wy = yo + Math.sin((gx * s + x) * 0.2 + phase) * 1.2;
        ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }
    const rng = mulberry(gx * 999 ^ gy * 111);
    ctx.fillStyle = "rgba(220,245,255,0.6)";
    ctx.fillRect((phase * 3 + rng() * s) % s, 3, 2, 1);
  }
  ctx.restore();
}
function drawTerrainLayer(ctx, terrain, w, h, animPhase, version = 0) {
  const base = getTerrainBase(terrain, w, h, version);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(base, 0, 0, w * TILE_SIZE, h * TILE_SIZE);
  for (let y = 0;y < h; y++) {
    for (let x = 0;x < w; x++) {
      const t = terrain[y * w + x];
      if (t === 2) {
        drawDuneRipples(ctx, x, y);
      } else if (t === 5 || t === 6) {
        drawSpiceGlow(ctx, x, y, t === 6);
      } else if (t === 7) {
        drawWaterAnim(ctx, x, y, animPhase);
      } else if (t === 4) {
        drawMountainPeak(ctx, x, y);
      }
    }
  }
}
function drawDuneRipples(ctx, gx, gy) {
  const s = TILE_SIZE;
  ctx.save();
  ctx.translate(gx * s, gy * s);
  ctx.strokeStyle = "rgba(120,75,20,0.3)";
  ctx.lineWidth = 1.5;
  for (let i = 0;i < 4; i++) {
    const yo = (gy * s + i * 10 + 5) % s;
    ctx.beginPath();
    ctx.moveTo(-1, yo);
    for (let x = 0;x <= s; x += 3) {
      const wy = yo + Math.sin((gx * s + x) * 0.13 + gy * 0.6) * 3;
      ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,225,150,0.2)";
  ctx.lineWidth = 1;
  for (let i = 0;i < 4; i++) {
    const yo = (gy * s + i * 10 + 3) % s;
    ctx.beginPath();
    ctx.moveTo(-1, yo);
    for (let x = 0;x <= s; x += 3) {
      const wy = yo + Math.sin((gx * s + x) * 0.13 + gy * 0.6) * 3;
      ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }
  ctx.restore();
}
function drawSpiceGlow(ctx, gx, gy, rich) {
  const s = TILE_SIZE;
  ctx.save();
  ctx.translate(gx * s, gy * s);
  ctx.fillStyle = rich ? "rgba(200,50,20,0.4)" : "rgba(232,93,47,0.3)";
  ctx.fillRect(0, 0, s, s);
  const rng = mulberry(gx * 3333 ^ gy * 7777);
  const count = rich ? 3 : 2;
  for (let i = 0;i < count; i++) {
    const cx = 6 + rng() * (s - 12), cy = 6 + rng() * (s - 12);
    const rad = 5 + rng() * 3;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    glow.addColorStop(0, rich ? "rgba(255,120,60,0.8)" : "rgba(255,150,80,0.65)");
    glow.addColorStop(1, "rgba(232,93,47,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  ctx.fillStyle = rich ? "#ffb070" : "#ffd090";
  for (let i = 0;i < 3; i++) {
    ctx.fillRect(4 + rng() * (s - 8), 4 + rng() * (s - 8), 1, 1);
  }
  ctx.restore();
}
function drawWaterAnim(ctx, gx, gy, animPhase) {
  const s = TILE_SIZE;
  ctx.save();
  ctx.translate(gx * s, gy * s);
  ctx.strokeStyle = "rgba(150,220,240,0.3)";
  ctx.lineWidth = 1;
  const phase = animPhase * 0.6;
  for (let i = 0;i < 3; i++) {
    const yo = (i * (s / 3) + phase) % s;
    ctx.beginPath();
    ctx.moveTo(-1, yo);
    for (let x = 0;x <= s; x += 3) {
      const wy = yo + Math.sin((gx * s + x) * 0.2 + phase) * 1.2;
      ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }
  ctx.restore();
}
function drawMountainPeak(ctx, gx, gy) {
  const s = TILE_SIZE;
  ctx.save();
  ctx.translate(gx * s, gy * s);
  const peakGrad = ctx.createRadialGradient(s / 2, s * 0.6, 2, s / 2, s * 0.6, s * 0.5);
  peakGrad.addColorStop(0, "rgba(154,142,126,0.5)");
  peakGrad.addColorStop(0.5, "rgba(106,94,80,0.3)");
  peakGrad.addColorStop(1, "rgba(58,50,40,0)");
  ctx.fillStyle = peakGrad;
  ctx.fillRect(0, 0, s, s);
  const snow = ctx.createRadialGradient(s / 2, s * 0.25, 1, s / 2, s * 0.25, s * 0.18);
  snow.addColorStop(0, "rgba(245,245,250,0.7)");
  snow.addColorStop(1, "rgba(245,245,250,0)");
  ctx.fillStyle = snow;
  ctx.fillRect(0, 0, s, s);
  ctx.restore();
}
function drawTerrain(ctx, tileId, gx, gy, animPhase = 0, _terrain, _w, _h) {
  drawSeamlessTile(ctx, tileId, gx, gy, animPhase);
}
function getTerrainTile(tileId, _variant = 0) {
  const c = document.createElement("canvas");
  c.width = TILE_SIZE;
  c.height = TILE_SIZE;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  if (tileId !== 0) {
    ctx.fillStyle = "#d4a040";
    ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  }
  drawSeamlessTile(ctx, tileId, 0, 0, 0);
  return c;
}
var FACTION_COLORS = {
  atreides: { primary: "#2e6fd0", light: "#5a9dee", dark: "#1a4a90", flag: "#4a8fd8", trim: "#88c0ff" },
  harkonnen: { primary: "#8a2098", light: "#b84cc0", dark: "#5a1068", flag: "#a840b8", trim: "#d070e0" },
  ordos: { primary: "#1a9e4d", light: "#40c870", dark: "#0d6a2e", flag: "#22c55e", trim: "#60e090" },
  neutral: { primary: "#9a8a6a", light: "#c0b08a", dark: "#6a5a3a", flag: "#b8a878", trim: "#d0c098" }
};
var buildingCache = new Map;
var DIM_W = 40;
var DIM_H = 20;
var TOP_PAD = 18;
function getWallH(type) {
  switch (type) {
    case "palace":
      return 50;
    case "barracks":
      return 35;
    case "factory":
      return 45;
    case "refinery":
      return 40;
    case "generator":
      return 42;
    case "turret":
      return 20;
  }
}
function buildingGeometry(w, h, wallH) {
  const dw = (w + h) * DIM_W / 4;
  const dh = (w + h) * DIM_H / 4;
  const CW = (w + h) * DIM_W / 2 + DIM_W;
  const CH = (w + h) * DIM_H / 2 + wallH + DIM_H + TOP_PAD;
  const cx = CW / 2;
  const cy = CH - dh;
  const roofCx = cx;
  const roofCy = cy - wallH;
  return { dw, dh, CW, CH, cx, cy, roofCx, roofCy, wallH };
}
function diamondPath(ctx, cx, cy, dw, dh) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - dh);
  ctx.lineTo(cx + dw, cy);
  ctx.lineTo(cx, cy + dh);
  ctx.lineTo(cx - dw, cy);
  ctx.closePath();
}
function wallFacePath(ctx, cx, cy, dw, dh, wallH, edge) {
  ctx.beginPath();
  if (edge === "right") {
    ctx.moveTo(cx, cy + dh);
    ctx.lineTo(cx + dw, cy);
    ctx.lineTo(cx + dw, cy - wallH);
    ctx.lineTo(cx, cy + dh - wallH);
  } else {
    ctx.moveTo(cx, cy + dh);
    ctx.lineTo(cx - dw, cy);
    ctx.lineTo(cx - dw, cy - wallH);
    ctx.lineTo(cx, cy + dh - wallH);
  }
  ctx.closePath();
}
function wallQuadPath(ctx, cx, cy, dw, dh, wallH, edge, u1, v1, u2, v2) {
  const s = edge === "right" ? 1 : -1;
  const X = (u) => cx + s * u * dw;
  const Y = (u, v) => cy + dh - u * dh - v * wallH;
  ctx.beginPath();
  ctx.moveTo(X(u1), Y(u1, v1));
  ctx.lineTo(X(u2), Y(u2, v1));
  ctx.lineTo(X(u2), Y(u2, v2));
  ctx.lineTo(X(u1), Y(u1, v2));
  ctx.closePath();
}
function wallQuadFill(ctx, cx, cy, dw, dh, wallH, edge, u1, v1, u2, v2, color) {
  wallQuadPath(ctx, cx, cy, dw, dh, wallH, edge, u1, v1, u2, v2);
  ctx.fillStyle = color;
  ctx.fill();
}
function renderBuilding(type, faction, w, h) {
  const key = `${type}_${faction}_${w}x${h}`;
  let c = buildingCache.get(key);
  if (c)
    return c;
  c = document.createElement("canvas");
  const wallH = getWallH(type);
  const geo = buildingGeometry(w, h, wallH);
  const { dw, dh, CW, CH, cx, cy, roofCx, roofCy } = geo;
  c.width = CW;
  c.height = CH;
  const ctx = c.getContext("2d");
  const col = FACTION_COLORS[faction];
  const rng = mulberry(type.charCodeAt(0) * 7919 ^ faction.charCodeAt(0) * 4099 ^ w * 131 ^ h * 257);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  diamondPath(ctx, cx + 4, cy + 3, dw + 3, dh + 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  diamondPath(ctx, cx + 7, cy + 5, dw + 1, dh + 1);
  ctx.fill();
  wallFacePath(ctx, cx, cy, dw, dh, wallH, "right");
  const rightGrad = ctx.createLinearGradient(0, cy - wallH, 0, cy + dh);
  rightGrad.addColorStop(0, "#3a3a3a");
  rightGrad.addColorStop(1, "#1f1f1f");
  ctx.fillStyle = rightGrad;
  ctx.fill();
  wallFacePath(ctx, cx, cy, dw, dh, wallH, "left");
  const leftGrad = ctx.createLinearGradient(0, cy - wallH, 0, cy + dh);
  leftGrad.addColorStop(0, "#7a7a7a");
  leftGrad.addColorStop(1, "#3a3a3a");
  ctx.fillStyle = leftGrad;
  ctx.fill();
  diamondPath(ctx, roofCx, roofCy, dw, dh);
  const roofGrad = ctx.createLinearGradient(0, roofCy - dh, 0, roofCy + dh);
  roofGrad.addColorStop(0, "#9a9a9a");
  roofGrad.addColorStop(1, "#5a5a5a");
  ctx.fillStyle = roofGrad;
  ctx.fill();
  ctx.strokeStyle = "#a8a8a8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(roofCx - dw, roofCy);
  ctx.lineTo(roofCx, roofCy - dh);
  ctx.lineTo(roofCx + dw, roofCy);
  ctx.stroke();
  if (type === "palace") {
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0, 0.88, 1, 1.04, "#2a2a2a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0, 0.88, 1, 1.04, "#3a3a3a");
    for (let i = 0;i < 6; i++) {
      const u = 0.05 + i * 0.16;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", u, 1, u + 0.06, 1.05, "#0a0a0a");
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u, 1, u + 0.06, 1.05, "#0a0a0a");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.34, 0.04, 0.66, 0.62, "#0f0f0f");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.34, 0.04, 0.66, 0.07, "#3a3a3a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.34, 0.6, 0.66, 0.62, "#3a3a3a");
    for (let i = 0;i < 4; i++) {
      const su = 0.34 + i * 0.08;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", su, 0.3, su + 0.04, 0.36, i % 2 === 0 ? "#ffcc00" : "#1a1a1a");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.49, 0.07, 0.51, 0.6, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.3, 0.3, 0.33, 0.34, col.primary);
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.67, 0.3, 0.7, 0.34, col.primary);
    for (const row of [0.2, 0.45]) {
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.08, row, 0.2, row + 0.05, "#00d0ff");
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.8, row, 0.92, row + 0.05, "#00d0ff");
    }
    for (let i = 1;i < 4; i++) {
      const u = i / 4;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u - 0.005, 0.05, u + 0.005, 0.85, "#1a1a1a");
    }
    for (const row of [0.18, 0.4, 0.62]) {
      for (let i = 0;i < 3; i++) {
        const u = 0.1 + i * 0.27;
        wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u, row, u + 0.14, row + 0.05, "#00d0ff");
      }
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.46, 0.05, 0.54, 0.85, col.dark);
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.48, 0.05, 0.52, 0.85, col.primary);
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0, 0.78, 1, 0.8, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0, 0.78, 1, 0.8, "#1a1a1a");
    const corners = [
      [roofCx - dw + 4, roofCy],
      [roofCx + dw - 4, roofCy],
      [roofCx, roofCy - dh + 3],
      [roofCx, roofCy + dh - 3]
    ];
    for (const [tx2, ty2] of corners) {
      diamondPath(ctx, tx2, ty2, 5, 2.5);
      ctx.fillStyle = "#2a2a2a";
      ctx.fill();
      diamondPath(ctx, tx2, ty2, 3, 1.5);
      ctx.fillStyle = "#5a5a5a";
      ctx.fill();
    }
    diamondPath(ctx, roofCx, roofCy, dw * 0.55, dh * 0.55);
    ctx.fillStyle = "rgba(0, 208, 255, 0.15)";
    ctx.fill();
    ctx.strokeStyle = "#00d0ff";
    ctx.lineWidth = 1;
    ctx.stroke();
    const poleH = 16;
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(roofCx, roofCy);
    ctx.lineTo(roofCx, roofCy - poleH);
    ctx.stroke();
    ctx.fillStyle = col.primary;
    ctx.beginPath();
    ctx.moveTo(roofCx, roofCy - poleH);
    ctx.lineTo(roofCx + 11, roofCy - poleH + 3);
    ctx.lineTo(roofCx, roofCy - poleH + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = col.trim;
    ctx.fillRect(roofCx, roofCy - poleH, 1, 6);
    ctx.fillStyle = "#ffaa30";
    ctx.beginPath();
    ctx.arc(roofCx, roofCy - poleH - 1, 1.5, 0, Math.PI * 2);
    ctx.fill();
    const antX = roofCx;
    const antY = roofCy - dh;
    const antH = 16;
    ctx.strokeStyle = "#5a5a5a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(antX, antY);
    ctx.lineTo(antX, antY - antH);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = 0;i < 2; i++) {
      const yy = antY - 5 - i * 5;
      ctx.beginPath();
      ctx.moveTo(antX - 4, yy);
      ctx.lineTo(antX + 4, yy);
      ctx.stroke();
    }
    const tipGrad = ctx.createRadialGradient(antX, antY - antH, 0, antX, antY - antH, 6);
    tipGrad.addColorStop(0, "#e0f8ff");
    tipGrad.addColorStop(0.4, "#00d0ff");
    tipGrad.addColorStop(1, "rgba(0,208,255,0)");
    ctx.fillStyle = tipGrad;
    ctx.fillRect(antX - 6, antY - antH - 6, 12, 12);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(antX, antY - antH, 1.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "barracks") {
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.28, 0.05, 0.72, 0.6, "#0f0f0f");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.28, 0.05, 0.72, 0.08, "#3a3a3a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.49, 0.08, 0.51, 0.6, "#1a1a1a");
    for (let i = 0;i < 5; i++) {
      const su = 0.28 + i * 0.09;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", su, 0.54, su + 0.045, 0.6, i % 2 === 0 ? "#ffcc00" : "#1a1a1a");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.4, 0.32, 0.42, 0.36, "#5a5a5a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.58, 0.32, 0.6, 0.36, "#5a5a5a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.34, 0.72, 0.46, 0.78, "#00d0ff");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.54, 0.72, 0.66, 0.78, "#00d0ff");
    for (let i = 1;i < 3; i++) {
      const u = i / 3;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u - 0.005, 0.05, u + 0.005, 0.85, "#1a1a1a");
    }
    for (const row of [0.25, 0.55]) {
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.1, row, 0.25, row + 0.06, "#00d0ff");
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.4, row, 0.55, row + 0.06, "#00d0ff");
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.7, row, 0.85, row + 0.06, "#00d0ff");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0, 0.86, 1, 0.92, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0, 0.86, 1, 0.92, "#1a1a1a");
    for (let i = 0;i < 8; i++) {
      const u = i * 0.125;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", u, 0.86, u + 0.06, 0.92, "#ffcc00");
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u, 0.86, u + 0.06, 0.92, "#ffcc00");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0, 0.8, 1, 0.83, col.primary);
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0, 0.8, 1, 0.83, col.primary);
    const antX = roofCx;
    const antY = roofCy - dh;
    const antH = 26;
    ctx.strokeStyle = "#5a5a5a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(antX, antY);
    ctx.lineTo(antX, antY - antH);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = 0;i < 2; i++) {
      const yy = antY - 7 - i * 7;
      ctx.beginPath();
      ctx.moveTo(antX - 4, yy);
      ctx.lineTo(antX + 4, yy);
      ctx.stroke();
    }
    const beaconGrad = ctx.createRadialGradient(antX, antY - antH, 0, antX, antY - antH, 5);
    beaconGrad.addColorStop(0, "#ffe0e0");
    beaconGrad.addColorStop(0.4, "#ff3030");
    beaconGrad.addColorStop(1, "rgba(255,48,48,0)");
    ctx.fillStyle = beaconGrad;
    ctx.fillRect(antX - 5, antY - antH - 5, 10, 10);
    ctx.fillStyle = "#ff5050";
    ctx.beginPath();
    ctx.arc(antX, antY - antH, 1.5, 0, Math.PI * 2);
    ctx.fill();
    for (const offX of [-12, 12]) {
      const px2 = roofCx + offX;
      const py2 = roofCy - 2;
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(px2 - 2, py2 - 8, 4, 10);
      ctx.fillStyle = "#5a5a5a";
      ctx.fillRect(px2 - 2, py2 - 8, 4, 2);
      ctx.fillStyle = "#00d0ff";
      ctx.fillRect(px2 - 1, py2 - 7, 2, 1);
    }
  } else if (type === "factory") {
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.2, 0.05, 0.8, 0.65, "#1a1a1a");
    for (let i = 0;i < 5; i++) {
      const v = 0.05 + i * 0.12;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.2, v + 0.1, 0.8, v + 0.12, "#3a3a3a");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.4, 0.05, 0.42, 0.65, "#0a0a0a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.6, 0.05, 0.62, 0.65, "#0a0a0a");
    for (let i = 0;i < 6; i++) {
      const su = 0.2 + i * 0.1;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", su, 0.6, su + 0.05, 0.65, i % 2 === 0 ? "#ffcc00" : "#1a1a1a");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.32, 0.74, 0.68, 0.84, "#00d0ff");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.49, 0.74, 0.51, 0.84, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.1, 0.55, 0.4, 0.72, "#00d0ff");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.23, 0.55, 0.25, 0.72, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.1, 0.62, 0.4, 0.64, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.55, 0.55, 0.85, 0.72, "#00d0ff");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.69, 0.55, 0.71, 0.72, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.55, 0.62, 0.85, 0.64, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.04, 0.05, 0.08, 0.85, "#4a4a4a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.05, 0.05, 0.06, 0.85, "#6a6a6a");
    const vX = cx - 0.06 * dw;
    const vY = cy + dh - 0.06 * dh - 0.4 * wallH;
    ctx.fillStyle = "#5a5a5a";
    ctx.beginPath();
    ctx.arc(vX, vY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 0.5;
    for (let i = 0;i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(vX, vY);
      ctx.lineTo(vX + Math.cos(a) * 3, vY + Math.sin(a) * 3);
      ctx.stroke();
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0, 0.88, 1, 0.94, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0, 0.88, 1, 0.94, "#1a1a1a");
    const stripCount = 4;
    for (let i = 0;i < stripCount; i++) {
      const u0 = i / stripCount;
      const u1 = (i + 1) / stripCount;
      const lx0 = roofCx - dw + u0 * 2 * dw;
      const lx1 = roofCx - dw + u1 * 2 * dw;
      const halfW = (lx1 - lx0) / 2;
      const cxStrip = (lx0 + lx1) / 2;
      ctx.fillStyle = i % 2 === 0 ? "#3a3a3a" : "#6a6a6a";
      ctx.beginPath();
      ctx.moveTo(cxStrip - halfW, roofCy);
      ctx.lineTo(cxStrip, roofCy - dh);
      ctx.lineTo(cxStrip + halfW, roofCy);
      ctx.lineTo(cxStrip, roofCy + dh);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cxStrip, roofCy - dh);
      ctx.lineTo(cxStrip, roofCy + dh);
      ctx.stroke();
      ctx.fillStyle = "rgba(0, 208, 255, 0.35)";
      ctx.beginPath();
      ctx.moveTo(cxStrip - halfW * 0.7, roofCy - dh * 0.3);
      ctx.lineTo(cxStrip, roofCy - dh);
      ctx.lineTo(cxStrip + halfW * 0.7, roofCy - dh * 0.3);
      ctx.lineTo(cxStrip, roofCy - dh * 0.4);
      ctx.closePath();
      ctx.fill();
    }
    for (const offX of [-dw * 0.4, dw * 0.4]) {
      const chX = roofCx + offX;
      const chY = roofCy - dh * 0.5;
      const chH = 18;
      const cg = ctx.createLinearGradient(chX - 4, 0, chX + 4, 0);
      cg.addColorStop(0, "#3a3a3a");
      cg.addColorStop(0.5, "#6a6a6a");
      cg.addColorStop(1, "#2a2a2a");
      ctx.fillStyle = cg;
      ctx.fillRect(chX - 4, chY - chH, 8, chH);
      ctx.fillStyle = "#5a5a5a";
      ctx.fillRect(chX - 5, chY - chH - 2, 10, 3);
      const heatG = ctx.createRadialGradient(chX, chY - chH, 0, chX, chY - chH, 5);
      heatG.addColorStop(0, "rgba(255, 130, 50, 0.7)");
      heatG.addColorStop(1, "rgba(255, 130, 50, 0)");
      ctx.fillStyle = heatG;
      ctx.fillRect(chX - 5, chY - chH - 5, 10, 8);
      ctx.fillStyle = "rgba(180, 180, 180, 0.55)";
      for (let i = 0;i < 2; i++) {
        const smY = chY - chH - 6 - i * 4;
        const smX = chX + (i - 0.5) * 2;
        ctx.beginPath();
        ctx.arc(smX, smY, 2 + i * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (type === "refinery") {
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.38, 0.05, 0.62, 0.45, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.49, 0.05, 0.51, 0.45, "#0a0a0a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.38, 0.43, 0.62, 0.45, "#3a3a3a");
    for (let i = 0;i < 4; i++) {
      const su = 0.38 + i * 0.06;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", su, 0.4, su + 0.03, 0.43, i % 2 === 0 ? "#ffcc00" : "#1a1a1a");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.1, 0.55, 0.3, 0.75, "#3a1a08");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.12, 0.57, 0.28, 0.73, "#ff8030");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.14, 0.58, 0.26, 0.6, "#ffc080");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.7, 0.55, 0.9, 0.75, "#3a1a08");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.72, 0.57, 0.88, 0.73, "#ff8030");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.74, 0.58, 0.86, 0.6, "#ffc080");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.05, 0.83, 0.95, 0.87, "#4a4a4a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.05, 0.83, 0.95, 0.84, "#6a6a6a");
    for (const u of [0.15, 0.5, 0.85]) {
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u - 0.025, 0.05, u + 0.025, 0.85, "#4a4a4a");
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u - 0.005, 0.05, u + 0.005, 0.85, "#6a6a6a");
    }
    for (const u of [0.15, 0.5, 0.85]) {
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u - 0.035, 0.3, u + 0.035, 0.34, "#3a3a3a");
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u - 0.035, 0.6, u + 0.035, 0.64, "#3a3a3a");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.3, 0.45, 0.42, 0.65, "#3a1a08");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.32, 0.47, 0.4, 0.63, "#ff8030");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.58, 0.45, 0.7, 0.65, "#3a1a08");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.6, 0.47, 0.68, 0.63, "#ff8030");
    ctx.fillStyle = "rgba(255, 128, 48, 0.4)";
    diamondPath(ctx, cx + 5, cy + dh - 1, dw * 0.4, dh * 0.3);
    ctx.fill();
    const vx = cx + 0.55 * dw;
    const vy = cy + dh - 0.55 * dh - 0.85 * wallH;
    ctx.fillStyle = "#5a5a5a";
    ctx.beginPath();
    ctx.arc(vx, vy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 0.5;
    for (let i = 0;i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(vx + Math.cos(a) * 3, vy + Math.sin(a) * 3);
      ctx.stroke();
    }
    ctx.fillStyle = "#ff8030";
    ctx.beginPath();
    ctx.arc(vx, vy, 1, 0, Math.PI * 2);
    ctx.fill();
    const tankR = Math.min(dw, dh * 2) * 0.55;
    ctx.fillStyle = "#3a3a3a";
    ctx.beginPath();
    ctx.ellipse(roofCx, roofCy, tankR, tankR * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const tankG = ctx.createRadialGradient(roofCx, roofCy, 0, roofCx, roofCy, tankR);
    tankG.addColorStop(0, "#ffc080");
    tankG.addColorStop(0.4, "#ff8030");
    tankG.addColorStop(0.8, "#a04010");
    tankG.addColorStop(1, "#3a1a08");
    ctx.fillStyle = tankG;
    ctx.beginPath();
    ctx.ellipse(roofCx, roofCy, tankR * 0.85, tankR * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#6a6a6a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(roofCx, roofCy, tankR * 0.85, tankR * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(roofCx, roofCy, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff8030";
    ctx.beginPath();
    ctx.arc(roofCx, roofCy, 1, 0, Math.PI * 2);
    ctx.fill();
    for (const offX of [-dw * 0.6, dw * 0.6]) {
      const tx2 = roofCx + offX;
      const ty2 = roofCy + dh * 0.2;
      ctx.fillStyle = "#3a3a3a";
      ctx.beginPath();
      ctx.ellipse(tx2, ty2, tankR * 0.35, tankR * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      const sg = ctx.createRadialGradient(tx2, ty2, 0, tx2, ty2, tankR * 0.35);
      sg.addColorStop(0, "#ffa050");
      sg.addColorStop(0.7, "#a04010");
      sg.addColorStop(1, "#3a1a08");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.ellipse(tx2, ty2, tankR * 0.28, tankR * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#5a5a5a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(roofCx - tankR * 0.85, roofCy);
    ctx.lineTo(roofCx - dw * 0.6 + tankR * 0.28, roofCy + dh * 0.2);
    ctx.moveTo(roofCx + tankR * 0.85, roofCy);
    ctx.lineTo(roofCx + dw * 0.6 - tankR * 0.28, roofCy + dh * 0.2);
    ctx.stroke();
  } else if (type === "generator") {
    for (let i = 0;i < 6; i++) {
      const u = 0.08 + i * 0.15;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", u - 0.015, 0.05, u + 0.015, 0.75, "#2a2a2a");
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", u - 0.005, 0.05, u + 0.005, 0.75, "#4a4a4a");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.05, 0.82, 0.95, 0.85, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.05, 0.88, 0.95, 0.91, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.05, 0.83, 0.95, 0.84, "rgba(0,208,255,0.4)");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.05, 0.89, 0.95, 0.9, "rgba(0,208,255,0.4)");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.35, 0.5, 0.65, 0.6, "#0a0a0a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.4, 0.53, 0.45, 0.55, "#00d0ff");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.55, 0.53, 0.6, 0.55, "#ffaa30");
    for (let i = 0;i < 6; i++) {
      const u = 0.08 + i * 0.15;
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u - 0.015, 0.05, u + 0.015, 0.75, "#2a2a2a");
      wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", u - 0.005, 0.05, u + 0.005, 0.75, "#4a4a4a");
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.05, 0.82, 0.95, 0.85, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.05, 0.83, 0.95, 0.84, "rgba(0,208,255,0.4)");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.35, 0.5, 0.65, 0.6, "#0a0a0a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.4, 0.53, 0.45, 0.55, "#00d0ff");
    for (let i = 0;i < 5; i++) {
      const u = 0.1 + i * 0.2;
      const rX = cx + u * dw;
      const rY = cy + dh - u * dh - 0.96 * wallH;
      const lg = ctx.createRadialGradient(rX, rY, 0, rX, rY, 3);
      lg.addColorStop(0, "#c0f4ff");
      lg.addColorStop(0.5, "#00d0ff");
      lg.addColorStop(1, "rgba(0,208,255,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(rX - 3, rY - 3, 6, 6);
      const lX = cx - u * dw;
      const lY = cy + dh - u * dh - 0.96 * wallH;
      const lg2 = ctx.createRadialGradient(lX, lY, 0, lX, lY, 3);
      lg2.addColorStop(0, "#c0f4ff");
      lg2.addColorStop(0.5, "#00d0ff");
      lg2.addColorStop(1, "rgba(0,208,255,0)");
      ctx.fillStyle = lg2;
      ctx.fillRect(lX - 3, lY - 3, 6, 6);
    }
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0, 0.76, 1, 0.78, col.dark);
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0, 0.76, 1, 0.78, col.dark);
    const coreR = Math.min(dw, dh * 2) * 0.55;
    const haloG = ctx.createRadialGradient(roofCx, roofCy, 0, roofCx, roofCy, coreR * 1.4);
    haloG.addColorStop(0, "rgba(0, 208, 255, 0.6)");
    haloG.addColorStop(0.5, "rgba(0, 208, 255, 0.25)");
    haloG.addColorStop(1, "rgba(0, 208, 255, 0)");
    ctx.fillStyle = haloG;
    ctx.fillRect(roofCx - coreR * 1.4, roofCy - coreR * 0.8, coreR * 2.8, coreR * 1.6);
    ctx.fillStyle = "#3a3a3a";
    ctx.beginPath();
    ctx.ellipse(roofCx, roofCy, coreR, coreR * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0;i < 8; i++) {
      const a = i * Math.PI / 4;
      const bx = roofCx + Math.cos(a) * coreR * 0.9;
      const by = roofCy + Math.sin(a) * coreR * 0.45;
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.arc(bx, by, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    const plasmaG = ctx.createRadialGradient(roofCx, roofCy, 0, roofCx, roofCy, coreR * 0.7);
    plasmaG.addColorStop(0, "#ffffff");
    plasmaG.addColorStop(0.3, "#c0f4ff");
    plasmaG.addColorStop(0.6, "#00d0ff");
    plasmaG.addColorStop(1, "#003a5a");
    ctx.fillStyle = plasmaG;
    ctx.beginPath();
    ctx.ellipse(roofCx, roofCy, coreR * 0.7, coreR * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(roofCx - coreR * 0.7, roofCy);
    ctx.lineTo(roofCx + coreR * 0.7, roofCy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(roofCx, roofCy - coreR * 0.35);
    ctx.lineTo(roofCx, roofCy + coreR * 0.35);
    ctx.stroke();
    ctx.strokeStyle = "#c0f4ff";
    ctx.lineWidth = 1;
    for (let i = 0;i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const ex = roofCx + Math.cos(a) * coreR * 1.3;
      const ey = roofCy + Math.sin(a) * coreR * 0.65;
      const mx = roofCx + Math.cos(a) * coreR * 0.7 + (rng() - 0.5) * 4;
      const my = roofCy + Math.sin(a) * coreR * 0.35 + (rng() - 0.5) * 4;
      ctx.beginPath();
      ctx.moveTo(roofCx, roofCy);
      ctx.lineTo(mx, my);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.strokeStyle = "#5a5a5a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(roofCx, roofCy - dh * 0.5);
    ctx.lineTo(roofCx, roofCy - dh * 0.5 - 10);
    ctx.stroke();
    ctx.fillStyle = "#d0d0d0";
    ctx.fillRect(roofCx - 2, roofCy - dh * 0.5 - 3, 4, 2);
    ctx.fillRect(roofCx - 2, roofCy - dh * 0.5 - 7, 4, 2);
    const tipG = ctx.createRadialGradient(roofCx, roofCy - dh * 0.5 - 10, 0, roofCx, roofCy - dh * 0.5 - 10, 4);
    tipG.addColorStop(0, "#ffffff");
    tipG.addColorStop(0.5, "#00d0ff");
    tipG.addColorStop(1, "rgba(0,208,255,0)");
    ctx.fillStyle = tipG;
    ctx.fillRect(roofCx - 4, roofCy - dh * 0.5 - 14, 8, 8);
  } else if (type === "turret") {
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.35, 0.4, 0.65, 0.5, "#00d0ff");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.2, 0.05, 0.22, 0.85, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "right", 0.78, 0.05, 0.8, 0.85, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.35, 0.4, 0.65, 0.5, "#00d0ff");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.2, 0.05, 0.22, 0.85, "#1a1a1a");
    wallQuadFill(ctx, cx, cy, dw, dh, wallH, "left", 0.78, 0.05, 0.8, 0.85, "#1a1a1a");
    const fX1 = cx + 0.5 * dw;
    const fY1 = cy + dh - 0.5 * dh - 0.15 * wallH;
    ctx.fillStyle = col.primary;
    ctx.beginPath();
    ctx.arc(fX1, fY1, 1.5, 0, Math.PI * 2);
    ctx.fill();
    const fX2 = cx - 0.5 * dw;
    const fY2 = cy + dh - 0.5 * dh - 0.15 * wallH;
    ctx.beginPath();
    ctx.arc(fX2, fY2, 1.5, 0, Math.PI * 2);
    ctx.fill();
    diamondPath(ctx, roofCx, roofCy, dw * 0.7, dh * 0.7);
    ctx.fillStyle = "#2a2a2a";
    ctx.fill();
    diamondPath(ctx, roofCx, roofCy, dw * 0.6, dh * 0.6);
    ctx.fillStyle = "#4a4a4a";
    ctx.fill();
    const rivets = [
      [roofCx - dw * 0.6, roofCy],
      [roofCx + dw * 0.6, roofCy],
      [roofCx, roofCy - dh * 0.6],
      [roofCx, roofCy + dh * 0.6]
    ];
    for (const [rx, ry] of rivets) {
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.arc(rx, ry, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    const cellG = ctx.createRadialGradient(roofCx, roofCy, 0, roofCx, roofCy, 4);
    cellG.addColorStop(0, "#ffffff");
    cellG.addColorStop(0.5, "#00d0ff");
    cellG.addColorStop(1, "rgba(0,208,255,0)");
    ctx.fillStyle = cellG;
    ctx.fillRect(roofCx - 4, roofCy - 4, 8, 8);
    const barrelLen = 12;
    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(roofCx - 2, roofCy - barrelLen, 4, barrelLen);
    ctx.fillStyle = "#5a5a5a";
    ctx.fillRect(roofCx - 1, roofCy - barrelLen, 1, barrelLen);
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(roofCx - 3, roofCy - 4, 6, 4);
    ctx.fillStyle = "#4a4a4a";
    ctx.fillRect(roofCx - 2, roofCy - 3, 4, 2);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(roofCx - 3, roofCy - barrelLen - 2, 6, 2);
    const muzG = ctx.createRadialGradient(roofCx, roofCy - barrelLen - 1, 0, roofCx, roofCy - barrelLen - 1, 4);
    muzG.addColorStop(0, "#ffffff");
    muzG.addColorStop(0.4, "#00d0ff");
    muzG.addColorStop(1, "rgba(0,208,255,0)");
    ctx.fillStyle = muzG;
    ctx.fillRect(roofCx - 4, roofCy - barrelLen - 5, 8, 8);
    for (const offX of [-3, 3]) {
      ctx.fillStyle = "#ffaa30";
      ctx.beginPath();
      ctx.arc(roofCx + offX, roofCy + 2, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 1;
  wallFacePath(ctx, cx, cy, dw, dh, wallH, "right");
  ctx.stroke();
  wallFacePath(ctx, cx, cy, dw, dh, wallH, "left");
  ctx.stroke();
  diamondPath(ctx, roofCx, roofCy, dw, dh);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - dw, cy);
  ctx.lineTo(cx, cy + dh);
  ctx.lineTo(cx + dw, cy);
  ctx.stroke();
  buildingCache.set(key, c);
  return c;
}
function drawBuilding(ctx, type, faction, px_, py_, w = 1, h = 1) {
  const img = renderBuilding(type, faction, w, h);
  const drawX = px_ + (w * TILE_SIZE - img.width) / 2;
  const drawY = py_ + h * TILE_SIZE - img.height;
  ctx.drawImage(img, drawX, drawY);
}
var unitCache = new Map;
var unitDirCache = new Map;
function renderUnit(type, faction) {
  const key = `${type}_${faction}`;
  let c = unitCache.get(key);
  if (c)
    return c;
  c = document.createElement("canvas");
  c.width = TILE_SIZE;
  c.height = TILE_SIZE;
  const ctx = c.getContext("2d");
  const col = FACTION_COLORS[faction];
  const s = TILE_SIZE;
  const cx = s / 2;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(cx, s - 6, 9, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (type === "harvester") {
    rrect(ctx, 5, s - 11, 28, 5, 2, "#2a2a2a");
    for (let i = 0;i < 6; i++)
      px(ctx, 7 + i * 5, s - 10, 3, 3, "#4a4a4a");
    rrect(ctx, 6, s - 20, 26, 9, 2, col.dark);
    rrect(ctx, 6, s - 20, 26, 2, col.primary);
    px(ctx, 7, s - 19, 24, 1, col.light);
    rrect(ctx, 18, s - 26, 12, 7, 1, col.primary);
    px(ctx, 18, s - 26, 12, 1, col.light);
    rrect(ctx, 21, s - 24, 7, 4, 1, "#7ac0ff");
    px(ctx, 21, s - 24, 7, 1, "#a8d8ff");
    rrect(ctx, 2, s - 17, 5, 6, 1, "#5a5a5a");
    px(ctx, 1, s - 16, 2, 4, "#3a3a3a");
    px(ctx, 2, s - 13, 5, 1, "#6a6a6a");
    rrect(ctx, 10, s - 16, 6, 2, 1, "#e85d2f");
    px(ctx, 10, s - 16, 6, 1, "#ff9060");
    px(ctx, 30, s - 25, 2, 2, "#4a4a4a");
    px(ctx, 31, s - 27, 1, 2, "rgba(150,150,150,0.6)");
  } else if (type === "soldier") {
    px(ctx, cx - 3, s - 10, 2, 4, col.dark);
    px(ctx, cx + 1, s - 10, 2, 4, col.dark);
    px(ctx, cx - 3, s - 6, 2, 1, "#1a1a1a");
    px(ctx, cx + 1, s - 6, 2, 1, "#1a1a1a");
    rrect(ctx, cx - 3, s - 18, 6, 8, 1, col.primary);
    px(ctx, cx - 3, s - 18, 6, 1, col.light);
    px(ctx, cx - 3, s - 13, 6, 1, col.trim);
    px(ctx, cx - 3, s - 12, 6, 1, col.dark);
    rrect(ctx, cx - 2, s - 22, 4, 4, 1, "#d4a878");
    px(ctx, cx - 2, s - 22, 4, 1, "#b88860");
    rrect(ctx, cx - 3, s - 23, 6, 2, 1, col.dark);
    px(ctx, cx - 3, s - 23, 6, 1, col.primary);
    px(ctx, cx + 3, s - 16, 7, 1, "#2a2a2a");
    px(ctx, cx + 9, s - 17, 1, 2, "#2a2a2a");
    px(ctx, cx + 2, s - 15, 1, 2, "#4a4a4a");
    px(ctx, cx - 5, s - 17, 2, 4, col.dark);
  } else if (type === "tank") {
    rrect(ctx, 4, s - 12, 30, 6, 2, "#2a2a2a");
    for (let i = 0;i < 6; i++)
      px(ctx, 5 + i * 5, s - 11, 3, 4, "#4a4a4a");
    rrect(ctx, 5, s - 22, 28, 10, 2, col.dark);
    rrect(ctx, 5, s - 22, 28, 2, col.primary);
    px(ctx, 6, s - 21, 26, 1, col.light);
    rrect(ctx, cx - 6, s - 30, 14, 9, 2, col.primary);
    px(ctx, cx - 6, s - 30, 14, 1, col.light);
    px(ctx, cx - 6, s - 22, 14, 1, col.dark);
    px(ctx, cx + 6, s - 27, 10, 2, "#2a2a2a");
    px(ctx, cx + 15, s - 28, 2, 1, "#1a1a1a");
    px(ctx, cx + 14, s - 28, 3, 4, "#3a3a3a");
    rrect(ctx, cx - 2, s - 29, 4, 2, 1, col.flag);
    px(ctx, 7, s - 14, 3, 2, col.trim);
    px(ctx, s - 10, s - 14, 3, 2, col.trim);
  }
  unitCache.set(key, c);
  return c;
}
function renderUnitDirection(type, faction, dir) {
  const key = `${type}_${faction}_${dir}`;
  let c = unitDirCache.get(key);
  if (c)
    return c;
  const base = renderUnit(type, faction);
  c = document.createElement("canvas");
  c.width = TILE_SIZE;
  c.height = TILE_SIZE;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.translate(TILE_SIZE / 2, TILE_SIZE / 2);
  ctx.rotate(dir * Math.PI / 4);
  ctx.drawImage(base, -TILE_SIZE / 2, -TILE_SIZE / 2);
  unitDirCache.set(key, c);
  return c;
}
function drawUnit(ctx, type, faction, px_, py_, bob = 0, facing = 0) {
  if (type === "soldier") {
    const img = renderUnit(type, faction);
    ctx.drawImage(img, px_ - TILE_SIZE / 2, py_ - TILE_SIZE / 2 + bob);
  } else {
    let angle = facing;
    while (angle < 0)
      angle += Math.PI * 2;
    while (angle >= Math.PI * 2)
      angle -= Math.PI * 2;
    const dir = Math.round(angle / (Math.PI / 4)) % 8;
    const img = renderUnitDirection(type, faction, dir);
    ctx.drawImage(img, px_ - TILE_SIZE / 2, py_ - TILE_SIZE / 2 + bob);
  }
}
var wormCache = null;
function renderWorm() {
  if (wormCache)
    return wormCache;
  const c = document.createElement("canvas");
  c.width = TILE_SIZE;
  c.height = TILE_SIZE;
  const ctx = c.getContext("2d");
  const s = TILE_SIZE;
  const cx = s / 2, cy = s / 2;
  ctx.fillStyle = "rgba(60,30,5,0.45)";
  ctx.beginPath();
  ctx.ellipse(cx, s - 5, 15, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7a3a10";
  ctx.beginPath();
  ctx.moveTo(2, cy + 1);
  ctx.quadraticCurveTo(cx - 8, cy - 3, cx - 4, cy);
  ctx.lineTo(cx - 4, cy + 6);
  ctx.quadraticCurveTo(cx - 8, cy + 7, 2, cy + 7);
  ctx.fill();
  const segments = [
    { x: cx - 8, y: cy, r: 5, shade: "#8b4513" },
    { x: cx - 4, y: cy - 1, r: 6, shade: "#9a5018" },
    { x: cx, y: cy - 2, r: 7, shade: "#a85820" },
    { x: cx + 4, y: cy - 1, r: 7, shade: "#9a5018" }
  ];
  for (const seg of segments) {
    ctx.fillStyle = seg.shade;
    ctx.beginPath();
    ctx.ellipse(seg.x, seg.y + 3, seg.r, seg.r - 1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#5a2810";
  ctx.lineWidth = 1;
  for (let i = -2;i <= 2; i++) {
    const x = cx + i * 4;
    ctx.beginPath();
    ctx.moveTo(x, cy - 3);
    ctx.quadraticCurveTo(x - 1, cy + 3, x, cy + 7);
    ctx.stroke();
  }
  ctx.fillStyle = "#c07030";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 1, 10, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e09040";
  ctx.beginPath();
  ctx.ellipse(cx - 2, cy - 2, 6, 1, 0, 0, Math.PI * 2);
  ctx.fill();
  const mouthX = cx + 7, mouthY = cy + 2;
  ctx.fillStyle = "#3a1008";
  ctx.beginPath();
  ctx.ellipse(mouthX, mouthY, 5, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  const mouthGrad = ctx.createRadialGradient(mouthX, mouthY, 0, mouthX, mouthY, 4);
  mouthGrad.addColorStop(0, "#ff4020");
  mouthGrad.addColorStop(0.5, "#a02010");
  mouthGrad.addColorStop(1, "#3a1008");
  ctx.fillStyle = mouthGrad;
  ctx.beginPath();
  ctx.ellipse(mouthX, mouthY, 3.5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff8e0";
  for (let i = 0;i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const tx = mouthX + Math.cos(a) * 4;
    const ty = mouthY + Math.sin(a) * 3;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(mouthX + Math.cos(a) * 2.5, mouthY + Math.sin(a) * 1.8);
    ctx.lineTo(mouthX + Math.cos(a + 0.4) * 4, mouthY + Math.sin(a + 0.4) * 3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "rgba(200,150,70,0.6)";
  for (let i = 0;i < 6; i++) {
    const px2 = 3 + Math.random() * 6;
    const py2 = s - 8 + Math.random() * 5;
    ctx.fillRect(px2, py2, 1, 1);
  }
  for (let i = 0;i < 4; i++) {
    const px2 = s - 8 + Math.random() * 6;
    const py2 = s - 8 + Math.random() * 5;
    ctx.fillRect(px2, py2, 1, 1);
  }
  wormCache = c;
  return c;
}
function drawWorm(ctx, px_, py_, angle = 0) {
  const img = renderWorm();
  ctx.save();
  ctx.translate(px_, py_);
  ctx.rotate(angle);
  ctx.drawImage(img, -TILE_SIZE / 2, -TILE_SIZE / 2);
  ctx.restore();
}
function drawHealthBar(ctx, x, y, w, ratio) {
  const h = 4;
  const bx = x - w / 2;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  rrect(ctx, bx - 1, y - 1, w + 2, h + 2, 1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(bx, y, w, h);
  const fillW = Math.max(0, Math.min(w, w * ratio));
  ctx.fillStyle = ratio > 0.5 ? "#22c55e" : ratio > 0.25 ? "#eab308" : "#ef4444";
  ctx.fillRect(bx, y, fillW, h);
  px(ctx, bx, y, fillW, 1, "rgba(255,255,255,0.3)");
}
function drawSelectionRing(ctx, px_, py_, color = "#4ade80") {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(px_, py_ + 5, TILE_SIZE / 2 - 3, TILE_SIZE / 2 - 6, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  const r = TILE_SIZE / 2 - 2;
  ctx.beginPath();
  ctx.moveTo(px_ - r, py_ - r + 3);
  ctx.lineTo(px_ - r, py_ - r);
  ctx.lineTo(px_ - r + 3, py_ - r);
  ctx.moveTo(px_ + r, py_ - r + 3);
  ctx.lineTo(px_ + r, py_ - r);
  ctx.lineTo(px_ + r - 3, py_ - r);
  ctx.moveTo(px_ - r, py_ + r - 3);
  ctx.lineTo(px_ - r, py_ + r);
  ctx.lineTo(px_ - r + 3, py_ + r);
  ctx.moveTo(px_ + r, py_ + r - 3);
  ctx.lineTo(px_ + r, py_ + r);
  ctx.lineTo(px_ + r - 3, py_ + r);
  ctx.stroke();
}
function drawMoveMarker(ctx, gx, gy, color = "#4ade80") {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(gx * TILE_SIZE + 3, gy * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6);
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(gx * TILE_SIZE + TILE_SIZE / 2, gy * TILE_SIZE + TILE_SIZE / 2, 2, 0, Math.PI * 2);
  ctx.fill();
}
function getTilePreview(tileId, size = 40) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  const scale = size / TILE_SIZE;
  ctx.scale(scale, scale);
  drawSeamlessTile(ctx, tileId, 0, 0, 0);
  return c.toDataURL();
}
function getBuildingPreview(type, faction, size = 40, w = 1, h = 1) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const img = renderBuilding(type, faction, w, h);
  const scale = size / Math.max(img.width, img.height);
  ctx.scale(scale, scale);
  const drawX = (size / scale - img.width) / 2;
  const drawY = (size / scale - img.height) / 2;
  ctx.drawImage(img, drawX, drawY);
  return c.toDataURL();
}
function getUnitPreview(type, faction, size = 40) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const scale = size / TILE_SIZE;
  ctx.scale(scale, scale);
  const img = renderUnit(type, faction);
  ctx.drawImage(img, 0, 0);
  return c.toDataURL();
}
function drawProjectile(ctx, x, y, sx, sy, color) {
  const dx = x - sx, dy = y - sy;
  const d = Math.hypot(dx, dy) || 1;
  const trailLen = Math.min(8, d);
  const tx = x - dx / d * trailLen;
  const ty = y - dy / d * trailLen;
  const grad = ctx.createLinearGradient(tx, ty, x, y);
  grad.addColorStop(0, "rgba(255,200,100,0)");
  grad.addColorStop(1, color);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;
}
function drawExplosion(ctx, x, y, frame, maxFrame, size, color) {
  const t = frame / maxFrame;
  const r = (1 - Math.abs(t - 0.3)) * 8 * size;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r + 4);
  grad.addColorStop(0, `rgba(255,240,180,${1 - t})`);
  grad.addColorStop(0.3, color);
  grad.addColorStop(0.7, `rgba(180,60,20,${0.7 * (1 - t)})`);
  grad.addColorStop(1, "rgba(80,20,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(x - r - 4, y - r - 4, (r + 4) * 2, (r + 4) * 2);
  if (t < 0.4) {
    ctx.fillStyle = `rgba(255,255,255,${0.9 - t * 2})`;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (t < 0.6) {
    ctx.fillStyle = "#ffe080";
    for (let i = 0;i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + frame * 0.1;
      const sr = r * 0.8;
      ctx.fillRect(x + Math.cos(a) * sr, y + Math.sin(a) * sr, 1, 1);
    }
  }
}
function drawMuzzleFlash(ctx, x, y, frame) {
  const r = 4 - frame;
  if (r <= 0)
    return;
  ctx.fillStyle = `rgba(255,240,150,${0.8 - frame * 0.2})`;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255,180,60,${0.5 - frame * 0.15})`;
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fill();
}
function drawRangeIndicator(ctx, x, y, range, color = "#4ade80") {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.arc(x, y, range * TILE_SIZE, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]);
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(x, y, range * TILE_SIZE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
function drawFogOfWar(ctx, explored, visible, w, h) {
  for (let y = 0;y < h; y++) {
    for (let x = 0;x < w; x++) {
      const i = y * w + x;
      if (visible[i])
        continue;
      const ox = x * TILE_SIZE, oy = y * TILE_SIZE;
      if (explored[i]) {
        ctx.fillStyle = "rgba(10,8,4,0.55)";
        ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);
      } else {
        ctx.fillStyle = "rgba(5,4,2,0.92)";
        ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);
        if ((x * 7 + y * 13) % 5 === 0) {
          ctx.fillStyle = "rgba(20,15,5,0.5)";
          ctx.fillRect(ox + x % 3 * 8, oy + y % 4 * 7, 3, 3);
        }
      }
    }
  }
}
function drawEnergyIcon(ctx, x, y, size = 12, color = "#ffe060") {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(size * 0.55, 0);
  ctx.lineTo(size * 0.15, size * 0.55);
  ctx.lineTo(size * 0.45, size * 0.55);
  ctx.lineTo(size * 0.35, size);
  ctx.lineTo(size * 0.85, size * 0.4);
  ctx.lineTo(size * 0.55, size * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
export {
  getUnitPreview,
  getTilePreview,
  getTerrainTile,
  getBuildingPreview,
  drawWorm,
  drawUnit,
  drawTerrainLayer,
  drawTerrain,
  drawSelectionRing,
  drawRangeIndicator,
  drawProjectile,
  drawMuzzleFlash,
  drawMoveMarker,
  drawHealthBar,
  drawFogOfWar,
  drawExplosion,
  drawEnergyIcon,
  drawBuilding,
  clearTerrainCache,
  TILE_SIZE,
  TERRAIN,
  FACTION_COLORS
};
