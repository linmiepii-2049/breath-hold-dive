import { clamp, smoothstep } from './util';

/**
 * Reef wall site. +Z swims offshore, +X approaches the wall.
 * y = 0 is the water surface. Positive y is air / dry sand.
 */
export function terrainHeight(x: number, z: number): number {
  const dunes =
    Math.sin(x * 0.22 + 0.4) * Math.cos(z * 0.18) * 1.05 +
    Math.sin(x * 0.51 + z * 0.37) * 0.38;

  let depth = 8 + 11 * smoothstep(4, 50, z);
  depth += 22 * smoothstep(38, 76, z) * smoothstep(-4, 22, x);
  // The trench mouth. A straight swim down the lane keeps falling past 23 m
  // instead of riding a shelf, and 33 m is on that line before the deep pocket.
  const mouth = smoothstep(24, 46, z) * smoothstep(-2, 14, x) * (1 - smoothstep(22, 30, x));
  depth += 18 * mouth;
  // Lane straight off the spawn (x ≈ 6, heading +Z). The shelf to the left stays shallow.
  const lane = smoothstep(10, 22, z) * Math.exp(-((x - 6.2) * (x - 6.2)) / (2 * 9 * 9));
  depth += 9 * lane;
  // Anemone shelf, just left of the lane. The near lip is where a 6–7 m swim arrives;
  // the nest itself sits a little deeper so the fish are below a level gaze.
  const ledge = Math.exp(-((x + 3) * (x + 3)) / (2 * 5.2 * 5.2) - ((z - 15) * (z - 15)) / (2 * 4.2 * 4.2));
  depth -= 6.4 * ledge;
  // The shelf under the spawn is only ~8 m. Open a drop in front of it so a
  // straight descent has water under the diver, then fade it out before the garden.
  const bowl = smoothstep(3.5, 10, z) * (1 - smoothstep(13.5, 17.2, z));
  const across = Math.exp(-((x - 6.2) * (x - 6.2)) / (2 * 7.5 * 7.5));
  depth += 7.5 * bowl * across;
  const pocket = Math.exp(
    -((x - 6.2) * (x - 6.2)) / (2 * 4.5 * 4.5) - ((z - 9) * (z - 9)) / (2 * 3.6 * 3.6),
  );
  depth += 5.5 * pocket;
  let y = -depth + dunes;

  if (z < 4) {
    const u = smoothstep(4, -8, z);
    const beach = -0.6 + (4 - z) * 0.22;
    y = y * (1 - u) + beach * u;
  }

  // Keep the far corners from spiking above the playable trench.
  if (z > 8) y = Math.min(y, -4.5 + dunes * 0.25);
  // 41 m on the depth gauge is the floor everywhere. A diver resting on the
  // sand has feet about 1.12 m above this height, and depthMeters of that pose is 41.
  if (y < -42.12) y = -42.12;
  return y;
}

export function depthMeters(feetY: number): number {
  return Math.max(0, -(feetY + 0.9));
}

export const BOUNDS = {
  minX: -34,
  maxX: 30,
  minZ: 2.4,
  maxZ: 80,
  wallX: 28.5,
  wallZ0: 18,
  wallZ1: 76,
  surfaceFeet: -1.88,
};

export function clampDiver(x: number, y: number, z: number, lift = true): { x: number; y: number; z: number } {
  let nx = clamp(x, BOUNDS.minX, BOUNDS.maxX);
  const nz = clamp(z, BOUNDS.minZ, BOUNDS.maxZ);
  if (nx > BOUNDS.wallX - 1.2 && nz > BOUNDS.wallZ0 && nz < BOUNDS.wallZ1) {
    nx = BOUNDS.wallX - 1.2;
  }
  const floor = terrainHeight(nx, nz) + 0.22;
  // Swimming must not snap onto a higher shelf. That snap is what rode the diver up a slope.
  let ny = lift ? Math.max(y, floor) : y;
  ny = Math.min(ny, BOUNDS.surfaceFeet);
  if (lift && floor > BOUNDS.surfaceFeet) ny = floor;
  return { x: nx, y: ny, z: nz };
}
