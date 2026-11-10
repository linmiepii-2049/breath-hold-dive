import { prizeForScore } from '../src/balance.ts';
import { scoreFrame, type FrameSubject } from '../src/scoring.ts';
import { depthMeters, terrainHeight } from '../src/terrain.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function subject(partial: Partial<FrameSubject> & Pick<FrameSubject, 'species' | 'rarity'>): FrameSubject {
  return {
    inFront: true,
    ndcX: 0.33,
    ndcY: -0.33,
    fill: 0.3,
    radiusNdcX: 0.16,
    radiusNdcY: 0.3,
    distance: 7,
    optimal: 7,
    moment: null,
    dangerous: false,
    ...partial,
  };
}

const empty = scoreFrame({ subjects: [], depth: 8, nearestPredator: 40 });
assert(empty.total === 0 && empty.comment === 'empty' && empty.prize === 0, 'empty frame');

const turtle = scoreFrame({
  subjects: [subject({ species: 'turtle', rarity: 16 })],
  depth: 8,
  nearestPredator: 30,
});
assert(turtle.composition >= 24, `turtle composition ${turtle.composition}`);
assert(turtle.rarity === 16, 'turtle rarity');
assert(turtle.moment === 0, 'turtle has no moment');
assert(turtle.total > 40 && turtle.total < 80, `turtle total ${turtle.total}`);

const turtleMoment = scoreFrame({
  subjects: [subject({ species: 'turtle', rarity: 16, moment: 'turtleBreath' })],
  depth: 2,
  nearestPredator: 40,
});
assert(turtleMoment.moment === 25, `moment points ${turtleMoment.moment}`);
assert(turtleMoment.total > turtle.total, 'moment should outscore the plain turtle');
assert(turtleMoment.comment === 'moment', turtleMoment.comment);

const orca = scoreFrame({
  subjects: [subject({ species: 'orca', rarity: 25, dangerous: true, distance: 12, optimal: 13, fill: 0.34, radiusNdcY: 0.34 })],
  depth: 30,
  nearestPredator: 5,
});
const clown = scoreFrame({
  subjects: [subject({ species: 'clownfish', rarity: 10, distance: 2.3, optimal: 2.3, fill: 0.3 })],
  depth: 6,
  nearestPredator: 40,
});
assert(orca.rarity > clown.rarity, 'orca rarer than clownfish');
assert(orca.distanceDanger > clown.distanceDanger, 'deep orca scores more danger');
assert(orca.total <= 100 && turtle.total <= 100, 'cap 100');

const off = scoreFrame({
  subjects: [subject({ species: 'shark', rarity: 20, ndcX: 1.4, dangerous: true })],
  depth: 12,
  nearestPredator: 4,
});
assert(off.total === 0, 'off-frame subject is ignored');

let prev = -1;
for (const s of [0, 20, 40, 60, 80, 100]) {
  const prize = prizeForScore(s);
  assert(prize >= prev, 'prize monotonic');
  prev = prize;
}
assert(prizeForScore(0) === 0, 'zero prize');
assert(prizeForScore(100) > prizeForScore(70), 'great shots pay more');

const entry = terrainHeight(0, 2.4);
const garden = terrainHeight(7, 18);
const trench = terrainHeight(20, 70);
assert(entry < -3, `entry too shallow ${entry}`);
assert(garden < -6 && garden > -20, `garden ${garden}`);
assert(trench < -28, `trench ${trench}`);
assert(Math.abs(depthMeters(-1.88) - 0.98) < 0.02, 'surface depth');

console.log('scoring ok', { turtle: turtle.total, moment: turtleMoment.total, orca: orca.total, clown: clown.total, trench, garden });
