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
console.log('terrain ok', { deepest: deepest.toFixed(2), at: deepestAt });
