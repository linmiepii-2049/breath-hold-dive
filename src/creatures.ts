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
}

export interface SimEvent {
  hit: 'shark' | 'orca' | null;
  baitStart: boolean;
  turtleStart: boolean;
  orcaStart: boolean;
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
  private chargeHit = false;
  private orcaHit = false;
  private orcaTold = false;
  private baitTold = false;
  private turtleTold = false;
  private orcaWait = 24;
  private passX = -40;
  private debugLock = 0;
  private debugOcto = false;

  constructor(scene: Scene) {
    this.scene = scene;
    this.school = this.buildSchool();
    scene.add(this.school);
    this.octopus = makeOctopus();
    scene.add(this.octopus);
    this.reset();
  }

  reset(): void {
    this.t = 0;
    this.bait = 'flock';
    this.nextBait = 18;
    this.baitLeft = 0;
    this.chargeHit = false;
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

  /**
   * Freeze the cast and place one animal, or one special moment, in front of a photo spot.
   * Only called from the ?debug=1 panel.
   */
  debugTrigger(id: string): { x: number; y: number; z: number; yaw: number; lookX: number; lookY: number; lookZ: number } {
    this.debugLock = 22;
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
      const x = -16;
      const z = 14;
      const y = terrainHeight(x, z) + 1.9;
      let i = 0;
      for (const s of this.swimmers) {
        if (s.species !== 'clownfish') continue;
        if (i === 0) {
          s.x = x;
          s.y = y;
          s.z = z;
          s.yaw = Math.PI / 2 + 0.45;
        } else {
          s.x = x - 1.1;
          s.y = y + (i - 2) * 0.28;
          s.z = z + 1.1;
          s.yaw = Math.PI / 2;
        }
        i++;
      }
      this.shovePlants(x, z, 9);
      const camZ = z - 2.4;
      const camFloor = terrainHeight(x, camZ);
      const feetY = Math.min(BOUNDS.surfaceFeet, Math.max(camFloor + 0.2, y - 1.7));
      this.poseAll();
      return { x, y: feetY, z: camZ, yaw: 0, lookX: x, lookY: y + 0.12, lookZ: z };
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
    const out: SimEvent = { hit: null, baitStart: false, turtleStart: false, orcaStart: false };
    if (this.debugLock > 0) {
      this.debugLock = Math.max(0, this.debugLock - dt);
      if (this.debugOcto) {
        this.displaying = true;
        this.octopus.rotation.y = Math.PI;
        this.octopus.userData.displayColor = OCTO_SHOW[Math.floor(this.t * 1.4) % OCTO_SHOW.length];
        animateTail(this.octopus, this.t, 1.4, 0);
      }
      this.poseAll();
      return out;
    }
    if (events) this.stepEvents(dt, diver, out);
    this.stepBoids(dt);
    this.stepSwimmers(dt, diver, aggro, events, out);
    this.stepOctopus();
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
      const mesh = makeFish({ length: 0.36, height: 0.2, color: 0xff6a1a, bands: 3 });
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
        radius: 0.22,
        optimal: 2.3,
        rarity: 10,
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
        rarity: 11,
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
        timer: i === 0 ? 16 : 999,
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

    const sharkWps: Array<Array<[number, number, number]>> = [
      [
        [-18, -8, 18],
        [16, -9, 22],
        [20, -12, 36],
        [-8, -10, 34],
      ],
      [
        [6, -16, 48],
        [22, -20, 58],
        [8, -18, 70],
        [-8, -14, 56],
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
        this.chargeHit = false;
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
      if (s.species === 'clownfish') {
        const anchorY = terrainHeight(LANDMARKS.anemone.x, LANDMARKS.anemone.z) + 0.85;
        const ang = this.t * 0.85 + s.phase;
        s.x = LANDMARKS.anemone.x + Math.cos(ang) * (0.55 + s.wp * 0.18);
        s.z = LANDMARKS.anemone.z + Math.sin(ang * 1.3) * 0.7;
        s.y = anchorY + Math.sin(this.t * 2 + s.phase) * 0.2;
        s.yaw = ang + Math.PI / 2;
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
      animateTail(s.mesh, this.t, s.species === 'manta' ? 1.6 : 6, s.phase);
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
      if (s.timer <= 0) s.state = 'up';
    } else if (s.state === 'up') {
      s.y += 2.15 * dt;
      s.yaw += dt * 0.15;
      if (s.y > -0.7) {
        s.state = 'breathe';
        s.timer = 5.4;
        s.y = -0.55;
      }
    } else if (s.state === 'breathe') {
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
    const turtleDist = Math.hypot(s.x - diver.x, s.y - (diver.y + 1), s.z - diver.z);
    if (s.state === 'breathe' && !this.turtleTold && turtleDist < 12) {
      this.turtleTold = true;
      out.turtleStart = true;
    }
    if (s.state !== 'breathe') this.turtleTold = false;
  }

  private stepShark(s: Swimmer, dt: number, diver: Vector3, aggro: boolean, out: SimEvent): void {
    const scripted = s === this.sharkA && this.bait !== 'flock';
    const dist = Math.hypot(s.x - diver.x, s.y - (diver.y + 1), s.z - diver.z);
    if (scripted) {
      const tx = this.baitX + (this.bait === 'scatter' ? 8 : 0);
      const speed = this.bait === 'charge' ? 7.2 : 3.4;
      this.seek(s, tx, this.baitY, this.baitZ, speed, dt);
      if (this.bait === 'charge' && !this.chargeHit && dist < 2.55) {
        this.chargeHit = true;
        out.hit = 'shark';
        s.state = 'retreat';
        s.timer = 3;
      }
      return;
    }
    if (s.state === 'retreat') {
      s.timer -= dt;
      this.seek(s, s.x - Math.sin(s.yaw) * 4, s.y, s.z - Math.cos(s.yaw) * 4, 3.2, dt);
      if (s.timer <= 0) {
        s.state = 'patrol';
        s.timer = 7;
      }
      return;
    }
    if (s.state === 'chase') {
      this.seek(s, diver.x, diver.y + 1, diver.z, 5.3, dt);
      if (dist < 2.45) {
        s.state = 'retreat';
        s.timer = 3.2;
        out.hit = out.hit ?? 'shark';
      } else if (dist > 16) {
        s.state = 'patrol';
        s.timer = 5;
      }
      return;
    }
    s.timer = Math.max(0, s.timer - dt);
    this.followWp(s, dt, 2.2);
    const floor = terrainHeight(s.x, s.z);
    if (s.y < floor + 1.8) s.y = floor + 1.8;
    if (aggro && s.timer <= 0 && dist < 6.4) s.state = 'chase';
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
    const ty = wp[1] === 0 ? floor + 1.6 : wp[1];
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

  private stepOctopus(): void {
    const cycle = this.t % 9;
    this.displaying = cycle > 3;
    const color = this.displaying ? OCTO_SHOW[Math.floor(this.t / 0.85) % OCTO_SHOW.length] : 0x6a5348;
    this.octopus.userData.displayColor = color;
    animateTail(this.octopus, this.t, 1.4, 0);
    this.octopus.position.set(this.octoX, this.octoY, this.octoZ);
    this.octopus.rotation.y = Math.sin(this.t * 0.2) * 0.4;
  }

  private writeSchool(): void {
    for (let i = 0; i < this.boids.length; i++) {
      const b = this.boids[i];
      this.dummy.position.set(b.x, b.y, b.z);
      this.dummy.rotation.set(0, Math.atan2(b.vx, b.vz), 0);
      const sc = 0.85 + (i % 5) * 0.04;
      this.dummy.scale.setScalar(sc);
      this.dummy.updateMatrix();
      this.school.setMatrixAt(i, this.dummy.matrix);
    }
    this.school.instanceMatrix.needsUpdate = true;
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
    for (const b of this.boids) spread += Math.hypot(b.x - sx, b.y - sy, b.z - sz);
    spread /= n;
    this.snaps.push({
      species: 'sardine',
      rarity: 12,
      x: sx,
      y: sy,
      z: sz,
      radius: clamp(spread * 0.9, 1.15, 3.1),
      optimal: 8.5,
      moment: scatter ? 'baitball' : null,
      dangerous: false,
    });
    for (const b of this.boids) {
      this.snaps.push({
        species: 'sardine',
        rarity: 8,
        x: b.x,
        y: b.y,
        z: b.z,
        radius: 0.18,
        optimal: 2.1,
        moment: scatter ? 'baitball' : null,
        dangerous: false,
      });
    }
    for (const s of this.swimmers) {
      if (s.species === 'orca' && !this.orcaVisible) continue;
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
      });
    }
    this.snaps.push({
      species: 'octopus',
      rarity: this.displaying ? 25 : 18,
      x: this.octoX,
      y: this.octoY + 0.4,
      z: this.octoZ,
      radius: 0.85,
      optimal: 4.2,
      moment: null,
      dangerous: false,
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
}
