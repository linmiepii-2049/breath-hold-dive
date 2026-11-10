import { BALANCE } from './balance';
import { clamp } from './util';

export type BreathPhase = 'inhale' | 'hold' | 'exhale';

export interface BreathState {
  t: number;
  duration: number;
  beat: number;
  total: number;
  hits: number;
  resolved: boolean;
  beatIndex: number;
  flash: 'perfect' | 'good' | 'miss' | '';
  flashT: number;
  done: boolean;
  applied: boolean;
  accuracy: number;
  gain: number;
}

export interface ApneaState {
  t: number;
  duration: number;
  hr: number;
  line: number;
  under: number;
  spikeIn: number;
  done: boolean;
  applied: boolean;
  gain: number;
}

const BEAT = 1.92;
const PHASES: BreathPhase[] = ['inhale', 'hold', 'exhale'];

export function createBreath(): BreathState {
  return {
    t: 0,
    duration: BALANCE.breathSeconds,
    beat: BEAT,
    total: 0,
    hits: 0,
    resolved: false,
    beatIndex: -1,
    flash: '',
    flashT: 0,
    done: false,
    applied: false,
    accuracy: 0,
    gain: 0,
  };
}

export function createApnea(): ApneaState {
  return {
    t: 0,
    duration: BALANCE.apneaSeconds,
    hr: 66,
    line: 118,
    under: 0,
    spikeIn: 5.5,
    done: false,
    applied: false,
    gain: 0,
  };
}

export function breathPhase(state: BreathState): BreathPhase {
  const idx = Math.max(0, Math.floor(state.t / state.beat));
  return PHASES[idx % 3];
}

export function breathInto(state: BreathState): number {
  if (state.t < 0) return 0;
  return (state.t % state.beat) / state.beat;
}

export function stepBreath(state: BreathState, dt: number, pressed: ReadonlySet<string>, pad: BreathPhase | null): void {
  if (state.done) return;
  state.t += dt;
  state.flashT = Math.max(0, state.flashT - dt);
  const idx = Math.floor(state.t / state.beat);
  if (idx !== state.beatIndex && state.t < state.duration) {
    state.beatIndex = idx;
    state.resolved = false;
    state.total += 1;
  }
  const into = breathInto(state);
  const phase = breathPhase(state);
  if (!state.resolved && state.total > 0 && state.t < state.duration + 0.2) {
    const keyOk = phasePressed(phase, pressed) || pad === phase;
    const wrong = pressed.size > 0 && !keyOk && pad == null;
    if (keyOk || wrong || (pad && pad !== phase)) {
      const onBeat = into > 0.58 && into < 0.86;
      if (keyOk && onBeat) {
        const perfect = into > 0.66 && into < 0.8;
        state.hits += perfect ? 1 : 0.65;
        state.flash = perfect ? 'perfect' : 'good';
      } else {
        state.flash = 'miss';
      }
      state.flashT = 0.35;
      state.resolved = true;
    } else if (into > 0.92) {
      state.flash = 'miss';
      state.flashT = 0.28;
      state.resolved = true;
    }
  }
  if (state.t >= state.duration) finishBreath(state);
}

function phasePressed(phase: BreathPhase, pressed: ReadonlySet<string>): boolean {
  if (phase === 'inhale') return pressed.has('KeyJ') || pressed.has('ArrowUp');
  if (phase === 'hold') return pressed.has('KeyK') || pressed.has('Space');
  return pressed.has('KeyL') || pressed.has('ArrowDown');
}

function finishBreath(state: BreathState): void {
  state.done = true;
  state.accuracy = state.total > 0 ? state.hits / state.total : 0;
  state.gain = clamp(state.accuracy * BALANCE.breathGain, 0, BALANCE.breathGain);
}

export function forceFinishBreath(state: BreathState): void {
  if (!state.done) finishBreath(state);
}

export function forceFinishApnea(state: ApneaState): void {
  if (state.done) return;
  const denom = Math.max(6, state.t);
  state.gain = clamp(state.under / denom, 0, 1) * BALANCE.apneaGain;
  state.done = true;
}

export function stepApnea(state: ApneaState, dt: number, holding: boolean): void {
  if (state.done) return;
  state.t += dt;
  const tension = clamp(state.t / state.duration, 0, 1);
  const target = 64 + tension * 34;
  if (holding) {
    state.hr += (target - state.hr) * (1 - Math.exp(-2.6 * dt));
  } else {
    state.hr += (16 + tension * 26) * dt;
  }
  state.spikeIn -= dt;
  if (state.spikeIn <= 0) {
    state.hr += holding ? 16 + tension * 10 : 30 + tension * 14;
    state.spikeIn = 8.2 - tension * 3.2 + Math.random() * 1.6;
  }
  state.hr = clamp(state.hr, 52, 176);
  if (state.hr <= state.line) state.under += dt;
  if (state.t >= state.duration) {
    state.done = true;
    const score = clamp(state.under / state.duration, 0, 1);
    state.gain = score * BALANCE.apneaGain;
  }
}

export function breathKeys(phase: BreathPhase): string {
  if (phase === 'inhale') return 'train.key.inhale';
  if (phase === 'hold') return 'train.key.hold';
  return 'train.key.exhale';
}
