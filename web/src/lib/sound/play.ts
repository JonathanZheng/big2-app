import { type Sound, readSoundOn, saveSoundOn } from "./events";

/**
 * Sound effects, made with the Web Audio API so there are no files to load.
 * They match the table's motion: short, dry and hard. Clicks and slaps, no reverb.
 */

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
let on: boolean | null = null;

const listeners = new Set<() => void>();

export function soundOn(): boolean {
  on ??= readSoundOn();
  return on;
}

export function setSoundOn(next: boolean) {
  on = next;
  saveSoundOn(next);
  listeners.forEach((l) => l());
}

export function subscribeSound(onChange: () => void) {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

function context(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
  return ctx;
}

/** A pitched blip. `to` slides the pitch over the length of the note. */
function tone(c: AudioContext, at: number, o: { type: OscillatorType; from: number; to?: number; dur: number; gain: number }) {
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, at);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.dur);
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(o.gain, at + 0.003);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
  osc.connect(amp).connect(c.destination);
  osc.start(at);
  osc.stop(at + o.dur + 0.02);
}

/** A burst of filtered noise: the paper part of a card hitting the table. */
function noise(c: AudioContext, at: number, o: { freq: number; dur: number; gain: number }) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== c.sampleRate) {
    noiseBuffer = c.createBuffer(1, c.sampleRate / 2, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const amp = c.createGain();
  src.buffer = noiseBuffer;
  filter.type = "bandpass";
  filter.frequency.value = o.freq;
  filter.Q.value = 0.9;
  amp.gain.setValueAtTime(o.gain, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
  src.connect(filter).connect(amp).connect(c.destination);
  src.start(at);
  src.stop(at + o.dur + 0.02);
}

const VOICES: Record<Sound, (c: AudioContext, t: number) => void> = {
  select: (c, t) => tone(c, t, { type: "square", from: 1700, dur: 0.03, gain: 0.04 }),
  play: (c, t) => {
    noise(c, t, { freq: 2200, dur: 0.07, gain: 0.35 });
    tone(c, t, { type: "sine", from: 160, to: 60, dur: 0.09, gain: 0.3 });
  },
  bigPlay: (c, t) => {
    noise(c, t, { freq: 1800, dur: 0.11, gain: 0.45 });
    tone(c, t, { type: "sine", from: 120, to: 45, dur: 0.16, gain: 0.45 });
  },
  pass: (c, t) => tone(c, t, { type: "triangle", from: 300, to: 200, dur: 0.08, gain: 0.12 }),
  deal: (c, t) => {
    for (let i = 0; i < 6; i++) noise(c, t + i * 0.05, { freq: 2600, dur: 0.035, gain: 0.2 });
  },
  turn: (c, t) => {
    tone(c, t, { type: "square", from: 660, dur: 0.07, gain: 0.06 });
    tone(c, t + 0.08, { type: "square", from: 990, dur: 0.09, gain: 0.06 });
  },
  nope: (c, t) => tone(c, t, { type: "square", from: 150, to: 110, dur: 0.18, gain: 0.08 }),
  win: (c, t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.09, { type: "square", from: f, dur: i === 3 ? 0.3 : 0.1, gain: 0.07 }));
  },
  lose: (c, t) => {
    tone(c, t, { type: "triangle", from: 392, dur: 0.16, gain: 0.14 });
    tone(c, t + 0.18, { type: "triangle", from: 262, to: 240, dur: 0.32, gain: 0.14 });
  },
};

export function playSound(sound: Sound) {
  if (!soundOn()) return;
  const c = context();
  if (!c) return;
  try {
    VOICES[sound](c, c.currentTime + 0.005);
  } catch {
    // An audio failure must never break the game.
  }
}

// Mobile browsers only start audio inside a tap or key press. Wake the audio
// on the first one, so bot moves that follow are heard.
if (typeof window !== "undefined") {
  const unlock = () => {
    if (soundOn()) context();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}
