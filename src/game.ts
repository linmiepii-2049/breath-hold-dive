import {
  ACESFilmicToneMapping,
  CircleGeometry,
  FogExp2,
  Mesh,
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
  focalMm,
  maxOxygen,
  o2Drain,
  swimSpeed,
  verticalSpeed,
} from './balance';
import { OceanLife, type SimEvent } from './creatures';
import { setLang, t } from './i18n';
import { animateDiver, makeDiver, tintDiver } from './models';
import { scoreFrame, type FrameSubject, type ScoreBreakdown } from './scoring';
import { defaultSave, loadSave, writeSave, type SaveData } from './save';
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
  private lastW = 0;

  private feet = new Vector3(1.4, 1, -3);
  private camPos = new Vector3();
  private velX = 0;
  private velZ = 0;
  private diverYaw = 0.4;
  private camYaw = 0.4;
  private viewYaw = 0;
  private viewPitch = -0.28;
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
      endDive: () => this.finishDive(),
      resume: () => {
        this.paused = false;
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
    this.paused = false;
    this.viewfinder = false;
    this.shake = 0;
    this.shotCd = 0;
    this.surfaceHold = 0;
    this.judgePhase = 'review';
    this.judgeIndex = 0;
    const range = BALANCE.lensFov[this.save.gear.lens];
    this.fov = (range[0] + range[1]) / 2;
    this.feet.set(6.2, -3.8, 9);
    this.diverYaw = 0.15;
    this.camYaw = 0.15;
    this.velX = 0;
    this.velZ = 0;
    this.life.reset();
    this.snapFollow();
    this.emitBubbles(this.feet.x, this.feet.y + 1.2, this.feet.z, 8);
    this.audio.bubbles();
    this.pushToast('toast.descend');
  }

  /** Dev-only aiming aid used by the playtest. Not wired to the UI. */
  debugTeleport(x: number, y: number, z: number, yaw: number): void {
    this.feet.set(x, y, z);
    this.diverYaw = yaw;
    this.camYaw = yaw;
    this.snapFollow();
  }

  debugAim(yaw: number, pitch: number, fov: number): void {
    this.viewfinder = true;
    this.viewYaw = yaw;
    this.viewPitch = pitch;
    this.fov = fov;
    this.syncView();
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
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    if (dt > 0) {
      this.fpsSmooth += (1 / dt - this.fpsSmooth) * 0.08;
      this.fpsTick += dt;
      if (this.fpsTick >= 0.25) {
        this.fpsTick = 0;
        this.fpsShown = Math.round(this.fpsSmooth);
      }
    }
    this.tick(dt);
    this.just.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.lmb = false;
    this.pad = null;
    requestAnimationFrame(this.frame);
  };

  private tick(dt: number): void {
    if (this.wantJudge && this.mode === 'dive' && (this.pendingShots === 0 || performance.now() - this.wantJudgeAt > 2500)) {
      this.enterJudge();
    }
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
      if (this.mode === 'dive') this.diver.visible = !this.viewfinder;
      if (diving && this.viewfinder) this.syncView();
      else if (this.mode === 'dive') this.follow(dt);
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
    this.burstCd = Math.max(0, this.burstCd - dt);
    this.burstT = Math.max(0, this.burstT - dt);
    this.forcedT = Math.max(0, this.forcedT - dt);
    if (this.kickQueued && this.burstCd <= 0 && !this.lockSurface) {
      this.burstT = BALANCE.burstTime;
      this.burstCd = BALANCE.burstCd;
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
    const atSurface = depthMeters(this.feet.y) < BALANCE.surfaceDepth + 0.2;
    if ((this.lockSurface || this.stamina <= 0) && atSurface) {
      this.surfaceHold += dt;
      if (this.surfaceHold > 0.65) this.finishDive();
    } else {
      this.surfaceHold = 0;
    }
    if (atSurface && this.just.has('KeyE')) this.finishDive();

    const swim = Math.hypot(this.velX, this.velZ);
    if (bursting || this.keys.has('Space')) this.emitBubbles(this.feet.x, this.feet.y + 1.4, this.feet.z, 1);
    else if (swim > 1 && Math.random() < dt * 4) this.emitBubbles(this.feet.x, this.feet.y + 1.2, this.feet.z, 1);

    for (const s of this.life.snaps) {
      if (s.moment === 'turtleBreath' && s.species === 'turtle' && Math.random() < dt * 5) {
        this.emitBubbles(s.x, s.y + 0.5, s.z, 1);
      }
    }

    this.diver.position.copy(this.feet);
    this.diver.rotation.y = this.viewfinder ? this.viewYaw : this.diverYaw;
    this.diver.visible = !this.viewfinder;
    animateDiver(this.diver, this.time, swim, bursting);
    this.placeShadow();
  }

  private moveDiver(dt: number, bursting: boolean): void {
    let ix = 0;
    let iz = 0;
    if (this.keys.has('KeyA')) ix -= 1;
    if (this.keys.has('KeyD')) ix += 1;
    if (this.keys.has('KeyW')) iz += 1;
    if (this.keys.has('KeyS')) iz -= 1;
    const len = Math.hypot(ix, iz);
    if (len > 0) {
      ix /= len;
      iz /= len;
    }
    const yaw = this.viewfinder ? this.viewYaw : this.diverYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let wx = fx * iz + rx * ix;
    let wz = fz * iz + rz * ix;
    if (this.lockSurface) {
      wx *= 0.35;
      wz *= 0.35;
    }
    const speed = swimSpeed(this.save.gear.fins, bursting);
    const blend = 1 - Math.exp(-7 * dt);
    this.velX += (wx * speed - this.velX) * blend;
    this.velZ += (wz * speed - this.velZ) * blend;

    let vy = 0;
    const vSpeed = verticalSpeed(this.save.gear.fins);
    if (this.keys.has('Space')) vy += vSpeed;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) vy -= vSpeed;
    if (this.forcedT > 0 || this.lockSurface) vy = Math.max(vy, 3.3);

    this.feet.x += this.velX * dt;
    this.feet.y += vy * dt;
    this.feet.z += this.velZ * dt;
    const clamped = clampDiver(this.feet.x, this.feet.y, this.feet.z);
    this.feet.set(clamped.x, clamped.y, clamped.z);

    if (!this.viewfinder && Math.hypot(this.velX, this.velZ) > 0.45) {
      const target = Math.atan2(this.velX, this.velZ);
      this.diverYaw = lerpAngle(this.diverYaw, target, 1 - Math.exp(-6 * dt));
    }
    if (this.viewfinder) this.diverYaw = this.viewYaw;
  }

  private follow(dt: number): void {
    this.camYaw = lerpAngle(this.camYaw, this.diverYaw, 1 - Math.exp(-3.1 * dt));
    const dist = BALANCE.followDist;
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    const desiredX = this.feet.x - fx * dist;
    const desiredZ = this.feet.z - fz * dist;
    const desiredY = Math.max(this.feet.y + 1 + dist, terrainHeight(desiredX, desiredZ) + 1.3);
    const k = 1 - Math.exp(-3.4 * dt);
    this.camPos.x += (desiredX - this.camPos.x) * k;
    this.camPos.y += (desiredY - this.camPos.y) * k;
    this.camPos.z += (desiredZ - this.camPos.z) * k;
    this.cam.position.set(
      this.camPos.x + (Math.random() - 0.5) * this.shake,
      this.camPos.y + (Math.random() - 0.5) * this.shake * 0.6,
      this.camPos.z,
    );
    this.cam.lookAt(this.feet.x, this.feet.y + 1, this.feet.z);
    this.shake = Math.max(0, this.shake - dt * 1.6);
  }

  private snapFollow(): void {
    const dist = BALANCE.followDist;
    const fx = Math.sin(this.diverYaw);
    const fz = Math.cos(this.diverYaw);
    this.camPos.set(this.feet.x - fx * dist, this.feet.y + 1 + dist, this.feet.z - fz * dist);
    this.cam.position.copy(this.camPos);
    this.cam.lookAt(this.feet.x, this.feet.y + 1, this.feet.z);
  }

  private syncView(): void {
    if (this.mode === 'dive' && !this.paused) {
      this.viewYaw += this.mouseDX * 0.00215;
      this.viewPitch -= this.mouseDY * 0.0017;
      this.viewPitch = clamp(this.viewPitch, -1.05, 0.8);
      const range = BALANCE.lensFov[this.save.gear.lens];
      this.fov = clamp(this.fov + this.wheel * 0.032, range[0], range[1]);
    }
    const cp = Math.cos(this.viewPitch);
    const dist = 6;
    const tx = this.feet.x + Math.sin(this.viewYaw) * cp * dist;
    const ty = this.feet.y + 1.55 + Math.sin(this.viewPitch) * dist;
    const tz = this.feet.z + Math.cos(this.viewYaw) * cp * dist;
    this.fpCam.fov = this.fov;
    this.fpCam.position.set(this.feet.x, this.feet.y + 1.55, this.feet.z);
    this.fpCam.up.set(0, 1, 0);
    this.fpCam.lookAt(tx, ty, tz);
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
    this.audio.shutter();
    const visible = this.diver.visible;
    this.diver.visible = false;
    this.captureAsync(score);
    this.diver.visible = visible;
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
      if (Math.exp(-((fog * dist) ** 2)) < 0.16) continue;
      this.proj.set(s.x, s.y, s.z).project(cam);
      const half = (cam.fov * Math.PI) / 360;
      const fill = s.radius / (dist * Math.tan(half));
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
    if (document.pointerLockElement) document.exitPointerLock();
    this.paused = false;
    this.wantJudge = true;
    this.wantJudgeAt = performance.now();
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
    this.velZ = 0;
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
    this.diverYaw = this.viewYaw;
    this.camYaw = this.viewYaw;
    this.viewPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1, 0.75);
    this.viewfinder = true;
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
    if (!prev || score > prev.score) this.save.album[key] = { score, dataUrl, comment };
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
    this.diver.position.set(x, y, z);
    this.diver.rotation.y = 0.25;
    this.diver.rotation.z = 0;
    this.diver.visible = true;
    animateDiver(this.diver, this.time, 0, false);
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
    const vSpeed = verticalSpeed(this.save.gear.fins);
    const mid = o2Drain(depth * 0.55, this.save.gear.suit, this.save.efficiency, false);
    const need = Math.max(0, depth - BALANCE.surfaceDepth) / vSpeed * mid;
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
      atSurface: this.mode === 'dive' && depth < BALANCE.surfaceDepth + 0.25,
      viewfinder: this.viewfinder,
      mm: focalMm(this.fov),
      focus,
      paused: this.paused,
      bursting: this.burstT > 0,
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
      if (this.mode === 'dive' && !this.paused) {
        if (e.code === 'KeyF') this.kickQueued = true;
        if (e.code === 'KeyW') {
          const now = performance.now();
          if (now - this.lastW < 280) this.kickQueued = true;
          this.lastW = now;
        }
      }
      if (e.code === 'Escape') this.onEscape();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      this.audio.unlock();
      if (e.button === 0) this.lmb = true;
      if (e.button === 2 && this.mode === 'dive' && !this.paused) {
        if (!this.viewfinder) {
          this.viewYaw = this.diverYaw;
          this.viewPitch = -0.26;
        }
        this.viewfinder = true;
        this.canvas.requestPointerLock();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        this.viewfinder = false;
        if (document.pointerLockElement) document.exitPointerLock();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.viewfinder || !document.pointerLockElement) return;
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
      if (!document.pointerLockElement) this.viewfinder = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.viewfinder = false;
    });
  }

  private onEscape(): void {
    if (this.viewfinder || document.pointerLockElement) {
      this.viewfinder = false;
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    if (this.mode === 'dive') {
      this.paused = !this.paused;
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
