import { depthMeters, terrainHeight } from '../src/terrain.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

let deepest = 0;
let deepestAt = '';
for (let x = -34; x <= 30; x += 1) {
  for (let z = 2; z <= 80; z += 1) {
    const y = terrainHeight(x, z);
    const depth = depthMeters(y + 0.22);
    if (depth > deepest) {
      deepest = depth;
      deepestAt = `${x},${z}`;
    }
  }
}
assert(deepest <= 41.05, `sand deeper than 41 m at ${deepestAt}: ${deepest.toFixed(2)}`);
const trench = terrainHeight(14, 60);
assert(depthMeters(trench + 0.22) > 38, `trench still reaches the floor, got ${depthMeters(trench + 0.22).toFixed(1)}`);
const tan = Math.tan(0.15);
let deepOnLine = 0;
for (let z = 9; z <= 78; z += 1) {
  const x = 6.2 + Math.max(0, z - 9) * tan;
  const depth = depthMeters(terrainHeight(x, z) + 0.22);
  if (depth > deepOnLine) deepOnLine = depth;
  assert(depth <= 41.05, `default heading deeper than 41 m at z ${z}: ${depth.toFixed(2)}`);
}
assert(deepOnLine > 38, `default heading reaches the floor, got ${deepOnLine.toFixed(1)}`);
console.log('terrain ok', { deepest: deepest.toFixed(2), at: deepestAt, heading: deepOnLine.toFixed(2) });
