import {
  BREATH_WINDOW_START,
  breathInto,
  breathPhase,
  createBreath,
  stepBreath,
} from '../src/training.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const intro = createBreath();
for (let i = 0; i < 120; i++) stepBreath(intro, 1 / 60, new Set(['KeyJ']), new Set(['KeyJ']), null);
assert(intro.total === 0 && !intro.done, 'the lead-in is not scored');

const early = createBreath();
early.intro = 0;
let guard = 0;
while (breathInto(early) < 0.12 && guard++ < 400) stepBreath(early, 1 / 60, new Set(), new Set(), null);
stepBreath(early, 1 / 120, new Set(['KeyJ']), new Set(), null);
assert(!early.resolved && early.hits === 0, 'an early tap does not burn the beat');
while (breathPhase(early) === 'inhale' && breathInto(early) < 0.7 && guard++ < 2000) {
  stepBreath(early, 1 / 60, new Set(), new Set(), null);
}
assert(breathPhase(early) === 'inhale', 'still the inhale beat');
stepBreath(early, 1 / 120, new Set(['KeyJ']), new Set(['KeyJ']), null);
assert(early.hits > 0 && early.resolved, 'a tap inside the band scores');

const held = createBreath();
held.intro = 0;
const down = new Set(['KeyJ']);
let scoredAt = -1;
for (let i = 0; i < 200; i++) {
  const before = held.hits;
  stepBreath(held, 1 / 60, i === 0 ? new Set(['KeyJ']) : new Set(), down, null);
  if (held.hits > before) {
    scoredAt = breathInto(held);
    break;
  }
}
assert(scoredAt >= BREATH_WINDOW_START - 0.02, `holding scores in the band, got ${scoredAt}`);

console.log('training ok', { earlyHits: early.hits, heldAt: scoredAt });
