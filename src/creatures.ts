import { Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshLambertMaterial, Object3D, Vector3 } from 'three';
import {
  animateTail,
  makeFish,
  makeManta,
  makeOctopus,
  makeOrca,
  makeShark,
  makeTurtle,
  mergeParts,
  M,
  UNIT,
} from './models';
import { BOUNDS, terrainHeight } from './terrain';
import type { MomentId, SpeciesId } from './types';
import { clamp, rng } from './util';
import type { Scene } from 'three';
import { LANDMARKS } from './world';

export interface Snap {
  species: SpeciesId;
  rarity: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  optimal: number;
  moment: MomentId | null;
  dangerous: boolean;
  acting: boolean;
}

export interface SimEvent {
  hit: 'shark' | 'orca' | null;
  baitStart: boolean;
  turtleStart: boolean;
  orcaStart: boolean;
  /** True on the frame a shark starts its warning circle. */
  sharkWarn: boolean;
  /** True while a shark is circling, before the charge. */
  sharkThreat: boolean;
  /** True on the frame a shark commits to the charge. */
  sharkCharge: boolean;
  /** True while a shark is charging. */
  sharkCharging: boolean;
  /** F was held and the diver turned far enough to break the warning or the charge. */
  sharkFled: boolean;
  /** True on the frame the octopus colour show becomes visible nearby. */
  octopusStart: boolean;
}

interface Boid {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

interface Swimmer {
  mesh: Group;
  species: SpeciesId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: string;
  timer: number;
  speed: number;
  radius: number;
  optimal: number;
  rarity: number;
  dangerous: boolean;
  wps: Array<[number, number, number]>;
  wp: number;
  phase: number;
  /** Metres per second from the last step. A frozen pose stays at 0. */
  travel?: number;
  prevX?: number;
  prevY?: number;
  prevZ?: number;
}

const OCTO_SHOW = [0xe36a8c, 0x49b3a8, 0xe0a15a, 0x7a6ad4];

export class OceanLife {
  readonly snaps: Snap[] = [];
  bait: 'flock' | 'form' | 'charge' | 'scatter' = 'flock';
  orcaVisible = false;
  private scene: Scene;
  private boids: Boid[] = [];
  private school: InstancedMesh;
  private dummy = new Object3D();
  private swimmers: Swimmer[] = [];
  private octopus: Group;
  private octoX = LANDMARKS.octopus.x;
  private octoZ = LANDMARKS.octopus.z;
  private octoY = 0;
  private displaying = false;
  private t = 0;
  private nextBait = 18;
  private baitLeft = 0;
  private baitX = LANDMARKS.bait.x;
  private baitY = -8;
  private baitZ = LANDMARKS.bait.z;
  private homeX = 0;
  private homeY = -8;
  private homeZ = 28;
  private sharkA!: Swimmer;
  private turtleA!: Swimmer;
  private orca!: Swimmer;
  private turtleAimX = 4;
  private turtleAimZ = 16;
  private orcaHit = false;
  private orcaTold = false;
  /** Charge aim. `min` is the closest gap so far, kept for the log. */
  private chargeDir = new Map<Swimmer, { x: number; y: number; z: number; ox: number; oy: number; oz: number; start: number; min: number; stall: number }>();
  private prevYaw = 0;
  private yawReady = false;
  /** F is down this tick. A kick never sets it. */
  private sprinting = false;
  /** Radians turned while F is held during the current warning or charge. */
  private escapeYaw = 0;
  /** Stays on once the turn clears 35°, so a later frame cannot still bite. */
  private escaped = false;
  private fleeTold = false;
  private octoTold = false;
  /** Circle frozen on the diver's position when the warning started. A sprint leaves the ring. */
  private orbitAnchor = new Map<Swimmer, { x: number; y: number; z: number; radius: number; ang: number }>();
  private baitTold = false;
  private turtleTold = false;
  private orcaWait = 24;
  private passX = -40;
  private debugLock = 0;
  private debugOcto = false;
  private sharkLog = false;
  private schoolTail: InstancedMesh;
  private schoolPx = 0;
  private schoolPy = 0;
  private schoolPz = 0;
  private schoolT = 0;
  private schoolReady = false;

  constructor(scene: Scene) {
    this.scene = scene;
    this.school = this.buildSchool();
    this.schoolTail = this.buildSchoolTail();
    scene.add(this.school);
    scene.add(this.schoolTail);
    this.octopus = makeOctopus();
    scene.add(this.octopus);
    this.reset();
  }

  reset(): void {
    this.t = 0;
    this.yawReady = false;
    this.sprinting = false;
    this.escapeYaw = 0;
    this.escaped = false;
    this.fleeTold = false;
    this.bait = 'flock';
    this.nextBait = 40;
    this.baitLeft = 0;
    this.orcaHit = false;
    this.orcaTold = false;
    this.baitTold = false;
    this.turtleTold = false;
    this.orcaWait = 26;
    this.passX = -42;
    this.orcaVisible = false;
    this.debugLock = 0;
    this.displaying = false;
    this.octoY = terrainHeight(this.octoX, this.octoZ) + 0.15;
    this.boids = [];
    const rand = rng(11);
    for (let i = 0; i < 56; i++) {
      this.boids.push({
        x: (rand() - 0.5) * 10,
        y: -7 - rand() * 2,
        z: 26 + (rand() - 0.5) * 8,
        vx: rand() - 0.5,
        vy: 0,
        vz: rand() - 0.5,
      });
    }
    for (const s of this.swimmers) this.scene.remove(s.mesh);
    this.swimmers = [];
    this.spawnCast();
  }

  /** True while a debug teleport is holding the reef still for a framed shot. */
  framing(): boolean {
    return this.debugLock > 0;
  }

  setDebug(on: boolean): void {
    this.sharkLog = on;
  }

  /**
   * Put the reef shark on its warning ring at `meters` from the chest.
   * The ring, the charge, and the sprint escape are the same ones a real approach uses.
   * Only the debug hook calls this.
   */
  armWarn(cx: number, cy: number, cz: number, meters: number): void {
    const dist = Math.min(11.2, Math.max(6.2, meters));
    const shark = this.sharkA;
    shark.state = 'warn';
    shark.timer = 1.05;
    shark.speed = 2.1;
    this.orbitAnchor.set(shark, { x: cx, y: cy, z: cz, radius: dist, ang: 0 });
    this.chargeDir.delete(shark);
    this.holdCircle(shark, 0);
    this.t = Math.max(this.t, 40);
    this.bait = 'flock';
    this.nextBait = 99999;
    this.baitLeft = 0;
    this.sprinting = false;
    this.escapeYaw = 0;
    this.escaped = false;
    this.fleeTold = false;
    for (const other of this.swimmers) {
      if (other.species !== 'shark' || other === shark) continue;
      other.state = 'patrol';
      other.timer = 30;
      other.x = 80;
      other.z = 80;
      this.orbitAnchor.delete(other);
      this.chargeDir.delete(other);
    }
    if (this.sharkLog) console.info(`[shark] debug warn at ${dist.toFixed(1)} m`);
  }

  /** The first photo ends the debug hold, so a teleport does not trap the diver. */
  releaseFrame(): void {
    this.debugLock = 0;
  }

  /** Large animals the diver should bump instead of swimming through. */
  bodies(): { x: number; y: number; z: number; r: number; kind: string }[] {
    const out: { x: number; y: number; z: number; r: number; kind: string }[] = [];
    for (const s of this.swimmers) {
      if (s.species === 'orca' && !this.orcaVisible) continue;
      const r = s.species === 'turtle' ? 0.9 : s.species === 'manta' ? 1.35 : s.species === 'shark' ? 1.55 : s.species === 'orca' ? 2.2 : 0;
      if (r <= 0) continue;
      out.push({ x: s.x, y: s.y, z: s.z, r, kind: s.species });
    }
    return out;
  }

  /**
   * Freeze the cast and place one animal, or one special moment, in front of a photo spot.
   * Only called from the ?debug=1 panel.
   */
  debugTrigger(id: string): { x: number; y: number; z: number; yaw: number; lookX: number; lookY: number; lookZ: number } {
    this.debugLock = 8;
    this.parkAll();
    const look = (x: number, y: number, z: number, back: number, yaw: number) => {
      const px = x - Math.sin(yaw) * back;
      const pz = z - Math.cos(yaw) * back;
      const floor = terrainHeight(px, pz);
      const py = Math.min(BOUNDS.surfaceFeet, Math.max(floor + 1.35, y + 0.2));
      this.poseAll();
      return { x: px, y: py, z: pz, yaw, lookX: x, lookY: y, lookZ: z };
    };
    if (id === 'sardine') {
      this.bait = 'flock';
      this.placeSchool(0, -8, 30, 2.1);
      return look(0, -8, 30, 8, 0);
    }
    if (id === 'clownfish') {
      const x = LANDMARKS.anemone.x;
      const z = LANDMARKS.anemone.z;
      const y = terrainHeight(x, z) + 1.05;
      this.shovePlants(x, z, 9);
      return look(x, y, z, 3.4, -0.2);
    }
    if (id === 'parrotfish') {
      const s = this.swimmer('parrotfish');
      s.x = -4;
      s.y = -7;
      s.z = 24;
      s.yaw = Math.PI;
      return look(s.x, s.y, s.z, 6, 0);
    }
    if (id === 'turtle') {
      this.turtleA.state = 'cruise';
      this.turtleA.timer = 40;
      this.turtleA.x = -2;
      this.turtleA.y = -7;
      this.turtleA.z = 26;
      this.turtleA.yaw = Math.PI;
      return look(this.turtleA.x, this.turtleA.y, this.turtleA.z, 7, 0);
    }
    if (id === 'manta') {
      const s = this.swimmer('manta');
      s.x = 0;
      s.y = -12;
      s.z = 36;
      s.yaw = Math.PI;
      return look(s.x, s.y, s.z, 10, 0);
    }
    if (id === 'octopus') {
      // Open sand, off the crevice rocks and in front of the kelp band.
      this.octoX = -18;
      this.octoZ = 16;
      this.octoY = terrainHeight(this.octoX, this.octoZ) + 1.85;
      this.displaying = true;
      this.debugOcto = true;
      this.octopus.rotation.y = Math.PI;
      this.octopus.userData.displayColor = OCTO_SHOW[0];
      animateTail(this.octopus, this.t, 1.4, 0);
      this.shovePlants(this.octoX, this.octoZ, 10);
      const camZ = this.octoZ - 4.6;
      const camFloor = terrainHeight(this.octoX, camZ);
      const feetY = Math.min(BOUNDS.surfaceFeet, Math.max(camFloor + 0.2, this.octoY - 1.75));
      this.poseAll();
      return {
        x: this.octoX,
        y: feetY,
        z: camZ,
        yaw: 0,
        lookX: this.octoX,
        lookY: this.octoY + 0.55,
        lookZ: this.octoZ,
      };
    }
    if (id === 'shark') {
      const x = -8;
      const z = 28;
      const floor = terrainHeight(x, z);
      this.bait = 'flock';
      this.sharkA.state = 'patrol';
      this.sharkA.timer = 99;
      this.sharkA.x = x;
      this.sharkA.y = floor + 2.6;
      this.sharkA.z = z;
      this.sharkA.yaw = Math.PI / 2 + 0.42;
      this.shovePlants(x, z, 12);
      const camZ = z - 8;
      const camFloor = terrainHeight(x, camZ);
      const feetY = Math.min(BOUNDS.surfaceFeet, Math.max(camFloor + 0.35, this.sharkA.y - 1.4));
      this.poseAll();
      return { x, y: feetY, z: camZ, yaw: 0, lookX: x + 0.4, lookY: this.sharkA.y + 0.15, lookZ: z };
    }
    if (id === 'orca' || id === 'orcaPass') {
      // Side-on in open water, above the slope, so the eye patch and dorsal read.
      const x = -12;
      const z = 40;
      const back = id === 'orcaPass' ? 12 : 9;
      const camZ = z - back;
      const camFloor = terrainHeight(x, camZ);
      const feetY = Math.min(BOUNDS.surfaceFeet, camFloor + 1.55);
      this.orcaVisible = true;
      this.orcaTold = true;
      this.passX = x;
      this.orca.x = x;
      this.orca.z = z;
      this.orca.y = feetY + 1.45;
      this.orca.yaw = Math.PI / 2;
      this.orca.mesh.visible = true;
      this.shovePlants(x, z, 14);
      this.shovePlants(x, camZ, 14);
      this.poseAll();
      return { x, y: feetY, z: camZ, yaw: 0, lookX: x, lookY: this.orca.y + 0.15, lookZ: z };
    }
    if (id === 'baitball') {
      this.bait = 'scatter';
      this.baitLeft = 22;
      this.baitTold = true;
      this.placeSchool(1.5, -8, 32, 2.4);
      this.sharkA.state = 'patrol';
      this.sharkA.timer = 99;
      this.sharkA.x = 5.5;
      this.sharkA.y = -8;
      this.sharkA.z = 32;
      this.sharkA.yaw = -Math.PI / 2;
      return look(1.5, -8, 32, 9, 0);
    }
    if (id === 'turtleBreath') {
      this.turtleA.state = 'breathe';
      this.turtleA.timer = 22;
      this.turtleA.x = 2;
      this.turtleA.y = -0.55;
      this.turtleA.z = 18;
      this.turtleA.yaw = Math.PI;
      return look(2, -1.6, 18, 6.5, 0);
    }
    this.debugLock = 0;
    return { x: 6.2, y: -3.8, z: 9, yaw: 0.15, lookX: 6.2, lookY: -3, lookZ: 16 };
  }

  update(dt: number, diver: Vector3, aggro: boolean, events: boolean): SimEvent {
    this.t += dt;
    const out: SimEvent = {
      hit: null,
      baitStart: false,
      turtleStart: false,
      orcaStart: false,
      sharkWarn: false,
      sharkThreat: false,
      sharkCharge: false,
      sharkCharging: false,
      sharkFled: false,
      octopusStart: false,
    };
    if (this.debugLock > 0) {
      this.debugLock = Math.max(0, this.debugLock - dt);
      if (this.debugOcto) {
        this.displaying = true;
        this.octopus.rotation.y = Math.PI;
        this.octopus.userData.displayColor = OCTO_SHOW[Math.floor(this.t * 1.4) % OCTO_SHOW.length];
        animateTail(this.octopus, this.t, 1.4, 0);
      }
      // The rest of the cast holds still. Clownfish keep circling so a teleport
      // does not leave them as a static stack.
      for (const s of this.swimmers) {
        if (s.species === 'clownfish') this.orbitClownfish(s, dt);
      }
      this.poseAll();
      this.applySpawnGrace();
      this.rebuildSnaps();
      return out;
    }
    if (events) this.stepEvents(dt, diver, out);
    this.stepBoids(dt);
    this.stepSwimmers(dt, diver, aggro, events, out);
    this.applySpawnGrace();
    this.stepOctopus(dt, diver, out);
    this.writeSchool();
    this.rebuildSnaps();
    return out;
  }

  private parkAll(): void {
    this.orcaVisible = false;
    this.debugOcto = false;
    this.bait = 'flock';
    this.octoX = LANDMARKS.octopus.x;
    this.octoZ = LANDMARKS.octopus.z;
    this.octoY = terrainHeight(this.octoX, this.octoZ) + 0.45;
    this.placeSchool(-24, -9, 8, 1.4);
    let i = 0;
    for (const s of this.swimmers) {
      s.state = s.species === 'shark' ? 'patrol' : 'cruise';
      s.timer = 99;
      s.x = -30;
      s.y = -8;
      s.z = 8 + i * 1.4;
      i++;
    }
  }

  private shovePlants(x: number, z: number, radius: number): void {
    const r2 = radius * radius;
    this.scene.traverse((obj) => {
      if (obj.userData.baseY === undefined) return;
      const dx = obj.position.x - x;
      const dz = obj.position.z - z;
      if (dx * dx + dz * dz > r2) return;
      obj.position.x += dx >= 0 ? 12 : -12;
      obj.position.z += dz >= 0 ? 6 : -6;
    });
  }

  private swimmer(species: SpeciesId): Swimmer {
    const found = this.swimmers.find((s) => s.species === species);
    if (!found) throw new Error(species);
    return found;
  }

  private placeSchool(x: number, y: number, z: number, spread: number): void {
    const n = this.boids.length || 1;
    for (let i = 0; i < this.boids.length; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = spread * (0.35 + (i % 5) * 0.1);
      const b = this.boids[i];
      b.x = x + Math.cos(a) * r;
      b.y = y + ((i % 7) - 3) * 0.18;
      b.z = z + Math.sin(a) * r;
      b.vx = 0;
      b.vy = 0;
      b.vz = 0;
    }
    this.homeX = x;
    this.homeY = y;
    this.homeZ = z;
    this.baitX = x;
    this.baitY = y;
    this.baitZ = z;
  }

  private poseAll(): void {
    this.writeSchool();
    for (const s of this.swimmers) {
      s.mesh.visible = s.species === 'orca' ? this.orcaVisible : true;
      s.mesh.position.set(s.x, s.y, s.z);
      s.mesh.rotation.y = s.yaw;
      animateTail(s.mesh, this.t, s.species === 'manta' ? 1.6 : 6, s.phase);
    }
    this.octopus.position.set(this.octoX, this.octoY, this.octoZ);
    this.rebuildSnaps();
  }

  predatorDistance(x: number, y: number, z: number): number {
    let best = 999;
    for (const s of this.swimmers) {
      if (s.species !== 'shark' && !(s.species === 'orca' && this.orcaVisible)) continue;
      const d = Math.hypot(s.x - x, s.y - y, s.z - z);
      if (d < best) best = d;
    }
    return best;
  }

  private spawnCast(): void {
    const anemoneY = terrainHeight(LANDMARKS.anemone.x, LANDMARKS.anemone.z);
    for (let i = 0; i < 4; i++) {
      const mesh = makeFish({ length: 0.52, height: 0.3, color: 0xff6a1a, belly: 0xfff1dc, bands: 3 });
      mesh.traverse((obj) => {
        const mat = (obj as { material?: MeshLambertMaterial }).material;
        if (!mat?.emissive) return;
        mat.emissive.copy(mat.color);
        mat.emissiveIntensity = mat.color.getHex() === 0xf4f7f8 ? 0.2 : 0.62;
      });
      this.swimmers.push({
        mesh,
        species: 'clownfish',
        x: LANDMARKS.anemone.x,
        y: anemoneY + 0.8,
        z: LANDMARKS.anemone.z,
        yaw: i,
        state: 'hover',
        timer: i,
        speed: 0.6,
        radius: 0.34,
        optimal: 3.2,
        rarity: 12,
        dangerous: false,
        wps: [],
        wp: i,
        phase: i * 1.4,
      });
      this.scene.add(mesh);
    }

    const parrotWps: Array<[number, number, number]> = [
      [-12, 0, 14],
      [4, 0, 18],
      [16, 0, 26],
      [6, 0, 34],
      [-14, 0, 30],
      [-8, 0, 20],
    ];
    for (let i = 0; i < 5; i++) {
      const mesh = makeFish({ length: 0.85, height: 0.38, color: i % 2 ? 0x2fbfa0 : 0x3aa0d8, belly: 0xf2d35a });
      const wp = parrotWps[i % parrotWps.length];
      this.swimmers.push({
        mesh,
        species: 'parrotfish',
        x: wp[0],
        y: -6,
        z: wp[2],
        yaw: 0,
        state: 'cruise',
        timer: 0,
        speed: 1.15,
        radius: 0.42,
        optimal: 4,
        rarity: 13,
        dangerous: false,
        wps: parrotWps,
        wp: i % parrotWps.length,
        phase: i,
      });
      this.scene.add(mesh);
    }

    const turtleWps: Array<[number, number, number]> = [
      [-6, 0, 20],
      [10, 0, 24],
      [14, 0, 36],
      [-4, 0, 38],
    ];
    for (let i = 0; i < 2; i++) {
      const mesh = makeTurtle();
      const s: Swimmer = {
        mesh,
        species: 'turtle',
        x: turtleWps[i][0],
        y: -7 - i,
        z: turtleWps[i][2],
        yaw: 0.4,
        state: 'cruise',
        timer: i === 0 ? 8 : 999,
        speed: 1.05,
        radius: 0.85,
        optimal: 7,
        rarity: 16,
        dangerous: false,
        wps: turtleWps,
        wp: i,
        phase: i * 2,
      };
      this.swimmers.push(s);
      this.scene.add(mesh);
      if (i === 0) this.turtleA = s;
    }

    for (let i = 0; i < 2; i++) {
      const mesh = makeManta();
      this.swimmers.push({
        mesh,
        species: 'manta',
        x: i === 0 ? -6 : 12,
        y: -12 - i * 2,
        z: 30 + i * 8,
        yaw: 0,
        state: 'glide',
        timer: i * 3,
        speed: 1.6,
        radius: 1.35,
        optimal: 11,
        rarity: 18,
        dangerous: false,
        wps: [],
        wp: 0,
        phase: i * 2.2,
      });
      this.scene.add(mesh);
    }

    // Off the spawn lane (x ≈ 0–14, z ≈ 8–48) for the first 20 s. The reef shark
    // swims about 3–19 m: a midwater pass at 3 m, then the wall, down to about 19 m.
    // The trench shark rides the deep pocket (about x 4–24, z 50–76), from
    // roughly 27 m down to the floor near 41 m. A diver at 30 m or 36 m in that
    // pocket is on the route. Neither shark covers the whole map.
    const sharkWps: Array<Array<[number, number, number]>> = [
      [
        [-14, -3.6, 26],
        [-6, -7.5, 34],
        [22, -14, 34],
        [26, -15, 42],
        [16, -10, 28],
      ],
      [
        [12, -28, 50],
        [18, -32, 56],
        [18, -36, 62],
        [24, -38, 66],
        [16, -42, 74],
        [8, -35, 70],
        [4, -30, 64],
      ],
    ];
    sharkWps.forEach((wps, i) => {
      const mesh = makeShark();
      const s: Swimmer = {
        mesh,
        species: 'shark',
        x: wps[0][0],
        y: wps[0][1],
        z: wps[0][2],
        yaw: 0,
        state: 'patrol',
        timer: 0,
        speed: 2.1,
        radius: 1.45,
        optimal: 9,
        rarity: 20,
        dangerous: true,
        wps,
        wp: 0,
        phase: i,
      };
      this.swimmers.push(s);
      this.scene.add(mesh);
      if (i === 0) this.sharkA = s;
    });

    const orcaMesh = makeOrca();
    orcaMesh.visible = false;
    this.orca = {
      mesh: orcaMesh,
      species: 'orca',
      x: -40,
      y: -32,
      z: 64,
      yaw: Math.PI / 2,
      state: 'wait',
      timer: 0,
      speed: 4.4,
      radius: 1.35,
      optimal: 10,
      rarity: 25,
      dangerous: true,
      wps: [],
      wp: 0,
      phase: 0,
    };
    this.swimmers.push(this.orca);
    this.scene.add(orcaMesh);
  }

  private stepEvents(dt: number, diver: Vector3, out: SimEvent): void {
    if (this.bait === 'flock') {
      this.nextBait -= dt;
      if (this.nextBait <= 0) {
        this.bait = 'form';
        this.baitLeft = 6;
        this.baitX = clamp(diver.x * 0.35 + (Math.random() * 6 - 3), -14, 14);
        this.baitZ = clamp(Math.max(diver.z, 8) + 8, 18, 44);
        this.baitY = -8.2;
      }
    } else {
      this.baitLeft -= dt;
      if (this.bait === 'form' && this.baitLeft <= 0) {
        this.bait = 'charge';
        this.baitLeft = 3;
      } else if (this.bait === 'charge' && this.baitLeft <= 0) {
        this.bait = 'scatter';
        this.baitLeft = 8;
      } else if (this.bait === 'scatter' && this.baitLeft <= 0) {
        this.bait = 'flock';
        this.nextBait = 48;
      }
    }
    const schoolDist = Math.hypot(this.baitX - diver.x, this.baitY - (diver.y + 1), this.baitZ - diver.z);
    if (this.bait === 'scatter' && !this.baitTold && schoolDist < 16) {
      this.baitTold = true;
      out.baitStart = true;
    }
    if (this.bait !== 'scatter') this.baitTold = false;
  }

  private stepBoids(dt: number): void {
    const form = this.bait === 'form' || this.bait === 'charge';
    const scatter = this.bait === 'scatter';
    if (this.bait === 'flock') {
      this.homeX = Math.sin(this.t * 0.13) * 10;
      this.homeY = -8.2 + Math.sin(this.t * 0.21) * 1.2;
      this.homeZ = 30 + Math.cos(this.t * 0.11) * 7;
    } else {
      this.homeX = this.baitX;
      this.homeY = this.baitY;
      this.homeZ = this.baitZ;
    }
    const n = this.boids.length;
    const sharkX = this.sharkA ? this.sharkA.x : this.baitX;
    const sharkY = this.sharkA ? this.sharkA.y : this.baitY;
    const sharkZ = this.sharkA ? this.sharkA.z : this.baitZ;
    for (let i = 0; i < n; i++) {
      const b = this.boids[i];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let ax = 0;
      let ay = 0;
      let az = 0;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let cnt = 0;
      const rad = form ? 1.35 : 2.5;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const o = this.boids[j];
        const dx = b.x - o.x;
        const dy = b.y - o.y;
        const dz = b.z - o.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < rad * rad && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          if (d < (form ? 0.55 : 0.85)) {
            sx += dx / d;
            sy += dy / d;
            sz += dz / d;
          }
          ax += o.vx;
          ay += o.vy;
          az += o.vz;
          cx += o.x;
          cy += o.y;
          cz += o.z;
          cnt++;
        }
      }
      let fx = (this.homeX - b.x) * (form ? 1.7 : 0.32);
      let fy = (this.homeY - b.y) * (form ? 1.7 : 0.32);
      let fz = (this.homeZ - b.z) * (form ? 1.7 : 0.32);
      if (cnt > 0) {
        ax /= cnt;
        ay /= cnt;
        az /= cnt;
        cx = cx / cnt - b.x;
        cy = cy / cnt - b.y;
        cz = cz / cnt - b.z;
        const ali = form ? 0.45 : 0.85;
        const coh = form ? 1.5 : 0.5;
        fx += (ax - b.vx) * ali + cx * coh + sx * (form ? 0.55 : 1.35);
        fy += (ay - b.vy) * ali + cy * coh + sy * (form ? 0.55 : 1.35);
        fz += (az - b.vz) * ali + cz * coh + sz * (form ? 0.55 : 1.35);
      }
      if (scatter) {
        fx += (b.x - sharkX) * 1.8;
        fy += (b.y - sharkY) * 1.8;
        fz += (b.z - sharkZ) * 1.8;
      }
      const floor = terrainHeight(b.x, b.z);
      if (b.y > -2.2) fy -= 6;
      if (b.y < floor + 1.4) fy += 6;
      b.vx += fx * dt;
      b.vy += fy * dt;
      b.vz += fz * dt;
      const maxS = scatter ? 6.4 : form ? 2.3 : 2.7;
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      if (sp > maxS) {
        const k = maxS / sp;
        b.vx *= k;
        b.vy *= k;
        b.vz *= k;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.y = clamp(b.y, floor + 1.1, -1.8);
    }
  }

  private stepSwimmers(dt: number, diver: Vector3, aggro: boolean, events: boolean, out: SimEvent): void {
    for (const s of this.swimmers) {
      const ox = s.prevX;
      const oy = s.prevY;
      const oz = s.prevZ;
      const hadPrev = ox !== undefined && oy !== undefined && oz !== undefined;
      if (s.species === 'clownfish') {
        this.orbitClownfish(s, dt);
      } else if (s.species === 'parrotfish') {
        this.followWp(s, dt, 1.3);
        const floor = terrainHeight(s.x, s.z);
        s.y += (floor + 1.3 - s.y) * Math.min(1, dt * 2);
      } else if (s.species === 'turtle') {
        this.stepTurtle(s, dt, diver, events, out);
      } else if (s.species === 'manta') {
        const ang = this.t * 0.18 + s.phase;
        s.x = Math.sin(ang) * 16 + (s.phase < 1 ? -2 : 6);
        s.z = 34 + Math.sin(ang * 2) * 10;
        s.y = -12.5 + Math.sin(this.t * 0.3 + s.phase) * 1.6;
        s.yaw = Math.atan2(Math.cos(ang) * 16, Math.cos(ang * 2) * 20);
        const floor = terrainHeight(s.x, s.z);
        if (s.y < floor + 2) s.y = floor + 2;
      } else if (s.species === 'shark') {
        this.stepShark(s, dt, diver, aggro && events, out);
      } else if (s.species === 'orca') {
        this.stepOrca(s, dt, diver, events, out);
      }
      s.mesh.visible = s.species === 'orca' ? this.orcaVisible : true;
      s.mesh.position.set(s.x, s.y, s.z);
      s.mesh.rotation.y = s.yaw;
      const lively = s.species === 'shark' || s.species === 'orca' ? 0.07 : s.species === 'manta' ? 0.05 : 0.16;
      s.mesh.rotation.z = Math.sin(this.t * 5 + s.phase) * lively;
      s.mesh.rotation.x = Math.sin(this.t * 3.1 + s.phase) * lively * 0.55;
      const tail =
        s.species === 'manta' ? 2.4 : s.state === 'charge' ? 14 : s.state === 'warn' ? 10 : 7;
      animateTail(s.mesh, this.t, tail, s.phase);
      if (hadPrev) s.travel = Math.hypot(s.x - ox, s.y - oy, s.z - oz) / Math.max(dt, 1e-4);
      else s.travel = 0;
      s.prevX = s.x;
      s.prevY = s.y;
      s.prevZ = s.z;
    }
  }

  private stepTurtle(s: Swimmer, dt: number, diver: Vector3, events: boolean, out: SimEvent): void {
    const leader = s === this.turtleA;
    if (!leader || !events) {
      if (s.state !== 'cruise') s.state = 'cruise';
      this.followWp(s, dt, 1.15);
      const floor = terrainHeight(s.x, s.z);
      const target = clamp(floor + 2.4, -12, -4);
      s.y += (target - s.y) * Math.min(1, dt * 1.5);
      return;
    }
    if (s.state === 'cruise') {
      this.followWp(s, dt, 1.15);
      const floor = terrainHeight(s.x, s.z);
      s.y += (Math.max(floor + 2.2, -9) - s.y) * Math.min(1, dt);
      s.timer -= dt;
      if (s.timer <= 0) {
        s.state = 'up';
        s.timer = 0;
        this.turtleAimX = diver.x + 1.2;
        this.turtleAimZ = diver.z + 2.6;
      }
    } else if (s.state === 'up') {
      // Rise the whole way. Waiting until the turtle was already close left it
      // stuck in 'up' whenever the diver was not standing still.
      s.timer += dt;
      const dx = this.turtleAimX - s.x;
      const dz = this.turtleAimZ - s.z;
      const horiz = Math.hypot(dx, dz) || 1;
      if (horiz > 0.4) {
        const step = Math.min(horiz, 3.2 * dt);
        s.x += (dx / horiz) * step;
        s.z += (dz / horiz) * step;
        s.yaw = Math.atan2(dx, dz);
      }
      s.y += Math.min(2.1 * dt, Math.max(0, -0.5 - s.y));
      if (s.y > -0.85 && horiz < 5.5) {
        s.y = -0.55;
        s.state = 'breathe';
        s.timer = 10;
      } else if (s.timer > 9) {
        s.x = this.turtleAimX;
        s.z = this.turtleAimZ;
        s.y = -0.55;
        s.state = 'breathe';
        s.timer = 10;
      }
    } else if (s.state === 'breathe') {
      s.x = this.turtleAimX + Math.sin(this.t * 0.7) * 0.45;
      s.z = this.turtleAimZ + Math.cos(this.t * 0.45) * 0.3;
      s.y = -0.5 + Math.sin(this.t * 1.5) * 0.06;
      s.timer -= dt;
      if (s.timer <= 0) s.state = 'down';
    } else if (s.state === 'down') {
      s.y -= 1.7 * dt;
      const floor = terrainHeight(s.x, s.z);
      if (s.y <= Math.max(floor + 2.2, -9)) {
        s.state = 'cruise';
        s.timer = 34;
      }
    }
    const turtleDist = Math.hypot(s.x - diver.x, s.y - diver.y, s.z - diver.z);
    if (s.state === 'breathe' && !this.turtleTold && turtleDist < 24) {
      this.turtleTold = true;
      out.turtleStart = true;
    }
    if (s.state !== 'breathe') this.turtleTold = false;
  }

  /** Opening of a dive: sharks stay off the straight swim out from spawn. */
  private calmSpawn(): boolean {
    return this.t < 20;
  }

  /**
   * For the first 20 s both sharks are hidden. The reef shark is parked well
   * outside the spawn. The trench shark stays on its route but its mesh is off,
   * so looking down the trench from the start cannot lock it.
   */
  private applySpawnGrace(): void {
    for (const s of this.swimmers) {
      if (s.species !== 'shark') continue;
      if (!this.calmSpawn()) {
        s.mesh.visible = true;
        continue;
      }
      if (s === this.sharkA) {
        s.x = 36;
        s.y = -18;
        s.z = 72;
        s.mesh.position.set(s.x, s.y, s.z);
      }
      s.mesh.visible = false;
    }
  }

  private orbitClownfish(s: Swimmer, dt: number): void {
    const ox = s.prevX;
    const oy = s.prevY;
    const oz = s.prevZ;
    const hadPrev = ox !== undefined && oy !== undefined && oz !== undefined;
    const anchorY = terrainHeight(LANDMARKS.anemone.x, LANDMARKS.anemone.z) + 1.05;
    const w = this.t * 1.55 + s.phase;
    const rad = 0.9 + (s.wp % 3) * 0.22;
    s.x = LANDMARKS.anemone.x + Math.cos(w) * rad;
    s.z = LANDMARKS.anemone.z + Math.sin(w) * rad * 0.82;
    s.y = anchorY + Math.sin(w * 2) * 0.22;
    s.yaw = w + Math.PI / 2;
    if (hadPrev) s.travel = Math.hypot(s.x - ox, s.y - oy, s.z - oz) / Math.max(dt, 1e-4);
    else s.travel = 1.2;
    s.prevX = s.x;
    s.prevY = s.y;
    s.prevZ = s.z;
  }

  private keepOffLane(s: Swimmer, dt: number): void {
    if (!this.calmSpawn()) return;
    const inLane = s.x > -2 && s.x < 16 && s.z > 6 && s.z < 50;
    if (!inLane) return;
    const away = s.x >= 6.2 ? 22 : -14;
    s.x += (away - s.x) * Math.min(1, dt * 2.2);
  }

  /**
   * Turn on the ring captured when the warning began. The shark does not
   * follow a diver who sprints away, so that second of warning is real distance.
   */
  private holdCircle(s: Swimmer, dt: number): void {
    const a = this.orbitAnchor.get(s);
    if (!a) return;
    a.ang += dt * (3.4 / Math.max(6, a.radius));
    // A ring point on a shelf would lift the shark out of a deep pocket and
    // make the warning look like the diver got away. Stay at the diver's depth.
    let x = a.x + Math.cos(a.ang) * a.radius;
    let z = a.z + Math.sin(a.ang) * a.radius;
    let floor = terrainHeight(x, z);
    if (floor + 1.2 > a.y + 2.2) {
      for (let k = 1; k <= 6; k++) {
        const ang = a.ang + k * 0.55;
        const rad = a.radius * (k < 4 ? 1 : 0.62);
        const tx = a.x + Math.cos(ang) * rad;
        const tz = a.z + Math.sin(ang) * rad;
        const tf = terrainHeight(tx, tz);
        if (tf + 1.2 <= a.y + 2.2) {
          x = tx;
          z = tz;
          floor = tf;
          break;
        }
      }
    }
    s.x = x;
    s.z = z;
    const bob = Math.sin(this.t * 1.4) * 0.28;
    s.y = Math.min(-1.7, Math.max(floor + 1.2, a.y + bob));
    s.yaw = Math.atan2(a.x - s.x, a.z - s.z);
  }

  /** F burst this tick. A kick does not call this. */
  noteSprint(on: boolean): void {
    this.sprinting = on;
  }

  /** Yaw this physics step. Degrees turned while F is held add up for the whole warning. */
  noteHeading(yaw: number): void {
    if (this.yawReady && this.sprinting && this.sharkEngaged()) {
      let d = yaw - this.prevYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.escapeYaw += Math.abs(d);
      if (this.escapeYaw > (35 * Math.PI) / 180) this.escaped = true;
    }
    this.prevYaw = yaw;
    this.yawReady = true;
  }

  private sharkEngaged(): boolean {
    for (const s of this.swimmers) {
      if (s.species === 'shark' && (s.state === 'warn' || s.state === 'charge')) return true;
    }
    return false;
  }

  /** Lock a run at the diver. It keeps homing until it touches a diver who only drifts. */
  private commitCharge(s: Swimmer, dist: number): void {
    this.chargeDir.set(s, {
      x: 0,
      y: 0,
      z: 0,
      ox: s.x,
      oy: s.y,
      oz: s.z,
      start: dist,
      min: dist,
      stall: 0,
    });
    this.setShark(s, 'charge', dist, 12);
  }

  private setShark(s: Swimmer, next: string, dist: number, timer: number): void {
    if (this.sharkLog && s.state !== next) {
      console.info(`[shark] ${s.state} -> ${next} dist=${dist.toFixed(1)} t=${this.t.toFixed(1)}`);
    }
    if (next === 'warn' && s.state !== 'warn') {
      const other = this.swimmers.some(
        (o) => o !== s && o.species === 'shark' && (o.state === 'warn' || o.state === 'charge'),
      );
      if (!other) {
        this.escapeYaw = 0;
        this.escaped = false;
        this.fleeTold = false;
      }
    }
    s.state = next;
    s.timer = timer;
  }

  private noteFlee(out: SimEvent): void {
    if (!this.escaped || this.fleeTold) return;
    this.fleeTold = true;
    out.sharkFled = true;
  }

  private stepShark(s: Swimmer, dt: number, diver: Vector3, aggro: boolean, out: SimEvent): void {
    const scripted = s === this.sharkA && this.bait !== 'flock' && !this.calmSpawn();
    // `diver` is already the chest. An extra +1 m hid sharks that were plainly on screen.
    const dist = Math.hypot(s.x - diver.x, s.y - diver.y, s.z - diver.z);
    // Don't open a new warning on someone already at the surface.
    const surfaced = diver.y > -1.05;
    if (s.state === 'warn') out.sharkThreat = true;
    if (s.state === 'charge') out.sharkCharging = true;
    if (s.state === 'retreat') {
      s.timer -= dt;
      this.seek(s, s.x - Math.sin(s.yaw) * 4, s.y, s.z - Math.cos(s.yaw) * 4, 3.2, dt);
      this.keepOffLane(s, dt);
      if (s.timer <= 0) this.setShark(s, 'patrol', dist, 12);
      return;
    }
    if (s.state === 'warn') {
      s.timer -= dt;
      this.holdCircle(s, dt);
      const now = Math.hypot(s.x - diver.x, s.y - diver.y, s.z - diver.z);
      const horizNow = Math.hypot(s.x - diver.x, s.z - diver.z);
      // Kicking, drifting a few metres, or turning without F does not cancel.
      // Out of the ring horizontally, the warning simply ends.
      const turnDeg = (this.escapeYaw * 180) / Math.PI;
      if (this.escaped) {
        this.noteFlee(out);
        if (this.sharkLog) console.info(`[shark] warn abort sprint=true turn=${turnDeg.toFixed(0)} escaped=true`);
        this.setShark(s, 'patrol', now, 11);
      } else if (horizNow > 16) {
        if (this.sharkLog) console.info(`[shark] warn abort sprint=${this.sprinting} turn=${turnDeg.toFixed(0)} escaped=false horiz=${horizNow.toFixed(1)}`);
        this.setShark(s, 'patrol', now, 11);
      } else if (s.timer <= 0) {
        if (horizNow <= 14) {
          this.commitCharge(s, now);
          out.sharkCharge = true;
          out.sharkCharging = true;
        } else this.setShark(s, 'patrol', now, 12);
      }
      return;
    }
    if (s.state === 'charge') {
      // Home on the diver's current position. A shelf must not steer the shark
      // off to the side and leave it circling just outside the old hit radius.
      const aim = this.chargeDir.get(s);
      const speed = 3.6;
      const dx = diver.x - s.x;
      const dy = diver.y - s.y;
      const dz = diver.z - s.z;
      const horiz = Math.hypot(dx, dz) || 1;
      if (horiz > 0.2) {
        s.x += (dx / horiz) * speed * dt;
        s.z += (dz / horiz) * speed * dt;
      }
      const floor = terrainHeight(s.x, s.z);
      const room = floor + 1.05;
      const targetY = Math.max(room, Math.min(-0.9, diver.y));
      s.y += Math.sign(targetY - s.y) * Math.min(speed * dt, Math.abs(targetY - s.y));
      if (s.y < room) s.y = room;
      if (s.y > -0.85) s.y = -0.85;
      s.yaw = Math.atan2(dx, dz);
      if (aim) {
        aim.x = dx / horiz;
        aim.y = Math.sign(dy);
        aim.z = dz / horiz;
        const gap = Math.hypot(dx, dy, dz);
        if (gap < aim.min - 0.04) {
          aim.min = gap;
          aim.stall = 0;
        } else aim.stall += dt;
      }
      s.timer -= dt;
      const now = Math.hypot(s.x - diver.x, s.y - diver.y, s.z - diver.z);
      const horizLeft = Math.hypot(s.x - diver.x, s.z - diver.z);
      const vert = Math.abs(s.y - diver.y);
      // The latch is checked before the bite, so the frame the turn crosses 35° cannot still hit.
      const close = now < 3.5 || (horizLeft <= 3 && vert <= 5);
      const turnDeg = (this.escapeYaw * 180) / Math.PI;
      if (this.escaped) {
        this.noteFlee(out);
        if (this.sharkLog) console.info(`[shark] charge abort sprint=true turn=${turnDeg.toFixed(0)} escaped=true`);
        this.setShark(s, 'patrol', now, 12);
      } else if (close) {
        this.setShark(s, 'retreat', now, 4.5);
        out.hit = out.hit ?? 'shark';
      } else if (s.timer <= 0 || now > 22) {
        if (this.sharkLog) {
          console.info(`[shark] charge abort sprint=${this.sprinting} turn=${turnDeg.toFixed(0)} escaped=false now=${now.toFixed(1)}`);
        }
        this.setShark(s, 'patrol', now, 12);
      }
      return;
    }
    const horizDist = Math.hypot(s.x - diver.x, s.z - diver.z);
    const vertDist = Math.abs(s.y - diver.y);
    // Warn only when a charge from here can still catch a diver who does not move.
    if (aggro && !this.calmSpawn() && s.timer <= 0 && horizDist < 11.2 && vertDist < 18 && !surfaced) {
      const ang = Math.atan2(s.z - diver.z, s.x - diver.x);
      this.orbitAnchor.set(s, {
        x: diver.x,
        y: diver.y,
        z: diver.z,
        radius: clamp(horizDist, 6.2, 11.2),
        ang,
      });
      this.setShark(s, 'warn', dist, 1.05);
      out.sharkWarn = true;
      out.sharkThreat = true;
      this.holdCircle(s, dt);
      return;
    }
    if (scripted) {
      const tx = this.baitX + (this.bait === 'scatter' ? 8 : 0);
      const speed = this.bait === 'charge' ? 7.2 : 3.4;
      this.seek(s, tx, this.baitY, this.baitZ, speed, dt);
      return;
    }
    s.timer = Math.max(0, s.timer - dt);
    this.followWp(s, dt, 2.0);
    this.keepOffLane(s, dt);
    const floor = terrainHeight(s.x, s.z);
    if (s.y < floor + 1.8) s.y = floor + 1.8;
  }

  private stepOrca(s: Swimmer, dt: number, diver: Vector3, events: boolean, out: SimEvent): void {
    if (!events) {
      this.orcaVisible = false;
      return;
    }
    if (!this.orcaVisible) {
      this.orcaWait -= dt;
      if (this.orcaWait <= 0) {
        this.orcaVisible = true;
        this.passX = -40;
        this.orcaHit = false;
        this.orcaTold = false;
      }
      return;
    }
    this.passX += 4.6 * dt;
    s.x = this.passX;
    s.z = 64 + Math.sin(this.passX * 0.05) * 2.5;
    const floor = terrainHeight(s.x, s.z);
    s.y = Math.max(floor + 3.2, -34);
    s.yaw = Math.PI / 2;
    const dist = Math.hypot(s.x - diver.x, s.y - (diver.y + 1), s.z - diver.z);
    if (!this.orcaHit && dist < 4.6) {
      this.orcaHit = true;
      out.hit = out.hit ?? 'orca';
    }
    if (!this.orcaTold && dist < 24 && this.passX > -32 && this.passX < 32) {
      this.orcaTold = true;
      out.orcaStart = true;
    }
    if (this.passX > 36) {
      this.orcaVisible = false;
      this.orcaWait = 50;
      this.orcaTold = false;
    }
  }

  private followWp(s: Swimmer, dt: number, speed: number): void {
    const wp = s.wps[s.wp];
    if (!wp) return;
    const floor = terrainHeight(wp[0], wp[2]);
    // Ride above the sand. A waypoint buried in the floor would never count as reached.
    const ty = Math.max(wp[1] === 0 ? floor + 1.6 : wp[1], floor + 1.8);
    const dx = wp[0] - s.x;
    const dy = ty - s.y;
    const dz = wp[2] - s.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1.4) {
      s.wp = (s.wp + 1) % s.wps.length;
      return;
    }
    this.seek(s, wp[0], ty, wp[2], speed, dt);
  }

  private seek(s: Swimmer, x: number, y: number, z: number, speed: number, dt: number): void {
    const dx = x - s.x;
    const dy = y - s.y;
    const dz = z - s.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    s.x += (dx / d) * speed * dt;
    s.y += (dy / d) * speed * dt;
    s.z += (dz / d) * speed * dt;
    const yaw = Math.atan2(dx, dz);
    const turn = Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw));
    s.yaw += turn * Math.min(1, dt * 3);
    const floor = terrainHeight(s.x, s.z);
    if (s.y < floor + 1.2) s.y = floor + 1.2;
    if (s.y > -1.7 && s.species !== 'turtle') s.y = -1.7;
  }

  /** Surface the lead turtle just in front of the diver and hold the breath. */
  startBreathInFront(x: number, z: number): { x: number; y: number; z: number } {
    const s = this.turtleA;
    s.state = 'breathe';
    s.timer = 10;
    s.x = x + 1.3;
    s.y = -0.55;
    s.z = z + 2.6;
    s.yaw = Math.atan2(x - s.x, z - s.z);
    this.turtleAimX = s.x;
    this.turtleAimZ = s.z;
    this.turtleTold = false;
    s.mesh.visible = true;
    s.mesh.position.set(s.x, s.y, s.z);
    return { x: s.x, y: s.y, z: s.z };
  }

  private stepOctopus(dt: number, diver: Vector3, out: SimEvent): void {
    // Six seconds of colour in the open, then a still pose clear of the crevice rocks.
    // The idle pose does not drift, so a viewfinder can lock a stationary animal.
    const cycle = this.t % 18;
    this.displaying = cycle > 12;
    const homeX = LANDMARKS.octopus.x + 2.35;
    const homeZ = LANDMARKS.octopus.z - 1.15;
    const showX = homeX + 0.7;
    const showZ = homeZ + 0.15;
    if (!this.displaying) {
      this.octoX = homeX;
      this.octoZ = homeZ;
      this.octoY = terrainHeight(homeX, homeZ) + 1.15;
    } else {
      const floor = terrainHeight(showX, showZ);
      const blend = Math.min(1, dt * 2.2);
      this.octoX += (showX - this.octoX) * blend;
      this.octoY += (floor + 1.35 - this.octoY) * blend;
      this.octoZ += (showZ - this.octoZ) * blend;
    }
    const color = this.displaying ? OCTO_SHOW[Math.floor(this.t / 0.85) % OCTO_SHOW.length] : 0x5a463c;
    this.octopus.userData.displayColor = color;
    const bodyMat = this.octopus.userData.bodyMat as MeshLambertMaterial | undefined;
    if (bodyMat) {
      bodyMat.emissive.setHex(this.displaying ? color : 0x000000);
      bodyMat.emissiveIntensity = this.displaying ? 0.85 : 0;
    }
    // A resting octopus does not wave its arms or yaw. The colour show is the animation.
    animateTail(this.octopus, this.displaying ? this.t : 0, this.displaying ? 1.4 : 0, 0);
    if (!this.displaying) {
      const legs = this.octopus.userData.legs as Group[] | undefined;
      legs?.forEach((leg) => {
        leg.rotation.x = 0.12;
      });
    }
    this.octopus.position.set(this.octoX, this.octoY, this.octoZ);
    this.octopus.rotation.y = this.displaying ? Math.sin(this.t * 0.6) * 0.4 : 0.35;
    const dist = Math.hypot(this.octoX - diver.x, this.octoY - diver.y, this.octoZ - diver.z);
    if (this.displaying && !this.octoTold && dist < 16) {
      this.octoTold = true;
      out.octopusStart = true;
    }
    if (!this.displaying) this.octoTold = false;
  }

  private writeSchool(): void {
    for (let i = 0; i < this.boids.length; i++) {
      const b = this.boids[i];
      const yaw = Math.atan2(b.vx, b.vz);
      const wag = Math.sin(this.t * 8 + i * 0.7) * 0.55;
      this.dummy.position.set(b.x, b.y, b.z);
      this.dummy.rotation.set(Math.sin(this.t * 6 + i) * 0.18, yaw, Math.sin(this.t * 7 + i) * 0.22);
      const sc = 0.85 + (i % 5) * 0.04;
      this.dummy.scale.setScalar(sc);
      this.dummy.updateMatrix();
      this.school.setMatrixAt(i, this.dummy.matrix);
      const back = 0.16;
      this.dummy.position.set(b.x - Math.sin(yaw) * back, b.y, b.z - Math.cos(yaw) * back);
      this.dummy.rotation.set(0, yaw + wag, Math.sin(this.t * 8 + i) * 0.35);
      this.dummy.scale.setScalar(sc);
      this.dummy.updateMatrix();
      this.schoolTail.setMatrixAt(i, this.dummy.matrix);
    }
    this.school.instanceMatrix.needsUpdate = true;
    this.schoolTail.instanceMatrix.needsUpdate = true;
  }

  /** A stroke, a turn, a chase, or a feeding pass. A frozen or hovering pose does not count. */
  private swimmerActing(s: Swimmer): boolean {
    if (s.species === 'turtle' && s.state === 'breathe') return true;
    if (s.state === 'charge' || s.state === 'warn' || s.state === 'retreat') return true;
    // A glide is the manta's whole behavior. It counts as motion even when the
    // step is small, as long as the cast is not frozen for a debug pose.
    if (s.species === 'manta' && this.debugLock <= 0) return true;
    if (this.debugLock > 0 && s.species !== 'clownfish') return false;
    return (s.travel ?? 0) > 0.28;
  }

  private rebuildSnaps(): void {
    this.snaps.length = 0;
    const scatter = this.bait === 'scatter';
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const b of this.boids) {
      sx += b.x;
      sy += b.y;
      sz += b.z;
    }
    const n = this.boids.length || 1;
    sx /= n;
    sy /= n;
    sz /= n;
    let spread = 0;
    let member = 0;
    for (const b of this.boids) {
      spread += Math.hypot(b.x - sx, b.y - sy, b.z - sz);
      member = Math.max(member, Math.hypot(b.vx, b.vy, b.vz));
    }
    spread /= n;
    const dt = Math.max(0.001, this.t - this.schoolT);
    const centroid = this.schoolReady ? Math.hypot(sx - this.schoolPx, sy - this.schoolPy, sz - this.schoolPz) / dt : 0;
    this.schoolPx = sx;
    this.schoolPy = sy;
    this.schoolPz = sz;
    this.schoolT = this.t;
    this.schoolReady = true;
    const schoolMoving = this.debugLock <= 0 && (centroid > 0.28 || member > 0.28);
    this.snaps.push({
      species: 'sardine',
      rarity: 14,
      x: sx,
      y: sy,
      z: sz,
      radius: clamp(spread * 0.9, 1.15, 3.1),
      optimal: 8.5,
      moment: scatter ? 'baitball' : null,
      dangerous: false,
      acting: schoolMoving,
    });
    for (const b of this.boids) {
      const own = Math.hypot(b.vx, b.vy, b.vz) > 0.28;
      this.snaps.push({
        species: 'sardine',
        rarity: 10,
        x: b.x,
        y: b.y,
        z: b.z,
        radius: 0.18,
        optimal: 2.1,
        moment: scatter ? 'baitball' : null,
        dangerous: false,
        acting: this.debugLock <= 0 && (schoolMoving || own),
      });
    }
    for (const s of this.swimmers) {
      if (s.species === 'orca' && !this.orcaVisible) continue;
      if (s.species === 'shark' && (!s.mesh.visible || this.calmSpawn())) continue;
      let moment: MomentId | null = null;
      if (s.species === 'turtle' && s.state === 'breathe') moment = 'turtleBreath';
      if (s.species === 'shark' && s === this.sharkA && scatter) moment = 'baitball';
      if (s.species === 'orca' && this.orcaVisible && this.passX > -28 && this.passX < 30) moment = 'orcaPass';
      this.snaps.push({
        species: s.species,
        rarity: s.rarity,
        x: s.x,
        y: s.y + (s.species === 'turtle' ? 0.3 : 0),
        z: s.z,
        radius: s.radius,
        optimal: s.optimal,
        moment,
        dangerous: s.dangerous,
        acting: this.swimmerActing(s),
      });
    }
    this.snaps.push({
      species: 'octopus',
      rarity: this.displaying ? 25 : 18,
      x: this.octoX,
      y: this.octoY + 0.4,
      z: this.octoZ,
      radius: 1.05,
      optimal: 4.2,
      moment: null,
      dangerous: false,
      acting: this.displaying,
    });
  }

  private buildSchool(): InstancedMesh {
    const color = new Color(0xd5dee8);
    const geo = mergeParts([
      { geo: UNIT.sphere, matrix: M(0, 0, 0.04, 0, 0, 0, 0.045, 0.04, 0.14), color },
      { geo: UNIT.sphere, matrix: M(0, 0.01, -0.1, 0, 0, 0, 0.012, 0.055, 0.05), color },
    ]);
    const mat = new MeshLambertMaterial({ color: 0xd5dee8, flatShading: true });
    const mesh = new InstancedMesh(geo, mat, 56);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const m = new Matrix4();
    for (let i = 0; i < 56; i++) mesh.setMatrixAt(i, m);
    return mesh;
  }

  private buildSchoolTail(): InstancedMesh {
    const color = new Color(0xc5d0dc);
    const geo = mergeParts([{ geo: UNIT.sphere, matrix: M(0, 0, 0, 0, 0, 0, 0.01, 0.045, 0.07), color }]);
    const mat = new MeshLambertMaterial({ color: 0xc5d0dc, flatShading: true });
    const mesh = new InstancedMesh(geo, mat, 56);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const m = new Matrix4();
    for (let i = 0; i < 56; i++) mesh.setMatrixAt(i, m);
    return mesh;
  }
}
