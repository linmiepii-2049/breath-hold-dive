import {
  ACESFilmicToneMapping,
  CircleGeometry,
  FogExp2,
  Matrix4,
  Mesh,
  Object3D,
  Raycaster,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { AudioBus } from './audio';
import {
  BALANCE,
  buoyancyAccel,
  focalMm,
  headAtSurface,
  maxOxygen,
  o2Drain,
} from './balance';
import { OceanLife, type SimEvent } from './creatures';
import { setLang, t } from './i18n';
import { animateDiver, makeDiver, tintDiver } from './models';
import { scoreFrame, type FrameSubject, type ScoreBreakdown } from './scoring';
import { albumReplaces, defaultSave, loadSave, writeSave, type SaveData } from './save';
import { clampDiver, depthMeters, terrainHeight } from './terrain';
import {
  createApnea,
  createBreath,
  forceFinishApnea,
  forceFinishBreath,
  stepApnea,
  stepBreath,
  type ApneaState,
  type BreathPhase,
  type BreathState,
} from './training';
import type { CommentId, GearId, Lang } from './types';
import { GameUI, type UIModel } from './ui';
import { clamp, lerpAngle } from './util';
import { createWorld, moveSnell, type World } from './world';

interface Shot {
  dataUrl: string;
  score: ScoreBreakdown;
}

interface Bubble {
  mesh: Mesh;
  life: number;
  vx: number;
  vy: number;
  vz: number;
}

interface Toast {
  key: string;
  ttl: number;
}

export class Game {
  private save: SaveData;
  private ui: GameUI;
  private audio = new AudioBus();
  private renderer: WebGLRenderer;
  private scene: Scene;
  private world: World;
  private life: OceanLife;
  private cam: PerspectiveCamera;
  private fpCam: PerspectiveCamera;
  private diver: ReturnType<typeof makeDiver>;
  private shadow: Mesh;
  private shotRts: WebGLRenderTarget[] = [];
  private shotRtBusy: boolean[] = [];
  private bubbles: Bubble[] = [];
  private fpsOn = false;
  private debugOn = false;
  private fpsShown = 0;
  private fpsSmooth = 60;
  private fpsTick = 0;
  private pendingShots = 0;
  private wantJudge = false;
  private wantJudgeAt = 0;

  private mode: UIModel['mode'] = 'shore';
  private nonce = 1;
  private time = 0;
  private last = 0;
  /** Leftover wall time waiting for the next 1/60 s physics step. */
  private accum = 0;
  private debugLogT = 0;
  private pushedKind = new Set<string>();
  private resetArmed = false;

  private keys = new Set<string>();
  private just = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  private lmb = false;
  private pad: BreathPhase | null = null;
  private holdPointer = false;
  private kickQueued = false;
  private spaceDown = false;
  private spaceHold = 0;
  private strokeWait = 0;
  private strokePhase = 0;
  private sprintLatched = false;
  private sharkThreat = false;
  private needsSteer = false;
  private relockUntil = 0;

  private feet = new Vector3(1.4, 1, -3);
  private camPos = new Vector3();
  private velX = 0;
  private velY = 0;
  private velZ = 0;
  private camYaw = 0.4;
  private camPitch = -0.18;
  private viewYaw = 0;
  private viewPitch = -0.18;
  private look = new Vector3();
  private bodyRight = new Vector3();
  private bodyBelly = new Vector3();
  private bodyBasis = new Matrix4();
  private fov = 48;
  private viewfinder = false;

  private o2 = 100;
  private stamina = 100;
  private filmLeft: number = BALANCE.film;
  private photos: Shot[] = [];
  private fines = 0;
  private burstT = 0;
  private burstCd = 0;
  private forcedT = 0;
  private invuln = 0;
  private lockSurface = false;
  private blackout = false;
  private shake = 0;
  private paused = false;
  private shotCd = 0;
  private flash = 0;
  private surfaceHold = 0;
  private toasts: Toast[] = [];

  private breath: BreathState | null = null;
  private apnea: ApneaState | null = null;
  private judgePhase: UIModel['judgePhase'] = 'review';
  private judgeIndex = 0;
  private gross = 0;
  private net = 0;
  private committed = false;
  private renderFailed = false;

  private forward = new Vector3();
  private proj = new Vector3();
  private rayDir = new Vector3();
  private ray = new Raycaster();
  private occluders: Object3D[] = [];

  constructor(private canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.save = loadSave();
    setLang(this.save.lang);
    document.documentElement.lang = this.save.lang === 'zh' ? 'zh-CN' : 'en';
    this.audio.setMuted(this.save.muted);

    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    this.world = createWorld();
    this.scene = this.world.scene;
    this.scene.traverse((obj) => {
      if ((obj as Mesh).isMesh && obj.userData.occluder) this.occluders.push(obj);
    });
    this.life = new OceanLife(this.scene);
    this.diver = makeDiver();
    tintDiver(this.diver, this.save.gear.suit, this.save.gear.fins);
    this.scene.add(this.diver);
    this.shadow = new Mesh(
      new CircleGeometry(0.7, 14),
      new MeshBasicMaterial({ color: 0x021016, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);
    this.initBubbles();

    this.cam = new PerspectiveCamera(48, 1, 0.12, 280);
    this.fpCam = new PerspectiveCamera(46, 1, 0.08, 140);
    this.fpCam.rotation.order = 'YXZ';

    const params = new URLSearchParams(location.search);
    this.fpsOn = params.get('fps') === '1';
    this.debugOn = params.get('debug') === '1';
    this.life.setDebug(this.debugOn);

    this.ui = new GameUI(uiRoot, {
      dive: () => this.beginDive(),
      train: () => this.open('train'),
      shop: () => this.open('shop'),
      album: () => this.open('album'),
      back: () => this.open('shore'),
      lang: (lang) => this.setLanguage(lang),
      mute: () => this.toggleMute(),
      reset: () => this.resetProgress(),
      startBreath: () => this.startBreath(),
      startApnea: () => this.startApnea(),
      finishTrain: () => this.finishTrain(),
      pad: (phase) => {
        this.pad = phase;
      },
      hold: (down) => {
        this.holdPointer = down;
      },
      buy: (id) => this.buy(id),
      resume: () => {
        if (this.mode !== 'dive') {
          this.paused = false;
          return;
        }
        const lock = this.canvas.requestPointerLock();
        void Promise.resolve(lock).catch(() => {});
      },
      sens: (value) => {
        this.save.lookSens = clamp(value, 0.45, 2.1);
        writeSave(this.save);
      },
      submit: () => this.submit(),
      nextCard: () => this.nextCard(),
      shore: () => this.open('shore'),
      debug: (id) => this.debugGo(id),
    });

    this.bindInput();
    this.placeDiverShore();
    this.shoreCamera(0);
  }

  start(): void {
    this.last = performance.now();
    this.resize();
    window.addEventListener('resize', this.resize);
    requestAnimationFrame(this.frame);
  }

  beginDive(): void {
    this.resetArmed = false;
    this.mode = 'dive';
    this.nonce++;
    this.o2 = maxOxygen(this.save.lung);
    this.stamina = 100;
    this.filmLeft = BALANCE.film;
    this.photos = [];
    this.fines = 0;
    this.gross = 0;
    this.net = 0;
    this.committed = false;
    this.blackout = false;
    this.lockSurface = false;
    this.forcedT = 0;
    this.invuln = BALANCE.grace;
    this.burstT = 0;
    this.burstCd = 0;
    this.spaceDown = false;
    this.spaceHold = 0;
    this.strokeWait = 0;
    this.strokePhase = 0;
    this.sprintLatched = false;
    this.sharkThreat = false;
    this.paused = false;
    this.needsSteer = false;
    this.unlockedAt = 0;
    this.viewfinder = false;
    this.shake = 0;
    this.shotCd = 0;
    this.surfaceHold = 0;
    this.pushedKind.clear();
    this.judgePhase = 'review';
    this.judgeIndex = 0;
    const range = BALANCE.lensFov[this.save.gear.lens];
    this.fov = (range[0] + range[1]) / 2;
    this.feet.set(6.2, -3.8, 9);
    this.viewYaw = 0.15;
    this.viewPitch = -0.18;
    this.camYaw = 0.15;
    this.camPitch = -0.18;
    this.velX = 0;
    this.velY = 0;
    this.velZ = 0;
    this.life.reset();
    this.poseDiver(false, false);
    this.snapFollow();
    this.emitBubbles(this.feet.x, this.feet.y + 1.2, this.feet.z, 8);
    this.audio.bubbles();
    this.pushToast('toast.descend');
    const lock = this.canvas.requestPointerLock();
    void Promise.resolve(lock).catch(() => {
      if (this.life.framing() || this.mode !== 'dive' || this.wantJudge) return;
      if (!document.pointerLockElement) this.holdForSteer();
    });
  }

  /** Dev-only aiming aid used by the playtest. Not wired to the UI. */
  debugTeleport(x: number, y: number, z: number, yaw: number, pitch?: number, o2?: number): void {
    this.feet.set(x, y, z);
    this.viewYaw = yaw;
    this.camYaw = yaw;
    this.velX = 0;
    this.velY = 0;
    this.velZ = 0;
    if (pitch !== undefined) {
      this.viewPitch = pitch;
      this.camPitch = pitch;
    }
    if (o2 !== undefined) this.o2 = o2;
    this.paused = false;
    this.needsSteer = false;
    this.poseDiver(false, false);
    this.snapFollow();
  }

  debugAim(yaw: number, pitch: number, fov: number): void {
    this.viewfinder = true;
    this.viewYaw = yaw;
    this.camYaw = yaw;
    this.viewPitch = pitch;
    this.camPitch = pitch;
    this.fov = fov;
    this.syncView();
  }

  debugState(): {
    yaw: number;
    camYaw: number;
    pitch: number;
    camPitch: number;
    viewfinder: boolean;
    fov: number;
    film: number;
    x: number;
    y: number;
    z: number;
    o2: number;
    vy: number;
    paused: boolean;
  } {
    return {
      yaw: this.viewYaw,
      camYaw: this.camYaw,
      pitch: this.viewPitch,
      camPitch: this.camPitch,
      viewfinder: this.viewfinder,
      fov: this.fov,
      film: this.filmLeft,
      x: this.feet.x,
      y: this.feet.y,
      z: this.feet.z,
      o2: this.o2,
      vy: this.velY,
      paused: this.paused,
    };
  }

  debugShoot(): void {
    this.syncView();
    this.shoot(this.grade(this.project(this.fpCam)));
  }

  debugRoster(): { species: string[]; moments: string[] } {
    const species = new Set<string>();
    const moments = new Set<string>();
    for (const s of this.life.snaps) {
      species.add(s.species);
      if (s.moment) moments.add(s.moment);
    }
    return { species: [...species], moments: [...moments] };
  }

  debugSkip(seconds: number): void {
    const step = 0.05;
    const diver = new Vector3(this.feet.x, this.feet.y + 1, this.feet.z);
    for (let left = seconds; left > 0; left -= step) this.life.update(step, diver, true, true);
  }

  private frame = (now: number): void => {
    if (this.last === 0) {
      this.last = now;
      requestAnimationFrame(this.frame);
      return;
    }
    const wall = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    if (wall > 0) {
      this.fpsSmooth += (1 / wall - this.fpsSmooth) * 0.08;
      this.fpsTick += wall;
      if (this.fpsTick >= 0.25) {
        this.fpsTick = 0;
        this.fpsShown = Math.round(this.fpsSmooth);
      }
    }
    // Catch up in fixed 1/60 s steps. A hitch can cost at most a quarter second.
    const frameDt = Math.min(0.25, wall);
    this.time += frameDt;

    if (this.wantJudge && this.mode === 'dive' && (this.pendingShots === 0 || performance.now() - this.wantJudgeAt > 2500)) {
      this.enterJudge();
    }
    if (
      this.mode === 'dive' &&
      !this.wantJudge &&
      !this.life.framing() &&
      !document.pointerLockElement &&
      !this.paused
    ) {
      if (this.unlockedAt === 0) this.unlockedAt = performance.now();
      else if (performance.now() - this.unlockedAt > 280) this.holdForSteer();
    } else {
      this.unlockedAt = 0;
    }

    const stepping = !(this.mode === 'dive' && this.paused);
      if (stepping && this.mode === 'dive' && !this.wantJudge) this.applyLook(frameDt);
    if (stepping) {
      this.accum += frameDt;
      const step = 1 / 60;
      let steps = 0;
      while (this.accum >= step && steps < 15) {
        this.simFixed(step);
        this.accum -= step;
        steps++;
      }
      if (this.accum >= step) this.accum = 0;
    } else {
      this.accum = 0;
    }

    this.present(frameDt);
    this.just.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.lmb = false;
    this.pad = null;
    requestAnimationFrame(this.frame);
  };

  /** Physics, oxygen, and creature timers. One call is always 1/60 s. */
  private simFixed(dt: number): void {
    const diving = this.mode === 'dive' && !this.paused && !this.wantJudge;
    if (diving) this.simDive(dt);
    else if (this.mode === 'breath' && this.breath) this.simBreath(dt);
    else if (this.mode === 'apnea' && this.apnea) this.simApnea(dt);

    if (!(this.mode === 'dive' && this.paused)) {
      const chest = this.mode === 'dive' ? this.feet.y + 1 : 8;
      this.forward.set(this.feet.x, chest, this.feet.z);
      const ev = this.life.update(dt, this.forward, diving, diving);
      if (diving) this.onSim(ev);
      this.updateBubbles(dt);
    }
  }

  /** Camera, audio, and the draw. `dt` is this frame's wall time, capped at 0.25 s. */
  private present(dt: number): void {
    const diving = this.mode === 'dive' && !this.paused && !this.wantJudge;
    if (!(this.mode === 'dive' && this.paused)) {
      if (this.mode === 'dive') this.diver.visible = !this.viewfinder;
      if (diving && this.viewfinder) {
        this.syncView();
        this.snapFollow();
      } else if (this.mode === 'dive') this.follow(dt);
      else if (this.mode !== 'judge') {
        this.shoreCamera(dt);
        this.placeDiverShore();
      }
      if (diving && this.viewfinder && this.lmb) {
        const frames = this.project(this.fpCam);
        this.shoot(this.grade(frames));
      }
      const depth = this.mode === 'dive' ? depthMeters(this.feet.y) : 0;
      this.world.update(this.time, this.cam.position.y, depth);
      moveSnell(this.world.snell, this.cam.position.x, this.cam.position.z);
      if (this.debugOn && this.mode === 'dive') {
        this.debugLogT += dt;
        if (this.debugLogT >= 0.5) {
          this.debugLogT = 0;
          let near = 99;
          let nearKind = '-';
          let nearAt = '0,0,0';
          const bodies = this.life.bodies();
          for (let i = 0; i < bodies.length; i++) {
            const b = bodies[i];
            const d = Math.hypot(b.x - this.feet.x, b.y - (this.feet.y + 0.4), b.z - this.feet.z);
            if (d < near) {
              near = d;
              nearKind = b.kind;
              nearAt = `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`;
            }
          }
          let rockD = 99;
          let rockR = 0;
          let rockAt = '0,0,0';
          const solids = this.world.solids;
          for (let i = 0; i < solids.length; i++) {
            const s = solids[i];
            const d = Math.hypot(s.x - this.feet.x, s.y - (this.feet.y + 0.4), s.z - this.feet.z);
            if (d < rockD) {
              rockD = d;
              rockR = s.r;
              rockAt = `${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}`;
            }
          }
          const camDx = this.cam.position.x - this.feet.x;
          const camDy = this.cam.position.y - (this.feet.y + BALANCE.followAim);
          const camDz = this.cam.position.z - this.feet.z;
          const elev = (Math.atan2(camDy, Math.hypot(camDx, camDz)) * 180) / Math.PI;
          console.info(
            `[dive] x=${this.feet.x.toFixed(2)} y=${this.feet.y.toFixed(2)} z=${this.feet.z.toFixed(2)} depth=${depth.toFixed(2)} yaw=${this.viewYaw.toFixed(2)} pitch=${this.viewPitch.toFixed(2)} near=${nearKind}:${near.toFixed(1)} at=${nearAt} rock=${rockD.toFixed(2)}/${rockR.toFixed(2)}@${rockAt} cam=${elev.toFixed(1)}`,
          );
        }
      }
    }

    this.flash = Math.max(0, this.flash - dt * 3.2);
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i].ttl -= dt;
      if (this.toasts[i].ttl <= 0) this.toasts.splice(i, 1);
    }

    const depth = this.mode === 'dive' ? depthMeters(this.feet.y) : 0;
    this.audio.setUnderwater(this.cam.position.y < 0.25, depth);
    const o2frac = this.o2 / Math.max(1, maxOxygen(this.save.lung));
    const bpm = this.mode === 'apnea' && this.apnea ? this.apnea.hr : 64 + (1 - clamp(o2frac, 0, 1)) * 88;
    const heart = (diving && o2frac < 0.5) || this.mode === 'apnea';
    this.audio.heartbeat(dt, bpm, heart && !this.save.muted);
    this.audio.shoreWave(dt, this.mode !== 'dive' && this.mode !== 'judge');

    const renderCam = this.mode === 'dive' && this.viewfinder ? this.fpCam : this.cam;
    try {
      this.renderer.render(this.scene, renderCam);
    } catch (err) {
      if (!this.renderFailed) {
        this.renderFailed = true;
        console.error(err);
      }
    }
    this.ui.sync(this.model());
  }

  private simDive(dt: number): void {
    this.invuln = Math.max(0, this.invuln - dt);
    this.shotCd = Math.max(0, this.shotCd - dt);
    this.forcedT = Math.max(0, this.forcedT - dt);
    const wasBurst = this.burstT > 0;
    this.burstT = Math.max(0, this.burstT - dt);
    if (wasBurst && this.burstT <= 0) this.burstCd = BALANCE.burstCd;
    else if (!wasBurst) this.burstCd = Math.max(0, this.burstCd - dt);
    if (this.kickQueued && this.burstT <= 0 && this.burstCd <= 0 && !this.lockSurface) {
      this.burstT = BALANCE.burstTime;
      this.audio.bubbles();
    }
    this.kickQueued = false;

    const depth = depthMeters(this.feet.y);
    const bursting = this.burstT > 0;
    this.o2 = Math.max(0, this.o2 - o2Drain(depth, this.save.gear.suit, this.save.efficiency, bursting) * dt);
    if (this.o2 <= 0 && !this.blackout) {
      this.blackout = true;
      this.lockSurface = true;
      this.stamina = Math.max(0, this.stamina - BALANCE.blackoutStamina);
      this.fines += BALANCE.blackoutFine;
      this.pushToast('toast.blackout');
    }

    this.moveDiver(dt, bursting);
    if (headAtSurface(this.feet.y) && !this.lockSurface && !this.blackout) {
      this.o2 = maxOxygen(this.save.lung);
    }
    const depthNow = depthMeters(this.feet.y);
    const bobbing = depthNow < BALANCE.surfaceUi;
    const wideSurface = depthNow < BALANCE.surfaceDepth + 0.2;
    // Reaching the surface refills oxygen and stays in the dive. The judge card
    // opens only from E, or after a blackout / forced ascent has held them there.
    if ((this.lockSurface || this.stamina <= 0) && wideSurface) {
      this.surfaceHold += dt;
      if (this.surfaceHold > 0.65) this.finishDive();
    } else {
      this.surfaceHold = 0;
    }
    if (bobbing && this.just.has('KeyE')) this.finishDive();

    const swim = Math.hypot(this.velX, this.velY, this.velZ);
    const kicking = this.keys.has('Space') || bursting;
    if (kicking) this.emitBubbles(this.feet.x, this.feet.y + 0.4, this.feet.z, 1);
    else if (swim > 1 && Math.random() < dt * 4) this.emitBubbles(this.feet.x, this.feet.y + 0.3, this.feet.z, 1);

    for (const s of this.life.snaps) {
      if (s.moment === 'turtleBreath' && s.species === 'turtle' && Math.random() < dt * 5) {
        this.emitBubbles(s.x, s.y + 0.5, s.z, 1);
      }
    }

    this.poseDiver(kicking, bursting);
    this.placeShadow();
  }

  /** Mouse up looks up. Mouse right turns right. The clamp is a rate, so 15 FPS turns as far per second as 60. */
  private applyLook(frameDt: number): void {
    if (!document.pointerLockElement) return;
    const sens = this.save.lookSens;
    const frames = Math.max(1, frameDt / (1 / 60));
    const lookX = clamp(this.mouseDX, -80 * frames, 80 * frames);
    const lookY = clamp(this.mouseDY, -60 * frames, 60 * frames);
    this.viewYaw -= lookX * BALANCE.lookYaw * sens;
    this.viewPitch -= lookY * BALANCE.lookPitch * sens;
    this.viewPitch = clamp(this.viewPitch, -BALANCE.pitchLimit, BALANCE.pitchLimit);
  }

  private fillLook(yaw: number, pitch: number, out: Vector3): void {
    const cp = Math.cos(pitch);
    out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
  }

  private addLook(amount: number): void {
    this.velX += this.look.x * amount;
    this.velY += this.look.y * amount;
    this.velZ += this.look.z * amount;
  }

  private alongLook(): number {
    return this.velX * this.look.x + this.velY * this.look.y + this.velZ * this.look.z;
  }

  /** Pull the along-look speed toward `target`. Release leaves only waterDrag. */
  private catchLook(target: number, rate: number, dt: number, gate = 1): void {
    if (gate <= 0) return;
    const fix = (target - this.alongLook()) * (1 - Math.exp(-rate * dt)) * gate;
    this.addLook(fix);
  }

  private moveDiver(dt: number, bursting: boolean): void {
    if (this.life.framing()) {
      this.velX = 0;
      this.velY = 0;
      this.velZ = 0;
      return;
    }
    this.fillLook(this.viewYaw, this.viewPitch, this.look);
    const fins = 1 + BALANCE.finsSpeed * this.save.gear.fins;
    const space = this.keys.has('Space') && !this.lockSurface;
    const pressed = space && !this.spaceDown;
    this.spaceDown = space;
    if (bursting) {
      const target = BALANCE.sprintSpeed * fins;
      if (!this.sprintLatched) {
        this.sprintLatched = true;
        this.addLook(target - this.alongLook());
        this.strokePhase = 0;
      } else {
        this.catchLook(target, 12, dt);
      }
      this.strokePhase += dt / 0.32;
    } else {
      this.sprintLatched = false;
      if (space) {
        if (pressed) {
          this.spaceHold = 0;
          this.strokeWait = 0;
        }
        this.spaceHold += dt;
        if (this.strokeWait <= 0) {
          this.addLook((pressed ? BALANCE.strokeImpulse : BALANCE.strokePulse) * fins);
          this.strokeWait = BALANCE.strokePeriod;
          this.strokePhase = 0;
        } else {
          this.strokeWait -= dt;
          this.strokePhase += dt / BALANCE.strokePeriod;
        }
        const gate = clamp((this.spaceHold - BALANCE.cruiseCatchDelay) / BALANCE.cruiseCatchBlend, 0, 1);
        this.catchLook(BALANCE.cruiseSpeed * fins, BALANCE.cruiseCatch, dt, gate);
      } else {
        this.spaceHold = 0;
        this.strokePhase += dt * 0.35;
      }
    }
    const depth = depthMeters(this.feet.y);
    this.velY += buoyancyAccel(depth) * dt;
    if (this.forcedT > 0 || this.lockSurface) this.velY = Math.max(this.velY, 3.3);
    const drag = Math.exp(-BALANCE.waterDrag * dt);
    this.velX *= drag;
    this.velY *= drag;
    this.velZ *= drag;

    const nextX = this.feet.x + this.velX * dt;
    const nextY = this.feet.y + this.velY * dt;
    const nextZ = this.feet.z + this.velZ * dt;
    const clamped = clampDiver(nextX, nextY, nextZ);
    if (clamped.y > nextY + 0.02 && this.velY < 0) this.velY = 0;
    if (clamped.y < nextY - 0.02 && this.velY > 0) this.velY = 0;
    this.feet.set(clamped.x, clamped.y, clamped.z);
    this.resolveSolids();
  }

  /** Capsule push along the prone body. Turtles shove; they do not bite. */
  private resolveSolids(): void {
    this.fillLook(this.viewYaw, this.viewPitch, this.look);
    const reach = 8;
    for (let pass = 0; pass < 3; pass++) {
      const rocks = this.world.solids;
      for (let i = 0; i < rocks.length; i++) {
        const s = rocks[i];
        if (Math.abs(s.x - this.feet.x) > reach || Math.abs(s.z - this.feet.z) > reach) continue;
        this.pushBody(s.x, s.y, s.z, s.r, 'rock');
      }
      const bodies = this.life.bodies();
      for (let i = 0; i < bodies.length; i++) {
        const s = bodies[i];
        if (Math.abs(s.x - this.feet.x) > reach || Math.abs(s.z - this.feet.z) > reach) continue;
        this.pushBody(s.x, s.y, s.z, s.r, s.kind);
      }
    }
    const clamped = clampDiver(this.feet.x, this.feet.y, this.feet.z);
    this.feet.set(clamped.x, clamped.y, clamped.z);
  }

  /**
   * Spheres along the prone body, plus a point down the belly, so the torso
   * cannot rest inside a rock while the fins stay outside.
   */
  private pushBody(x: number, y: number, z: number, r: number, kind: string): void {
    const lx = this.look.x;
    const ly = this.look.y;
    const lz = this.look.z;
    const flat = Math.hypot(lx, lz);
    const rx = flat < 1e-4 ? -Math.cos(this.viewYaw) : lz / flat;
    const rz = flat < 1e-4 ? Math.sin(this.viewYaw) : -lx / flat;
    const bx = -rz * ly;
    const by = rz * lx - rx * lz;
    const bz = rx * ly;
    const along = [0.15, 0.7, 1.2];
    for (let i = 0; i < along.length; i++) {
      const t = along[i];
      const px = this.feet.x + lx * t;
      const py = this.feet.y + 0.42 + ly * t;
      const pz = this.feet.z + lz * t;
      this.pushOut(px, py, pz, x, y, z, r, kind, 0.62);
      this.pushOut(px + rx * 0.3, py, pz + rz * 0.3, x, y, z, r, kind, 0.42);
      this.pushOut(px - rx * 0.3, py, pz - rz * 0.3, x, y, z, r, kind, 0.42);
      this.pushOut(px + bx * 0.45, py + by * 0.45, pz + bz * 0.45, x, y, z, r, kind, 0.4);
    }
    // Fins sit behind the chest, along the belly. Sample them or they sit in the mesh.
    const tx = this.feet.x - lx * 0.4;
    const ty = this.feet.y + 0.42 - ly * 0.4;
    const tz = this.feet.z - lz * 0.4;
    this.pushOut(tx + bx * 0.5, ty + by * 0.5, tz + bz * 0.5, x, y, z, r, kind, 0.42);
    this.pushOut(tx, ty, tz, x, y, z, r, kind, 0.4);
  }

  private pushOut(
    px: number,
    py: number,
    pz: number,
    x: number,
    y: number,
    z: number,
    r: number,
    kind: string,
    body: number,
  ): void {
    const dx = px - x;
    const dy = py - y;
    const dz = pz - z;
    const dist = Math.hypot(dx, dy, dz);
    const min = body + r;
    const floor = terrainHeight(this.feet.x, this.feet.z);
    // On the sand, a downward push is undone by the floor clamp and the torso
    // sinks back into the rock. Slide out across the floor instead.
    if (this.feet.y <= floor + 0.28 && Math.abs(dy) < min) {
      const horiz = Math.hypot(dx, dz);
      const limit = Math.sqrt(Math.max(0, min * min - dy * dy));
      if (horiz < limit) {
        const awayX = horiz < 1e-4 ? 1 : dx / horiz;
        const awayZ = horiz < 1e-4 ? 0 : dz / horiz;
        const push = limit - horiz;
        this.feet.x += awayX * push;
        this.feet.z += awayZ * push;
        const vn = this.velX * awayX + this.velZ * awayZ;
        if (vn < 0) {
          this.velX -= vn * awayX;
          this.velZ -= vn * awayZ;
        }
        if (this.debugOn && !this.pushedKind.has(kind)) {
          this.pushedKind.add(kind);
          console.info(`[push] ${kind} dist=${dist.toFixed(2)}`);
        }
        return;
      }
    }
    if (dist >= min) return;
    let nx = dx;
    let ny = dy;
    let nz = dz;
    if (dist < 1e-4) {
      nx = min;
      ny = 0;
      nz = 0;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const gap = min - (dist < 1e-4 ? 0 : dist);
    this.feet.x += nx * gap;
    this.feet.y += ny * gap;
    this.feet.z += nz * gap;
    const vn = this.velX * nx + this.velY * ny + this.velZ * nz;
    if (vn < 0) {
      this.velX -= vn * nx;
      this.velY -= vn * ny;
      this.velZ -= vn * nz;
    }
    if (this.debugOn && !this.pushedKind.has(kind)) {
      this.pushedKind.add(kind);
      console.info(`[push] ${kind} dist=${(dist < 1e-4 ? 0 : dist).toFixed(2)}`);
    }
  }

  /** Prone, head along the look direction. Local +Y is the head; the belly faces downward. */
  private poseDiver(kicking: boolean, bursting: boolean): void {
    this.fillLook(this.viewYaw, this.viewPitch, this.look);
    const flat = Math.hypot(this.look.x, this.look.z);
    if (flat < 1e-4) this.bodyRight.set(-Math.cos(this.viewYaw), 0, Math.sin(this.viewYaw));
    else this.bodyRight.set(this.look.z / flat, 0, -this.look.x / flat);
    this.bodyBelly.crossVectors(this.bodyRight, this.look);
    this.bodyBasis.makeBasis(this.bodyRight, this.look, this.bodyBelly);
    this.diver.quaternion.setFromRotationMatrix(this.bodyBasis);
    if (kicking) this.diver.rotateX(Math.sin((this.strokePhase % 1) * Math.PI * 2) * (bursting ? 0.1 : 0.07));
    const back = 0.55;
    this.diver.position.set(
      this.feet.x - this.look.x * back,
      this.feet.y + 0.42 - this.look.y * back,
      this.feet.z - this.look.z * back,
    );
    this.diver.userData.swimming = true;
    this.diver.visible = !this.viewfinder;
    animateDiver(this.diver, this.time, kicking, bursting, this.strokePhase);
  }

  private follow(dt: number): void {
    this.placeFollow(false, dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
  }

  private snapFollow(): void {
    this.placeFollow(true, 0);
  }

  private placeFollow(immediate: boolean, dt: number): void {
    const kAng = immediate ? 1 : 1 - Math.exp(-2.4 * dt);
    this.camYaw = lerpAngle(this.camYaw, this.viewYaw, kAng);
    this.camPitch += (this.viewPitch - this.camPitch) * kAng;
    const back = BALANCE.followBack;
    const side = BALANCE.followSide;
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    const rx = -Math.cos(this.camYaw);
    const rz = Math.sin(this.camYaw);
    const aimY = this.feet.y + BALANCE.followAim;
    const lift = BALANCE.followLift;
    let desiredX = this.feet.x - fx * back + rx * side;
    let desiredZ = this.feet.z - fz * back + rz * side;
    let desiredY = aimY + lift;
    const clearance = 0.85;
    let floorY = terrainHeight(desiredX, desiredZ) + clearance;
    if (desiredY < floorY) {
      // Slide back along the same ray so the 45° elevation survives the sand.
      const extra = Math.min(10, floorY - desiredY);
      const scale = (lift + extra) / lift;
      desiredX = this.feet.x - fx * back * scale + rx * side * scale;
      desiredZ = this.feet.z - fz * back * scale + rz * side * scale;
      desiredY = aimY + lift * scale;
      floorY = terrainHeight(desiredX, desiredZ) + clearance;
      if (desiredY < floorY) desiredY = floorY;
    }
    if (immediate) {
      this.camPos.set(desiredX, desiredY, desiredZ);
    } else {
      const k = 1 - Math.exp(-3.4 * dt);
      this.camPos.x += (desiredX - this.camPos.x) * k;
      this.camPos.y += (desiredY - this.camPos.y) * k;
      this.camPos.z += (desiredZ - this.camPos.z) * k;
    }
    this.cam.position.set(
      this.camPos.x + (immediate ? 0 : (Math.random() - 0.5) * this.shake),
      this.camPos.y + (immediate ? 0 : (Math.random() - 0.5) * this.shake * 0.6),
      this.camPos.z,
    );
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.feet.x + fx * 0.55, aimY, this.feet.z + fz * 0.55);
  }

  private syncView(): void {
    if (this.mode === 'dive' && !this.paused && this.viewfinder) {
      const range = BALANCE.lensFov[this.save.gear.lens];
      this.fov = clamp(this.fov + this.wheel * 0.032, range[0], range[1]);
    }
    this.fillLook(this.viewYaw, this.viewPitch, this.look);
    const eye = 0.35;
    const ahead = 8;
    this.fpCam.fov = this.fov;
    this.fpCam.position.set(
      this.feet.x + this.look.x * eye,
      this.feet.y + 0.5 + this.look.y * eye,
      this.feet.z + this.look.z * eye,
    );
    this.fpCam.up.set(0, 1, 0);
    this.fpCam.lookAt(
      this.fpCam.position.x + this.look.x * ahead,
      this.fpCam.position.y + this.look.y * ahead,
      this.fpCam.position.z + this.look.z * ahead,
    );
    this.fpCam.updateProjectionMatrix();
    this.fpCam.updateMatrixWorld(true);
  }

  private shoot(score: ScoreBreakdown): void {
    if (this.shotCd > 0) return;
    if (this.filmLeft <= 0) {
      this.pushToast('toast.nofilm');
      this.shotCd = 0.4;
      return;
    }
    this.shotCd = BALANCE.shotCooldown;
    this.filmLeft -= 1;
    this.flash = 0.85;
    if (this.life.framing()) this.life.releaseFrame();
    this.audio.shutter();
    const visible = this.diver.visible;
    this.diver.visible = false;
    this.captureAsync(score);
    this.diver.visible = visible;
  }

  private visibilityOf(cam: PerspectiveCamera, x: number, y: number, z: number, radius: number, dist: number): number {
    if (this.occluders.length === 0) return 1;
    const samples: Array<[number, number, number]> = [
      [x, y, z],
      [x + radius * 0.55, y + radius * 0.15, z],
      [x - radius * 0.55, y + radius * 0.15, z],
      [x, y + radius * 0.45, z],
    ];
    let clear = 0;
    const origin = cam.position;
    for (const [sx, sy, sz] of samples) {
      this.rayDir.set(sx - origin.x, sy - origin.y, sz - origin.z);
      const len = this.rayDir.length();
      if (len < 0.25) {
        clear++;
        continue;
      }
      this.rayDir.multiplyScalar(1 / len);
      const far = Math.min(dist, len) - Math.max(0.3, radius * 0.2);
      if (far <= 0.05) {
        clear++;
        continue;
      }
      this.ray.set(origin, this.rayDir);
      this.ray.near = 0.05;
      this.ray.far = far;
      if (this.ray.intersectObjects(this.occluders, false).length === 0) clear++;
    }
    return clear / samples.length;
  }

  private grade(frames: FrameSubject[]): ScoreBreakdown {
    return scoreFrame({
      subjects: frames,
      depth: depthMeters(this.feet.y),
      nearestPredator: this.life.predatorDistance(this.feet.x, this.feet.y + 1, this.feet.z),
    });
  }

  private project(cam: PerspectiveCamera): FrameSubject[] {
    const fog = (this.scene.fog as FogExp2).density;
    cam.getWorldDirection(this.forward);
    const out: FrameSubject[] = [];
    for (const s of this.life.snaps) {
      const dx = s.x - cam.position.x;
      const dy = s.y - cam.position.y;
      const dz = s.z - cam.position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dx * this.forward.x + dy * this.forward.y + dz * this.forward.z < 0.25) continue;
      if (dist < 0.35) continue;
      const fogT = Math.exp(-((fog * dist) ** 2));
      if (fogT < 0.16) continue;
      this.proj.set(s.x, s.y, s.z).project(cam);
      const half = (cam.fov * Math.PI) / 360;
      const fill = s.radius / (dist * Math.tan(half));
      const vis = fill > 0.1 ? this.visibilityOf(cam, s.x, s.y, s.z, s.radius, dist) : 1;
      const clarity = clamp(fogT * (0.2 + 0.8 * vis), 0, 1);
      out.push({
        species: s.species,
        rarity: s.rarity,
        inFront: true,
        ndcX: this.proj.x,
        ndcY: this.proj.y,
        fill,
        radiusNdcX: fill / cam.aspect,
        radiusNdcY: fill,
        distance: dist,
        optimal: s.optimal,
        moment: s.moment,
        dangerous: s.dangerous,
        acting: s.acting,
        clarity,
      });
    }
    return out;
  }

  private captureAsync(score: ScoreBreakdown): void {
    const w = 480;
    const h = Math.max(160, Math.round(w / Math.max(0.5, this.fpCam.aspect)));
    let slot = this.shotRtBusy.findIndex((busy) => !busy);
    if (slot < 0) {
      const rt = new WebGLRenderTarget(w, h);
      rt.texture.colorSpace = SRGBColorSpace;
      this.shotRts.push(rt);
      this.shotRtBusy.push(false);
      slot = this.shotRts.length - 1;
    }
    const slotIndex = slot;
    const rt = this.shotRts[slotIndex];
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    this.shotRtBusy[slotIndex] = true;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, this.fpCam);
    this.renderer.setRenderTarget(prev);
    const index = this.photos.length;
    this.photos.push({ dataUrl: '', score });
    const buf = new Uint8Array(w * h * 4);
    this.pendingShots++;
    const finish = (dataUrl: string) => {
      if (this.photos[index]) this.photos[index].dataUrl = dataUrl;
      this.shotRtBusy[slotIndex] = false;
      this.pendingShots = Math.max(0, this.pendingShots - 1);
      if (this.mode === 'judge') this.nonce++;
    };
    this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h, buf).then(
      () => finish(this.encodeJpeg(buf, w, h)),
      () => {
        try {
          this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
          finish(this.encodeJpeg(buf, w, h));
        } catch {
          finish('');
        }
      },
    );
  }

  private encodeJpeg(buf: Uint8Array, w: number, h: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      img.data.set(buf.subarray(src, src + w * 4), y * w * 4);
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.62);
  }

  private onSim(ev: SimEvent): void {
    if (ev.baitStart) this.pushToast('toast.bait');
    if (ev.turtleStart) this.pushToast('toast.turtle');
    if (ev.orcaStart) this.pushToast('toast.orcaNear');
    if (ev.sharkWarn) this.pushToast('toast.sharkNear');
    this.sharkThreat = ev.sharkThreat;
    if (!ev.hit || this.invuln > 0 || this.blackout) return;
    this.invuln = 2.7;
    this.stamina = Math.max(0, this.stamina - BALANCE.hitStamina);
    this.fines += BALANCE.hitFine;
    this.forcedT = 2.5;
    this.shake = 0.75;
    this.audio.bubbles();
    this.pushToast(ev.hit === 'shark' ? 'toast.shark' : 'toast.orca');
    if (this.stamina <= 0) {
      this.lockSurface = true;
      this.pushToast('toast.done');
    }
  }

  private finishDive(): void {
    if (this.mode !== 'dive' || this.wantJudge) return;
    this.viewfinder = false;
    this.paused = false;
    this.needsSteer = false;
    this.wantJudge = true;
    this.wantJudgeAt = performance.now();
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.pendingShots === 0) this.enterJudge();
  }

  private enterJudge(): void {
    if (this.mode !== 'dive') return;
    this.wantJudge = false;
    this.mode = 'judge';
    this.judgePhase = 'review';
    this.judgeIndex = 0;
    this.committed = false;
    this.nonce++;
  }

  private debugGo(id: string): void {
    if (!this.debugOn) return;
    if (this.mode !== 'dive') this.beginDive();
    const pose = this.life.debugTrigger(id);
    const clamped = clampDiver(pose.x, pose.y, pose.z);
    this.feet.set(clamped.x, clamped.y, clamped.z);
    this.velX = 0;
    this.velY = 0;
    this.velZ = 0;
    this.needsSteer = false;
    this.paused = false;
    this.invuln = 12;
    this.blackout = false;
    this.lockSurface = false;
    this.forcedT = 0;
    this.stamina = Math.max(this.stamina, 80);
    this.o2 = maxOxygen(this.save.lung);
    if (this.filmLeft < 2) this.filmLeft = BALANCE.film;
    const dx = pose.lookX - this.feet.x;
    const dy = pose.lookY - (this.feet.y + 1.55);
    const dz = pose.lookZ - this.feet.z;
    this.viewYaw = Math.atan2(dx, dz);
    this.camYaw = this.viewYaw;
    this.viewPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -BALANCE.pitchLimit, BALANCE.pitchLimit);
    this.camPitch = this.viewPitch;
    this.viewfinder = true;
    this.suppressToggleUntil = performance.now() + 600;
    this.snapFollow();
    this.pushToast('toast.debug');
  }

  private submit(): void {
    if (!this.committed) this.commit();
    this.judgePhase = this.photos.length ? 'card' : 'summary';
    this.judgeIndex = 0;
    this.nonce++;
  }

  private nextCard(): void {
    if (this.judgeIndex < this.photos.length - 1) this.judgeIndex++;
    else this.judgePhase = 'summary';
    this.nonce++;
  }

  private commit(): void {
    const prizes = this.photos.map((p) => p.score.prize);
    let gross = 0;
    if (prizes.length) {
      const best = Math.max(...prizes);
      const rest = prizes.reduce((sum, n) => sum + n, 0) - best;
      gross = best + rest * BALANCE.otherPhotoPay;
    }
    this.gross = Math.round(gross);
    this.net = Math.max(0, Math.round(gross - this.fines));
    this.save.money += this.net;
    this.save.dives += 1;
    this.save.day += 1;
    this.save.trainsToday = 0;
    for (const p of this.photos) {
      if (p.score.total > this.save.bestScore) this.save.bestScore = p.score.total;
      this.keep(p);
    }
    writeSave(this.save);
    this.committed = true;
  }

  private keep(p: Shot): void {
    const s = p.score;
    if (s.species && s.total > 0) this.putAlbum(s.species, s.total, p.dataUrl, s.comment);
    if (s.momentId && s.moment >= 12) this.putAlbum(`m:${s.momentId}`, s.total, p.dataUrl, s.comment);
  }

  private putAlbum(key: string, score: number, dataUrl: string, comment: CommentId): void {
    const prev = this.save.album[key];
    if (albumReplaces(prev ? prev.score : null, score)) this.save.album[key] = { score, dataUrl, comment };
  }

  private simBreath(dt: number): void {
    if (!this.breath) return;
    stepBreath(this.breath, dt, this.just, this.keys, this.pad);
    if (this.breath.done) this.applyBreath();
  }

  private simApnea(dt: number): void {
    if (!this.apnea) return;
    const holding = this.keys.has('Space') || this.holdPointer;
    stepApnea(this.apnea, dt, holding);
    if (this.apnea.done) this.applyApnea();
  }

  private startBreath(): void {
    if (this.save.trainsToday >= BALANCE.trainsPerDay) return;
    this.save.trainsToday += 1;
    writeSave(this.save);
    this.breath = createBreath();
    this.apnea = null;
    this.mode = 'breath';
    this.nonce++;
  }

  private startApnea(): void {
    if (this.save.trainsToday >= BALANCE.trainsPerDay) return;
    this.save.trainsToday += 1;
    writeSave(this.save);
    this.apnea = createApnea();
    this.breath = null;
    this.mode = 'apnea';
    this.nonce++;
  }

  private applyBreath(): void {
    if (!this.breath || this.breath.applied) return;
    const gain = Math.min(BALANCE.lungCap - this.save.lung, this.breath.gain);
    this.breath.gain = Math.max(0, gain);
    this.save.lung += this.breath.gain;
    this.breath.applied = true;
    writeSave(this.save);
  }

  private applyApnea(): void {
    if (!this.apnea || this.apnea.applied) return;
    const gain = Math.min(BALANCE.effCap - this.save.efficiency, this.apnea.gain);
    this.apnea.gain = Math.max(0, gain);
    this.save.efficiency += this.apnea.gain;
    this.apnea.applied = true;
    writeSave(this.save);
  }

  private finishTrain(): void {
    if (this.breath) {
      forceFinishBreath(this.breath);
      this.applyBreath();
      this.breath = null;
    }
    if (this.apnea) {
      forceFinishApnea(this.apnea);
      this.applyApnea();
      this.apnea = null;
    }
    this.mode = 'shore';
    this.nonce++;
  }

  private buy(id: GearId): void {
    const level = this.save.gear[id];
    const cost = BALANCE.costs[id][level];
    if (level >= BALANCE.maxGear || cost == null || this.save.money < cost) return;
    this.save.money -= cost;
    this.save.gear[id] = level + 1;
    writeSave(this.save);
    tintDiver(this.diver, this.save.gear.suit, this.save.gear.fins);
    this.nonce++;
  }

  private open(mode: UIModel['mode']): void {
    if (mode === 'shore') this.resetArmed = false;
    if (this.mode === 'breath' || this.mode === 'apnea') {
      this.finishTrain();
      if (mode === 'shore') return;
    }
    this.mode = mode;
    this.nonce++;
  }

  private setLanguage(lang: Lang): void {
    this.save.lang = lang;
    setLang(lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    writeSave(this.save);
    this.nonce++;
  }

  private toggleMute(): void {
    this.save.muted = !this.save.muted;
    this.audio.setMuted(this.save.muted);
    writeSave(this.save);
    this.nonce++;
  }

  private resetProgress(): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.nonce++;
      return;
    }
    this.save = defaultSave();
    writeSave(this.save);
    setLang('zh');
    this.resetArmed = false;
    tintDiver(this.diver, 0, 0);
    this.mode = 'shore';
    this.nonce++;
  }

  private shoreCamera(dt: number): void {
    void dt;
    const bob = Math.sin(this.time * 0.35) * 0.18;
    this.cam.position.set(-8.2, 4.8 + bob * 0.2, -13.5);
    this.cam.lookAt(2.5, 0.3, 2);
  }

  private placeDiverShore(): void {
    const x = -1.6;
    const z = -6.2;
    const y = terrainHeight(x, z);
    this.feet.set(x, y, z);
    this.diver.userData.swimming = false;
    this.diver.position.set(x, y, z);
    this.diver.rotation.set(0, 0.25, 0);
    this.diver.visible = true;
    animateDiver(this.diver, this.time, false, false);
    this.placeShadow();
  }

  private placeShadow(): void {
    const y = terrainHeight(this.feet.x, this.feet.z);
    this.shadow.position.set(this.feet.x, y + 0.12, this.feet.z);
    const lift = Math.max(0, this.feet.y - y);
    const sc = clamp(1 + lift * 0.04, 0.8, 2.4);
    this.shadow.scale.setScalar(sc);
    (this.shadow.material as MeshBasicMaterial).opacity = clamp(0.32 - lift * 0.012, 0.06, 0.32);
    this.shadow.visible = this.diver.visible;
  }

  private initBubbles(): void {
    const geo = new SphereGeometry(1, 6, 5);
    for (let i = 0; i < 32; i++) {
      const mesh = new Mesh(
        geo,
        new MeshBasicMaterial({ color: 0xe7fbff, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.bubbles.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0 });
    }
  }

  private emitBubbles(x: number, y: number, z: number, n: number): void {
    let left = n;
    for (const b of this.bubbles) {
      if (left <= 0) break;
      if (b.life > 0) continue;
      b.life = 0.7 + Math.random() * 0.9;
      b.mesh.visible = true;
      b.mesh.position.set(x + (Math.random() - 0.5) * 0.35, y, z + (Math.random() - 0.5) * 0.35);
      b.mesh.scale.setScalar(0.05 + Math.random() * 0.07);
      b.vx = (Math.random() - 0.5) * 0.25;
      b.vy = 0.7 + Math.random() * 0.8;
      b.vz = (Math.random() - 0.5) * 0.25;
      left--;
    }
  }

  private updateBubbles(dt: number): void {
    for (const b of this.bubbles) {
      if (b.life <= 0) continue;
      b.life -= dt;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += b.vy * dt;
      b.mesh.position.z += b.vz * dt;
      (b.mesh.material as MeshBasicMaterial).opacity = Math.max(0, b.life) * 0.45;
      if (b.life <= 0) b.mesh.visible = false;
    }
  }

  private pushToast(key: string): void {
    if (this.toasts.some((toast) => toast.key === key)) return;
    this.toasts.push({ key, ttl: 3.1 });
  }

  private model(): UIModel {
    const depth = this.mode === 'dive' ? depthMeters(this.feet.y) : 0;
    const maxO2 = maxOxygen(this.save.lung);
    let focus = '';
    if (this.mode === 'dive' && this.viewfinder) {
      const preview = this.grade(this.project(this.fpCam));
      focus = preview.species ? t(`sp.${preview.species}`) : t('hud.nofocus');
      if (preview.momentId && preview.moment >= 20) focus += ` · ${t(`mo.${preview.momentId}`)}`;
    }
    const fins = 1 + BALANCE.finsSpeed * this.save.gear.fins;
    const climb = Math.max(0.65, BALANCE.cruiseSpeed * fins + buoyancyAccel(depth));
    const mid = o2Drain(depth * 0.55, this.save.gear.suit, this.save.efficiency, false);
    const need = Math.max(0, depth - BALANCE.surfaceDepth) / climb * mid;
    const o2frac = this.o2 / maxO2;
    return {
      mode: this.mode,
      lang: this.save.lang,
      nonce: this.nonce,
      muted: this.save.muted,
      money: this.save.money,
      day: this.save.day,
      lung: this.save.lung,
      efficiency: this.save.efficiency,
      trainsLeft: Math.max(0, BALANCE.trainsPerDay - this.save.trainsToday),
      found: Object.keys(this.save.album).length,
      best: this.save.bestScore,
      resetArmed: this.resetArmed,
      gear: this.save.gear,
      breath: this.breath,
      apnea: this.apnea,
      o2: this.o2,
      maxO2,
      depth,
      stamina: this.stamina,
      film: this.filmLeft,
      filmMax: BALANCE.film,
      warnReturn: this.mode === 'dive' && depth > 4 && this.o2 < need * 1.18 && !this.blackout,
      atSurface: this.mode === 'dive' && depth < BALANCE.surfaceUi,
      viewfinder: this.viewfinder,
      mm: focalMm(this.fov),
      focus,
      paused: this.paused,
      lookSens: this.save.lookSens,
      bursting: this.burstT > 0,
      burstLeft: this.burstT,
      burstCd: this.burstCd,
      sharkThreat: this.mode === 'dive' && this.sharkThreat,
      toasts: this.toasts.map((toast) => toast.key),
      flash: this.flash,
      vignette: this.mode === 'dive' ? (this.blackout ? 0.35 : o2frac < 0.34 ? (0.34 - o2frac) / 0.34 : 0) : 0,
      blackout: this.mode === 'dive' && this.blackout ? 0.78 : 0,
      lowO2: o2frac < 0.28,
      judgePhase: this.judgePhase,
      photos: this.photos,
      judgeIndex: this.judgeIndex,
      gross: this.gross,
      fines: this.fines,
      net: this.net,
      album: this.save.album,
      fpsOn: this.fpsOn,
      fps: this.fpsShown,
      debug: this.debugOn,
    };
  }

  private bindInput(): void {
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.mode === 'dive' && (e.code === 'Space' || e.code === 'Enter')) e.preventDefault();
      },
      true,
    );
    window.addEventListener('keydown', (e) => {
      this.audio.unlock();
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
      if (e.code === 'KeyP') {
        this.fpsOn = !this.fpsOn;
        return;
      }
      this.keys.add(e.code);
      this.just.add(e.code);
      if (this.mode === 'dive' && !this.paused && e.code === 'KeyF') this.kickQueued = true;
      if (e.code === 'Escape') this.onEscape();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      this.audio.unlock();
      if (this.mode === 'dive' && !this.wantJudge && (this.paused || this.needsSteer || !document.pointerLockElement)) {
        if (e.button === 2) e.preventDefault();
        const lock = this.canvas.requestPointerLock();
        void Promise.resolve(lock).catch(() => {});
        return;
      }
      if (e.button === 0) this.lmb = true;
      if (e.button === 2) {
        e.preventDefault();
        this.relockUntil = performance.now() + 500;
        this.toggleViewfinder();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.mode !== 'dive' || !document.pointerLockElement) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'dive') return;
        e.preventDefault();
        this.wheel += e.deltaY;
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) {
        if (this.mode === 'dive' && this.needsSteer && !this.wantJudge) {
          this.needsSteer = false;
          this.paused = false;
        }
        return;
      }
      if (this.mode !== 'dive' || this.wantJudge) return;
      if (performance.now() < this.relockUntil) {
        const lock = this.canvas.requestPointerLock();
        void Promise.resolve(lock).catch(() => this.holdForSteer());
        return;
      }
      this.holdForSteer();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (this.mode === 'dive' && !this.wantJudge) this.holdForSteer();
    });
  }

  private suppressToggleUntil = 0;
  private unlockedAt = 0;

  private holdForSteer(): void {
    if (this.mode !== 'dive' || this.wantJudge) return;
    this.needsSteer = true;
    this.paused = true;
  }

  private toggleViewfinder(): void {
    if (performance.now() < this.suppressToggleUntil) return;
    if (this.mode !== 'dive' || this.paused) return;
    this.viewfinder = !this.viewfinder;
    if (!document.pointerLockElement) {
      this.relockUntil = performance.now() + 500;
      const lock = this.canvas.requestPointerLock();
      void Promise.resolve(lock).catch(() => this.holdForSteer());
    }
  }

  private onEscape(): void {
    if (this.mode === 'dive') {
      this.viewfinder = false;
      this.relockUntil = 0;
      this.holdForSteer();
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    if (this.mode === 'breath' || this.mode === 'apnea') {
      this.finishTrain();
      return;
    }
    if (this.mode !== 'shore' && this.mode !== 'judge') this.open('shore');
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.fpCam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.fpCam.updateProjectionMatrix();
  };
}
