// sound.ts — procedural sound effects + ambient music via Web Audio API.
// No audio files needed — all sounds are synthesized at runtime.
// This keeps the bundle tiny and avoids asset loading.

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let muted = false
let musicGain: GainNode | null = null
let musicNodes: OscillatorNode[] = []
let musicInterval: ReturnType<typeof setInterval> | null = null

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      masterGain = ctx.createGain()
      masterGain.gain.value = muted ? 0 : 0.3
      masterGain.connect(ctx.destination)
      musicGain = ctx.createGain()
      musicGain.gain.value = 0.15
      musicGain.connect(masterGain)
    } catch (e) {
      return null
    }
  }
  // Resume on first interaction (browsers suspend audio until user gesture)
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

export function setMuted(m: boolean) {
  muted = m
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(m ? 0 : 0.3, ctx.currentTime, 0.05)
  }
}

export function isMuted(): boolean {
  return muted
}

// ---- SFX primitives ----
function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slide?: number) {
  const c = ensureCtx()
  if (!c || !masterGain || muted) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, c.currentTime)
  if (slide !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), c.currentTime + dur)
  }
  gain.gain.setValueAtTime(vol, c.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur)
  osc.connect(gain)
  gain.connect(masterGain)
  osc.start()
  osc.stop(c.currentTime + dur)
}

function noise(dur: number, vol = 0.2, filterFreq = 1000) {
  const c = ensureCtx()
  if (!c || !masterGain || muted) return
  const bufferSize = c.sampleRate * dur
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
  }
  const src = c.createBufferSource()
  src.buffer = buffer
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = filterFreq
  const gain = c.createGain()
  gain.gain.value = vol
  src.connect(filter); filter.connect(gain); gain.connect(masterGain)
  src.start()
}

// ---- SFX library ----
export const SFX = {
  build: () => { tone(220, 0.15, 'square', 0.2, 440); setTimeout(() => tone(440, 0.1, 'square', 0.15), 80) },
  produce: () => { tone(330, 0.08, 'triangle', 0.2); setTimeout(() => tone(495, 0.1, 'triangle', 0.2), 60) },
  shoot: () => { tone(800, 0.05, 'sawtooth', 0.12, 200) },
  explosion: () => { noise(0.3, 0.3, 800); tone(80, 0.2, 'sawtooth', 0.2, 30) },
  harvest: () => { tone(150, 0.1, 'sine', 0.1, 180) },
  unload: () => { tone(400, 0.06, 'sine', 0.15); setTimeout(() => tone(500, 0.08, 'sine', 0.15), 50) },
  select: () => { tone(600, 0.04, 'sine', 0.1) },
  click: () => { tone(440, 0.03, 'square', 0.08) },
  warn: () => { tone(200, 0.2, 'sawtooth', 0.2, 150); setTimeout(() => tone(200, 0.2, 'sawtooth', 0.2, 150), 250) },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.25), i * 120)) },
  lose: () => { [400, 300, 200, 100].forEach((f, i) => setTimeout(() => tone(f, 0.4, 'sawtooth', 0.25), i * 150)) },
  shield: () => { tone(300, 0.3, 'sine', 0.2, 600); setTimeout(() => tone(600, 0.2, 'sine', 0.15), 100) },
  repair: () => { tone(1000, 0.04, 'sine', 0.06); setTimeout(() => tone(1200, 0.04, 'sine', 0.06), 50) },
}

// ---- Ambient music ----
// A slow, atmospheric drone with occasional melodic notes — fits the
// desert/post-apocalyptic DUSTWIND theme. Loops indefinitely.
const MUSIC_SCALE = [220, 261.63, 293.66, 329.63, 392, 440]  // A minor pentatonic-ish

export function startMusic() {
  const c = ensureCtx()
  if (!c || !musicGain || musicInterval) return
  // Base drone (two low oscillators)
  const drone1 = c.createOscillator()
  drone1.type = 'sine'
  drone1.frequency.value = 55  // A1
  const drone1Gain = c.createGain()
  drone1Gain.gain.value = 0.3
  drone1.connect(drone1Gain); drone1Gain.connect(musicGain)
  drone1.start()
  const drone2 = c.createOscillator()
  drone2.type = 'sine'
  drone2.frequency.value = 82.41  // E2
  const drone2Gain = c.createGain()
  drone2Gain.gain.value = 0.2
  drone2.connect(drone2Gain); drone2Gain.connect(musicGain)
  drone2.start()
  musicNodes = [drone1, drone2]
  // Occasional melodic notes
  musicInterval = setInterval(() => {
    if (muted) return
    const c2 = ensureCtx()
    if (!c2 || !musicGain) return
    if (Math.random() < 0.4) {
      const freq = MUSIC_SCALE[Math.floor(Math.random() * MUSIC_SCALE.length)]
      const osc = c2.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq
      const g = c2.createGain()
      g.gain.setValueAtTime(0, c2.currentTime)
      g.gain.linearRampToValueAtTime(0.15, c2.currentTime + 0.5)
      g.gain.exponentialRampToValueAtTime(0.001, c2.currentTime + 2.5)
      osc.connect(g); g.connect(musicGain)
      osc.start()
      osc.stop(c2.currentTime + 2.5)
    }
  }, 2500)
}

export function stopMusic() {
  if (musicInterval) { clearInterval(musicInterval); musicInterval = null }
  for (const n of musicNodes) { try { n.stop() } catch (e) {} }
  musicNodes = []
}
