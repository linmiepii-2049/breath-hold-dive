import { BALANCE, buoyancyAccel, headAtSurface, prizeForScore } from '../src/balance.ts';
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
    clarity: 1,
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

for (const shot of [empty, turtle, turtleMoment, orca, clown, off]) {
  const sum = shot.composition + shot.rarity + shot.moment + shot.distanceDanger;
  assert(sum === shot.total, `categories ${sum} != total ${shot.total}`);
}

const shark = subject({
  species: 'shark',
  rarity: 20,
  dangerous: true,
  fill: 0.34,
  radiusNdcY: 0.34,
  ndcX: 0.1,
  ndcY: -0.1,
});
const speck = subject({
  species: 'orca',
  rarity: 25,
  dangerous: true,
  moment: 'orcaPass',
  fill: 0.07,
  radiusNdcX: 0.04,
  radiusNdcY: 0.07,
  ndcX: 0.55,
  ndcY: -0.4,
  distance: 36,
  optimal: 13,
});
const missed = scoreFrame({ subjects: [shark, speck], depth: 14, nearestPredator: 9 });
assert(missed.species === 'shark', `speck shot subject ${missed.species}`);
assert(missed.moment === 0 && missed.momentId === null, 'distant orca is not a special moment');
assert(missed.composition + missed.rarity + missed.moment + missed.distanceDanger === missed.total, 'speck sum');

const visibleOrca = subject({
  species: 'orca',
  rarity: 25,
  dangerous: true,
  moment: 'orcaPass',
  fill: 0.3,
  radiusNdcX: 0.16,
  radiusNdcY: 0.3,
  ndcX: -0.2,
  ndcY: 0.05,
  distance: 12,
  optimal: 13,
});
const passing = scoreFrame({ subjects: [shark, visibleOrca], depth: 28, nearestPredator: 6 });
assert(passing.momentId === 'orcaPass' && passing.moment === 25, `visible pass ${passing.momentId} ${passing.moment}`);
assert(passing.composition + passing.rarity + passing.moment + passing.distanceDanger === passing.total, 'pass sum');

const quietOrca = scoreFrame({
  subjects: [subject({ species: 'orca', rarity: 25, dangerous: true, moment: null, fill: 0.3, radiusNdcY: 0.3 })],
  depth: 28,
  nearestPredator: 8,
});
assert(quietOrca.momentId === null && quietOrca.moment === 0, 'orca without the pass is not the moment');

const hazy = scoreFrame({
  subjects: [
    subject({
      species: 'orca',
      rarity: 25,
      dangerous: true,
      moment: 'orcaPass',
      fill: 0.32,
      radiusNdcY: 0.32,
      clarity: 0.35,
      ndcX: 0.1,
      ndcY: 0.05,
    }),
  ],
  depth: 30,
  nearestPredator: 8,
});
assert(hazy.moment === 0 && hazy.momentId === null, 'a hazy orca does not score the moment');
assert(hazy.rarity < 15, `hazy orca rarity ${hazy.rarity}`);
assert(hazy.composition + hazy.rarity + hazy.moment + hazy.distanceDanger === hazy.total, 'hazy sum');

const blocked = scoreFrame({
  subjects: [subject({ species: 'octopus', rarity: 25, fill: 0.32, clarity: 0.2, ndcX: 0.2, ndcY: -0.1 })],
  depth: 10,
  nearestPredator: 30,
});
const clearOcto = scoreFrame({
  subjects: [subject({ species: 'octopus', rarity: 25, fill: 0.32, clarity: 1, ndcX: 0.2, ndcY: -0.1 })],
  depth: 10,
  nearestPredator: 30,
});
assert(blocked.composition < clearOcto.composition, 'occlusion cuts composition');
assert(blocked.rarity < clearOcto.rarity && blocked.rarity <= 12, `blocked rarity ${blocked.rarity}`);
assert(blocked.composition + blocked.rarity + blocked.moment + blocked.distanceDanger === blocked.total, 'blocked sum');

let prev = -1;
for (const s of [0, 20, 40, 60, 80, 100]) {
  const prize = prizeForScore(s);
  assert(prize >= prev, 'prize monotonic');
  prev = prize;
}
assert(prizeForScore(0) === 0, 'zero prize');
assert(prizeForScore(59) === 0, 'under 60 pays nothing');
assert(prizeForScore(60) > 0, '60 is accepted');
assert(prizeForScore(100) > prizeForScore(70), 'great shots pay more');
assert(buoyancyAccel(0) > 0.5, 'shallow water lifts');
assert(Math.abs(buoyancyAccel(BALANCE.neutralDepth)) < 1e-6, 'neutral at 12 m');
assert(buoyancyAccel(BALANCE.neutralDepth + BALANCE.sinkRamp) < -1, 'deep water sinks');
assert(Math.abs(BALANCE.riseAccel / BALANCE.waterDrag - BALANCE.terminalRise) < 0.02, 'rise terminal');
assert(Math.abs(BALANCE.sinkAccel / BALANCE.waterDrag - BALANCE.terminalSink) < 0.02, 'sink terminal');
assert(headAtSurface(-1.88), 'a head at the surface can breathe');
assert(!headAtSurface(-4), 'an underwater head does not refill');

const entry = terrainHeight(0, 2.4);
const garden = terrainHeight(7, 18);
const trench = terrainHeight(20, 70);
assert(entry < -3, `entry too shallow ${entry}`);
assert(garden < -6 && garden > -20, `garden ${garden}`);
assert(trench < -28, `trench ${trench}`);
assert(Math.abs(depthMeters(-1.88) - 0.98) < 0.02, 'surface depth');

console.log('scoring ok', { turtle: turtle.total, moment: turtleMoment.total, orca: orca.total, clown: clown.total, trench, garden });
