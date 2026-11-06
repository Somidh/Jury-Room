// The room's sound, synthesised so there are no files to load. Browsers only allow audio
// after a click, so it starts on the Begin button.

let context: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let pulse: ReturnType<typeof setInterval> | null = null;

const HEARTBEAT_MS = 1150;
const VOLUME = 0.9;

function noiseBuffer(audio: AudioContext): AudioBuffer {
  const buffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

/** A low room tone with the faint mains buzz of the overhead lamp. */
function startRoomTone(audio: AudioContext, output: AudioNode): void {
  const noise = audio.createBufferSource();
  noise.buffer = noiseBuffer(audio);
  noise.loop = true;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  const noiseLevel = audio.createGain();
  noiseLevel.gain.value = 0.05;
  noise.connect(filter).connect(noiseLevel).connect(output);
  noise.start();

  const buzz = audio.createOscillator();
  buzz.frequency.value = 100;
  const buzzLevel = audio.createGain();
  buzzLevel.gain.value = 0.006;
  buzz.connect(buzzLevel).connect(output);
  buzz.start();
}

function thump(frequency: number, level: number, length: number, delay = 0): void {
  if (!context || !master) return;
  const start = context.currentTime + delay;
  const tone = context.createOscillator();
  const gain = context.createGain();
  tone.frequency.setValueAtTime(frequency * 1.8, start);
  tone.frequency.exponentialRampToValueAtTime(frequency, start + 0.06);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  tone.connect(gain).connect(master);
  tone.start(start);
  tone.stop(start + length + 0.05);
}

export function startAudio(): void {
  if (context) return;
  const Audio = window.AudioContext;
  if (!Audio) return;
  context = new Audio();
  master = context.createGain();
  master.gain.value = muted ? 0 : VOLUME;
  master.connect(context.destination);
  startRoomTone(context, master);
}

/** Stops every sound where it is, and picks them all up again on resume. */
export function setFrozen(value: boolean): void {
  void (value ? context?.suspend() : context?.resume());
}

export function setMuted(value: boolean): void {
  muted = value;
  if (master) master.gain.value = value ? 0 : VOLUME;
}

/** A card turned over on wood. */
export function playFlip(): void {
  thump(120, 0.22, 0.16);
  thump(620, 0.03, 0.05);
}

/** A chair shifting, then the room catching its breath. */
export function playHandRaised(): void {
  thump(78, 0.34, 0.3);
  thump(210, 0.05, 0.12, 0.06);
}

export function setHeartbeat(on: boolean): void {
  if (pulse) clearInterval(pulse);
  pulse = null;
  if (!on) return;
  const beat = () => {
    thump(52, 0.3, 0.2);
    thump(46, 0.2, 0.22, 0.24);
  };
  beat();
  pulse = setInterval(beat, HEARTBEAT_MS);
}
