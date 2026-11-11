import { PerspectiveCamera } from 'three';
import { BALANCE, buoyancyAccel, headAtSurface, prizeForScore } from '../src/balance.ts';
import { AIM_HALF, computeSubject, scoreFrame, type AimCreature, type FrameSubject } from '../src/scoring.ts';
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
    acting: false,
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
assert(turtle.moment === 0 && turtle.momentNote === 'none', 'an idle turtle has no moment');
assert(turtle.total > 40 && turtle.total < 60, `idle turtle stays under 60 (${turtle.total})`);

const turtleMoment = scoreFrame({
  subjects: [subject({ species: 'turtle', rarity: 16, moment: 'turtleBreath' })],
  depth: 2,
  nearestPredator: 40,
});
assert(turtleMoment.moment === 25, `moment points ${turtleMoment.moment}`);
assert(turtleMoment.total > turtle.total, 'moment should outscore the plain turtle');
assert(turtleMoment.comment === 'moment', turtleMoment.comment);

const actingTurtle = scoreFrame({
  subjects: [subject({ species: 'turtle', rarity: 16, acting: true })],
  depth: 8,
  nearestPredator: 30,
});
assert(actingTurtle.moment === 10 && actingTurtle.momentNote === 'action', `action moment ${actingTurtle.moment} ${actingTurtle.momentNote}`);
assert(actingTurtle.momentId === null, 'a swim stroke is not a special moment');
assert(actingTurtle.total >= 60 && actingTurtle.total <= 75, `clear turtle in motion ${actingTurtle.total}`);
assert(actingTurtle.total === actingTurtle.composition + actingTurtle.rarity + actingTurtle.moment + actingTurtle.distanceDanger, 'action sum');

const movingOcto = scoreFrame({
  subjects: [
    subject({
      species: 'octopus',
      rarity: 25,
      acting: true,
      fill: 0.28,
      radiusNdcX: 0.14,
      radiusNdcY: 0.28,
      ndcX: 0.05,
      ndcY: 0.05,
      distance: 5.5,
      optimal: 4.2,
    }),
  ],
  depth: 10,
  nearestPredator: 40,
});
const stillOcto = scoreFrame({
  subjects: [
    subject({
      species: 'octopus',
      rarity: 25,
      acting: false,
      fill: 0.28,
      radiusNdcX: 0.14,
      radiusNdcY: 0.28,
      ndcX: 0.05,
      ndcY: 0.05,
      distance: 5.5,
      optimal: 4.2,
    }),
  ],
  depth: 10,
  nearestPredator: 40,
});
assert(stillOcto.moment === 0 && stillOcto.momentNote === 'none', `still octopus has no moment (${stillOcto.total})`);
assert(movingOcto.moment === 10 && movingOcto.momentNote === 'action', 'moving octopus earns the action base');
assert(movingOcto.total === stillOcto.total + 10, `the action line is the only change (${stillOcto.total} -> ${movingOcto.total})`);
assert(movingOcto.total >= 60 && movingOcto.total <= 80, `moving octopus in the bracket passes ${movingOcto.total}`);

const sloppy = scoreFrame({
  subjects: [subject({ species: 'clownfish', rarity: 10, acting: true, ndcX: 0.92, ndcY: 0.7, fill: 0.1, radiusNdcX: 0.06, radiusNdcY: 0.1 })],
  depth: 6,
  nearestPredator: 40,
});
assert(sloppy.species === null && sloppy.moment === 0 && sloppy.total === 0, `a corner clownfish is not the subject (${sloppy.total})`);

const cornerTurtle = scoreFrame({
  subjects: [
    subject({
      species: 'turtle',
      rarity: 16,
      moment: 'turtleBreath',
      acting: true,
      ndcX: 0.78,
      ndcY: 0.62,
      fill: 0.22,
      radiusNdcX: 0.12,
      radiusNdcY: 0.18,
    }),
  ],
  depth: 6,
  nearestPredator: 40,
});
assert(cornerTurtle.species === null && cornerTurtle.momentId === null, 'a corner turtle is not the subject');

const promptTurtle = scoreFrame({
  subjects: [
    subject({
      species: 'turtle',
      rarity: 16,
      moment: 'turtleBreath',
      acting: true,
      ndcX: 0.08,
      ndcY: 0.04,
      fill: 0.12,
      radiusNdcX: 0.06,
      radiusNdcY: 0.12,
      distance: 15,
      optimal: 8,
    }),
  ],
  depth: 4,
  nearestPredator: 40,
});
assert(
  promptTurtle.species === 'turtle' && promptTurtle.momentId === 'turtleBreath' && promptTurtle.moment >= 12,
  `a breathing turtle inside the bracket scores the moment (${promptTurtle.moment})`,
);

const school = scoreFrame({
  subjects: [
    subject({
      species: 'sardine',
      rarity: 14,
      acting: true,
      ndcX: 0.7,
      ndcY: 0.05,
      fill: 0.9,
      radiusNdcX: 0.7,
      radiusNdcY: 0.9,
    }),
  ],
  depth: 8,
  nearestPredator: 40,
});
assert(school.species === null, 'a sardine school outside the bracket is not the subject');

const mixed = scoreFrame({
  subjects: [
    subject({
      species: 'turtle',
      rarity: 16,
      moment: 'turtleBreath',
      acting: true,
      ndcX: 0.8,
      ndcY: 0.55,
      fill: 0.24,
      radiusNdcX: 0.14,
      radiusNdcY: 0.2,
    }),
    subject({
      species: 'clownfish',
      rarity: 12,
      acting: true,
      ndcX: 0.04,
      ndcY: -0.02,
      fill: 0.2,
      radiusNdcX: 0.1,
      radiusNdcY: 0.2,
      distance: 2.3,
      optimal: 2.3,
    }),
  ],
  depth: 6,
  nearestPredator: 40,
});
assert(
  mixed.species === 'clownfish' && mixed.momentId === null && mixed.moment === 10,
  `the aimed clownfish is the subject, got ${mixed.species} ${mixed.momentId} ${mixed.moment}`,
);

const actingClown = scoreFrame({
  subjects: [subject({ species: 'clownfish', rarity: 10, acting: true, distance: 2.3, optimal: 2.3, fill: 0.3 })],
  depth: 6,
  nearestPredator: 40,
});
assert(actingClown.moment === 10 && actingClown.total >= 60 && actingClown.total <= 75, `clown in motion ${actingClown.total}`);

const framedMoving = scoreFrame({
  subjects: [
    subject({
      species: 'clownfish',
      rarity: 12,
      acting: true,
      fill: 0.14,
      radiusNdcX: 0.08,
      radiusNdcY: 0.14,
      ndcX: 0.33,
      ndcY: -0.02,
      distance: 2.4,
      optimal: 2.3,
    }),
  ],
  depth: 1,
  nearestPredator: 40,
});
const framedIdle = scoreFrame({
  subjects: [
    subject({
      species: 'clownfish',
      rarity: 12,
      acting: false,
      fill: 0.14,
      radiusNdcX: 0.08,
      radiusNdcY: 0.14,
      ndcX: 0.33,
      ndcY: -0.02,
      distance: 2.4,
      optimal: 2.3,
    }),
  ],
  depth: 1,
  nearestPredator: 40,
});
assert(
  framedMoving.moment === 10 && framedMoving.total >= 60 && framedMoving.total <= 64,
  `clear moving clown ${framedMoving.total} (${framedMoving.composition}/${framedMoving.rarity}/${framedMoving.moment}/${framedMoving.distanceDanger})`,
);
assert(framedIdle.moment === 0 && framedIdle.total < 60, `idle clown stays under 60 (${framedIdle.total})`);
assert(framedMoving.total > framedIdle.total, 'motion is what accepts the clown');

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

for (const shot of [empty, turtle, turtleMoment, actingTurtle, movingOcto, stillOcto, sloppy, actingClown, orca, clown, off]) {
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
const aside = subject({ ...shark, ndcX: 0.72, ndcY: 0.4 });
const passing = scoreFrame({ subjects: [aside, visibleOrca], depth: 28, nearestPredator: 6 });
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
assert(buoyancyAccel(0) > 0.4 && buoyancyAccel(0) < 0.85, 'gentle surface lift');
assert(Math.abs(buoyancyAccel(BALANCE.neutralDepth)) < 1e-6, 'neutral at 12 m');
const justBelow = buoyancyAccel(14);
assert(justBelow < 0 && justBelow > -0.15, `gentle just below 12 m (${justBelow})`);
assert(buoyancyAccel(BALANCE.neutralDepth + BALANCE.sinkRamp) < -0.5, 'deep water sinks');
assert(BALANCE.terminalRise >= 0.6 && BALANCE.terminalRise <= 0.8, 'rise terminal band');
assert(BALANCE.terminalSink >= 0.8 && BALANCE.terminalSink <= 1, 'sink terminal band');
assert(Math.abs(BALANCE.riseAccel / BALANCE.waterDrag - BALANCE.terminalRise) < 0.02, 'rise terminal');
assert(Math.abs(BALANCE.sinkAccel / BALANCE.waterDrag - BALANCE.terminalSink) < 0.02, 'sink terminal');
assert(BALANCE.waterDrag === 0.65, 'glide drag stays');
assert(BALANCE.cruiseSpeed >= 2 && BALANCE.cruiseSpeed <= 2.5, 'cruise band');
assert(Math.abs(BALANCE.sprintSpeed / BALANCE.cruiseSpeed - 1.7) < 0.06, 'sprint is about 1.7x');
assert(BALANCE.strokePeriod >= 0.4 && BALANCE.strokePeriod <= 0.5, 'stroke cycle');
assert(BALANCE.burstTime >= 0.95 && BALANCE.burstTime <= 1.05, 'sprint lasts about a second');
assert(BALANCE.strokeImpulse > 0.7 && BALANCE.strokeImpulse < 1.2, 'a tap is an impulse');
assert(headAtSurface(-1.88), 'a head at the surface can breathe');
assert(!headAtSurface(-4), 'an underwater head does not refill');

const entry = terrainHeight(0, 2.4);
const garden = terrainHeight(7, 18);
const trench = terrainHeight(20, 70);
const lane = terrainHeight(6.2, 28);
const leftShelf = terrainHeight(20, 16);
const underSpawn = terrainHeight(6.2, 9);
assert(entry < -3, `entry too shallow ${entry}`);
assert(garden < -6 && garden > -20, `garden ${garden}`);
assert(trench < -28, `trench ${trench}`);
assert(lane < -18, `offshore lane ${lane}`);
assert(leftShelf > -14, `left shelf stays shallow ${leftShelf}`);
assert(underSpawn < -16, `spawn drop ${underSpawn}`);
assert(Math.abs(depthMeters(-1.88) - 0.98) < 0.02, 'surface depth');

const aimedClown = scoreFrame({
  subjects: [
    subject({
      species: 'clownfish',
      rarity: 12,
      acting: true,
      fill: 0.16,
      radiusNdcX: 0.08,
      radiusNdcY: 0.16,
      ndcX: 0.05,
      ndcY: -0.04,
      distance: 2.2,
      optimal: 2.2,
    }),
    subject({
      species: 'turtle',
      rarity: 16,
      fill: 0.42,
      radiusNdcX: 0.28,
      radiusNdcY: 0.42,
      ndcX: 0.62,
      ndcY: 0.35,
      distance: 7,
      optimal: 7,
    }),
    subject({
      species: 'manta',
      rarity: 18,
      fill: 0.55,
      radiusNdcX: 0.4,
      radiusNdcY: 0.55,
      ndcX: -0.7,
      ndcY: 0.2,
      distance: 9,
      optimal: 11,
    }),
  ],
  depth: 8,
  nearestPredator: 30,
});
assert(aimedClown.species === 'clownfish', `reticle picks clownfish, got ${aimedClown.species}`);

const movingSchool = scoreFrame({
  subjects: [
    subject({
      species: 'sardine',
      rarity: 14,
      acting: true,
      fill: 0.36,
      radiusNdcX: 0.2,
      radiusNdcY: 0.36,
      ndcX: 0.08,
      ndcY: -0.04,
      distance: 8,
      optimal: 8.5,
    }),
    subject({
      species: 'sardine',
      rarity: 10,
      acting: false,
      fill: 0.06,
      radiusNdcX: 0.03,
      radiusNdcY: 0.06,
      ndcX: 0.02,
      ndcY: 0.01,
      distance: 6,
      optimal: 2.1,
    }),
  ],
  depth: 8,
  nearestPredator: 40,
});
assert(movingSchool.species === 'sardine' && movingSchool.rarity === 14, `school is the subject (${movingSchool.species} ${movingSchool.rarity})`);
assert(movingSchool.moment === 10 && movingSchool.momentNote === 'action', `moving school moment ${movingSchool.moment}`);

const stillSchool = scoreFrame({
  subjects: [
    subject({
      species: 'sardine',
      rarity: 14,
      acting: false,
      fill: 0.36,
      radiusNdcX: 0.2,
      radiusNdcY: 0.36,
      ndcX: 0.08,
      ndcY: -0.04,
      distance: 8,
      optimal: 8.5,
    }),
  ],
  depth: 8,
  nearestPredator: 40,
});
assert(stillSchool.moment === 0, `a still school has no motion line (${stillSchool.moment})`);

const baitSchool = scoreFrame({
  subjects: [
    subject({
      species: 'sardine',
      rarity: 14,
      acting: true,
      moment: 'baitball',
      fill: 0.4,
      radiusNdcX: 0.22,
      radiusNdcY: 0.4,
      ndcX: 0.05,
      ndcY: 0.02,
      distance: 7,
      optimal: 8.5,
    }),
  ],
  depth: 8,
  nearestPredator: 12,
});
assert(baitSchool.momentId === 'baitball' && baitSchool.moment === 25, `bait ball stays 25 (${baitSchool.momentId} ${baitSchool.moment})`);

function aimCamera(fov: number, aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(fov, aspect, 0.08, 200);
  camera.position.set(0, -8, 0);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, -8, 10);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function reef(): AimCreature[] {
  return [
    {
      species: 'parrotfish',
      rarity: 13,
      x: 1.15,
      y: -8,
      z: 8,
      radius: 0.45,
      optimal: 4,
      moment: null,
      dangerous: false,
      acting: true,
    },
    {
      species: 'sardine',
      rarity: 14,
      x: -4.2,
      y: -8,
      z: 8,
      radius: 1.4,
      optimal: 8.5,
      moment: null,
      dangerous: false,
      acting: true,
    },
  ];
}

const fovWide = 1400 / 29;
const fovTight = 1400 / 36;
const cssAspect = 1280 / 720;
for (const fov of [fovWide, fovTight]) {
  for (const scale of [1, 0.35]) {
    const bufAspect = (1280 * scale) / (720 * scale);
    assert(Math.abs(bufAspect - cssAspect) < 1e-9, 'a uniform render scale does not change aspect');
    const camera = aimCamera(fov, cssAspect);
    const { subject, frames } = computeSubject(camera, reef());
    const scored = scoreFrame({ subjects: frames, depth: 8, nearestPredator: 40 });
    assert(subject?.species === 'parrotfish', `zoom ${fov.toFixed(1)} scale ${scale} picked ${subject?.species}`);
    assert(scored.species === subject?.species, 'the shutter score is that same subject');
    assert(subject != null && Math.abs(subject.ndcX) <= AIM_HALF && Math.abs(subject.ndcY) <= AIM_HALF, `subject ndc ${subject?.ndcX} ${subject?.ndcY}`);
    const school = frames.find((s) => s.rarity === 14);
    assert(school != null && Math.abs(school.ndcX) > AIM_HALF, `school stays outside the bracket (${school?.ndcX})`);
    if (scale === 1) {
      const again = computeSubject(aimCamera(fov, cssAspect), reef());
      const shrunk = computeSubject(aimCamera(fov, (1280 * 0.35) / (720 * 0.35)), reef());
      assert(
        again.subject != null &&
          shrunk.subject != null &&
          Math.abs(again.subject.ndcX - shrunk.subject.ndcX) < 1e-6 &&
          Math.abs(again.subject.ndcY - shrunk.subject.ndcY) < 1e-6,
        'render scale 0.35 does not move the projection',
      );
    }
  }
}

const riseAt4 = buoyancyAccel(4) / BALANCE.waterDrag;
assert(riseAt4 >= 0.5 && riseAt4 <= 0.8, `shallow rise ${riseAt4.toFixed(2)}`);

console.log('scoring ok', {
  turtle: turtle.total,
  actingTurtle: actingTurtle.total,
  moment: turtleMoment.total,
  orca: orca.total,
  clown: clown.total,
  actingClown: actingClown.total,
  stillOcto: stillOcto.total,
  movingOcto: movingOcto.total,
  movingParts: [movingOcto.composition, movingOcto.rarity, movingOcto.moment, movingOcto.distanceDanger],
  stillParts: [stillOcto.composition, stillOcto.rarity, stillOcto.moment, stillOcto.distanceDanger],
  sloppy: sloppy.total,
  trench,
  garden,
  underSpawn,
});
