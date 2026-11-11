import { BALANCE, nextCost } from './balance';
import { f, t } from './i18n';
import type { ScoreBreakdown } from './scoring';
import type { BreathState, ApneaState, BreathPhase } from './training';
import { BREATH_WINDOW_END, BREATH_WINDOW_START, breathInto, breathPhase } from './training';
import type { AlbumEntry, GearId, Lang } from './types';
import { MOMENTS, SPECIES } from './types';
import { portraitNow, prefersTouch } from './touch';

export interface UIHooks {
  dive(): void;
  train(): void;
  shop(): void;
  album(): void;
  back(): void;
  lang(lang: Lang): void;
  mute(): void;
  reset(): void;
  startBreath(): void;
  startApnea(): void;
  finishTrain(): void;
  pad(phase: BreathPhase): void;
  hold(down: boolean): void;
  buy(id: GearId): void;
  resume(): void;
  pause(): void;
  kick(down: boolean): void;
  sprint(): void;
  camera(): void;
  shutter(): void;
  endDive(): void;
  sens(value: number): void;
  submit(): void;
  nextCard(): void;
  shore(): void;
  debug(id: string): void;
}

export interface PhotoView {
  dataUrl: string;
  score: ScoreBreakdown;
}

export interface UIModel {
  mode: 'shore' | 'train' | 'breath' | 'apnea' | 'shop' | 'album' | 'dive' | 'judge';
  lang: Lang;
  nonce: number;
  muted: boolean;
  money: number;
  day: number;
  lung: number;
  efficiency: number;
  trainsLeft: number;
  found: number;
  best: number;
  resetArmed: boolean;
  gear: { fins: number; lens: number; suit: number };
  breath: BreathState | null;
  apnea: ApneaState | null;
  o2: number;
  maxO2: number;
  depth: number;
  stamina: number;
  film: number;
  filmMax: number;
  warnReturn: boolean;
  atSurface: boolean;
  viewfinder: boolean;
  mm: number;
  focus: string;
  paused: boolean;
  /** Phone or tablet layout. Desktop stays false. */
  touch: boolean;
  lookSens: number;
  bursting: boolean;
  burstLeft: number;
  burstCd: number;
  sharkThreat: boolean;
  sharkCharging: boolean;
  toasts: { key: string; text?: string }[];
  flash: number;
  vignette: number;
  blackout: number;
  lowO2: boolean;
  judgePhase: 'review' | 'card' | 'summary';
  photos: PhotoView[];
  judgeIndex: number;
  gross: number;
  fines: number;
  net: number;
  album: Record<string, AlbumEntry | undefined>;
  fpsOn: boolean;
  fps: number;
  debug: boolean;
}

export class GameUI {
  private key = '';
  private touch = prefersTouch();

  constructor(
    private root: HTMLElement,
    private hooks: UIHooks,
  ) {
    document.body.classList.toggle('touch', this.touch);
    if (this.touch) {
      window.addEventListener('resize', () => this.syncRotate());
      window.addEventListener('orientationchange', () => this.syncRotate());
    }
  }

  sync(m: UIModel): void {
    const key = `${m.mode}:${m.nonce}:${m.lang}`;
    if (key !== this.key) {
      this.key = key;
      this.root.innerHTML = this.html(m);
      this.bind();
    }
    if (m.mode === 'dive' || m.mode === 'breath' || m.mode === 'apnea') this.patch(m);
    this.patchFps(m);
    this.syncRotate();
  }

  private patchFps(m: UIModel): void {
    let el = this.root.querySelector('#fps') as HTMLElement | null;
    if (!el) {
      el = document.createElement('div');
      el.id = 'fps';
      this.root.appendChild(el);
    }
    el.classList.toggle('on', m.fpsOn);
    if (m.fpsOn) el.textContent = `${m.fps} FPS`;
  }

  private html(m: UIModel): string {
    if (m.mode === 'shore') return this.shore(m);
    if (m.mode === 'train') return this.train(m);
    if (m.mode === 'breath') return this.breathShell();
    if (m.mode === 'apnea') return this.apneaShell();
    if (m.mode === 'shop') return this.shop(m);
    if (m.mode === 'album') return this.album(m);
    if (m.mode === 'dive') return this.dive(m);
    return this.judge(m);
  }

  private bind(): void {
    const q = (id: string) => this.root.querySelector(id);
    q('#dive')?.addEventListener('click', () => this.hooks.dive());
    q('#train')?.addEventListener('click', () => this.hooks.train());
    q('#shop')?.addEventListener('click', () => this.hooks.shop());
    q('#album')?.addEventListener('click', () => this.hooks.album());
    q('#back')?.addEventListener('click', () => this.hooks.back());
    q('#reset')?.addEventListener('click', () => this.hooks.reset());
    q('#mute')?.addEventListener('click', () => this.hooks.mute());
    q('[data-lang="zh"]')?.addEventListener('click', () => this.hooks.lang('zh'));
    q('[data-lang="en"]')?.addEventListener('click', () => this.hooks.lang('en'));
    q('#go-breath')?.addEventListener('click', () => this.hooks.startBreath());
    q('#go-apnea')?.addEventListener('click', () => this.hooks.startApnea());
    q('#train-done')?.addEventListener('click', () => this.hooks.finishTrain());
    q('#resume')?.addEventListener('click', () => this.hooks.resume());
    this.press(q('#touch-pause'), () => this.hooks.pause());
    this.press(q('#touch-sprint'), () => this.hooks.sprint());
    this.press(q('#touch-cam'), () => this.hooks.camera());
    this.press(q('#touch-shutter'), () => this.hooks.shutter());
    this.press(q('#touch-end'), () => this.hooks.endDive());
    this.press(q('#touch-end-paused'), () => this.hooks.endDive());
    this.holdButton(q('#touch-kick'), (down) => this.hooks.kick(down));
    q('#sens')?.addEventListener('input', (ev) => {
      const value = Number((ev.target as HTMLInputElement).value);
      this.hooks.sens(value);
      const label = this.root.querySelector('#sens-n');
      if (label) label.textContent = value.toFixed(2);
    });
    q('#submit')?.addEventListener('click', () => this.hooks.submit());
    q('#next-card')?.addEventListener('click', () => this.hooks.nextCard());
    q('#to-shore')?.addEventListener('click', () => this.hooks.shore());
    for (const id of ['fins', 'lens', 'suit'] as GearId[]) {
      q(`#buy-${id}`)?.addEventListener('click', () => this.hooks.buy(id));
    }
    for (const phase of ['inhale', 'hold', 'exhale'] as BreathPhase[]) {
      const btn = q(`#pad-${phase}`);
      btn?.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        this.hooks.pad(phase);
      });
    }
    this.holdButton(q('#hold'), (down) => this.hooks.hold(down));
    this.root.querySelectorAll<HTMLElement>('[data-debug]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.debug;
        if (id) this.hooks.debug(id);
      });
    });
  }

  /** A tap that fires once on press, so a shutter or a sprint does not wait for release. */
  private press(el: Element | null, fire: () => void): void {
    if (!el) return;
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      fire();
    });
  }

  /** Hold stays down until the finger lifts, including if it slides off the button. */
  private holdButton(el: Element | null, down: (held: boolean) => void): void {
    if (!el) return;
    const node = el as HTMLElement;
    node.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      try {
        node.setPointerCapture(ev.pointerId);
      } catch {
        /* a synthetic touch with no pointer id still holds until pointerup */
      }
      down(true);
    });
    const up = () => down(false);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  }

  private syncRotate(): void {
    if (!this.touch) return;
    let el = this.root.querySelector('#rotate') as HTMLElement | null;
    if (!el) {
      el = document.createElement('div');
      el.id = 'rotate';
      el.className = 'rotate-overlay';
      el.innerHTML = `<p>${t('touch.rotate')}</p>`;
      this.root.appendChild(el);
    }
    el.classList.toggle('on', portraitNow());
  }

  private shore(m: UIModel): string {
    return `
      <div class="topbar">
        <div>
          <div class="brand-zh">一口气</div>
          <div class="brand-en">BREATH HOLD</div>
          <div class="brand-sub">${t('logo.sub')} · ${t('logo.site')}</div>
        </div>
        ${this.tools(m)}
      </div>
      <div class="dock panel">
        <div class="narrow-note">${t('desktop')}</div>
        <p class="blurb">${t('shore.blurb')}</p>
        <div class="actions">
          <button class="primary" id="dive">${t('btn.dive')}</button>
          <button id="train">${t('btn.train')}</button>
          <button id="shop">${t('btn.shop')}</button>
          <button id="album">${t('btn.album')}</button>
        </div>
        <div class="controls dim dock-scroll">
          <div>${t('shore.controls')}</div>
          <div>${t(m.touch ? 'shore.c1touch' : 'shore.c1')}</div>
          <div>${t(m.touch ? 'shore.c2touch' : 'shore.c2')}</div>
          <div>${t('shore.c3')}</div>
          <label class="sens">${t(m.touch ? 'shore.sensTouch' : 'shore.sens')} <b id="sens-n">${m.lookSens.toFixed(2)}</b>
            <input id="sens" type="range" min="0.45" max="2.1" step="0.05" value="${m.lookSens}" />
          </label>
        </div>
        ${this.debugPanel(m, false)}
        <button class="ghost tiny" id="reset">${m.resetArmed ? t('btn.resetConfirm') : t('btn.reset')}</button>
      </div>
      <div class="stats panel">
        <div>${t('shore.day').replace('{n}', String(m.day))}</div>
        <div>${t('shore.lung')} +${pct(m.lung)}%</div>
        <div>${t('shore.eff')} +${pct(m.efficiency)}%</div>
        <div>${t('shore.guide')} ${m.found}/11</div>
        <div>${t('shore.best')} ${m.best}</div>
        <div class="soon">${t('shore.coming')}</div>
      </div>`;
  }

  private tools(m: UIModel): string {
    const mute = m.muted ? t('mute.off') : t('mute.on');
    return `<div class="h tools">
      <div class="pill gold">¥${Math.round(m.money)}</div>
      <div class="pill lang">
        <button type="button" data-lang="zh" aria-label="${t('lang.zh')}" class="${m.lang === 'zh' ? 'on' : ''}">中</button>
        <button type="button" data-lang="en" aria-label="${t('lang.en')}" class="${m.lang === 'en' ? 'on' : ''}">EN</button>
      </div>
      <button type="button" class="pill" id="mute" aria-label="${mute}">${m.muted ? '♪×' : '♪'}<span class="btn-name">${mute}</span></button>
    </div>`;
  }

  private train(m: UIModel): string {
    const locked = m.trainsLeft <= 0;
    return `<div class="modal"><div class="panel">
      <div class="train-top"><h2>${t('train.title')}</h2><span class="dim">${f('train.left', { n: m.trainsLeft })}</span></div>
      ${locked ? `<p class="gold">${t('train.cap')}</p>` : ''}
      <div class="cards">
        <div class="card-lite panel">
          <h3>${t('train.breath')}</h3>
          <p>${t(m.touch ? 'train.breath.descTouch' : 'train.breath.desc')}</p>
          <button class="primary" id="go-breath" ${locked ? 'disabled' : ''}>${t('btn.start')}</button>
        </div>
        <div class="card-lite panel">
          <h3>${t('train.apnea')}</h3>
          <p>${t(m.touch ? 'train.apnea.descTouch' : 'train.apnea.desc')}</p>
          <button class="primary" id="go-apnea" ${locked ? 'disabled' : ''}>${t('btn.start')}</button>
        </div>
      </div>
      <div class="actions" style="margin-top:14px"><button id="back">${t('btn.back')}</button></div>
    </div></div>`;
  }

  private debugPanel(m: UIModel, floating: boolean): string {
    if (!m.debug) return '';
    const species = SPECIES.map((id) => `<button data-debug="${id}">${t(`sp.${id}`)}</button>`).join('');
    const moments = MOMENTS.map((id) => `<button data-debug="${id}">${t(`mo.${id}`)}</button>`).join('');
    return `<details class="debug-panel${floating ? ' dive-debug' : ''}">
      <summary>${t('debug.title')}</summary>
      <p class="dim">${t('debug.hint')}</p>
      <div class="debug-btns">${species}${moments}</div>
    </details>`;
  }

  private breathShell(): string {
    return `<div class="modal"><div class="panel" style="width:min(560px,100%)">
      <div id="play">
        <div class="dim" id="time"></div>
        <div class="phase" id="phase"></div>
        <div class="dim" id="how"></div>
        <div class="keys">
          <span id="k-inhale">${t('train.phase.inhale')}${this.touch ? '' : ' · J / ↑'}</span>
          <span id="k-hold">${t('train.phase.hold')}${this.touch ? '' : ` · K / ${t('train.space')}`}</span>
          <span id="k-exhale">${t('train.phase.exhale')}${this.touch ? '' : ' · L / ↓'}</span>
        </div>
        <div class="lane" id="lane"><div class="zone" id="zone">${t('train.zone')}</div><div class="puck" id="puck"></div></div>
        <div id="flashword" style="min-height:1.4em"></div>
        <div class="actions">
          <button id="pad-inhale">${t('train.phase.inhale')}${this.touch ? '' : ' · J'}</button>
          <button id="pad-hold">${t('train.phase.hold')}${this.touch ? '' : ' · K'}</button>
          <button id="pad-exhale">${t('train.phase.exhale')}${this.touch ? '' : ' · L'}</button>
        </div>
      </div>
      <div id="result" style="display:none">
        <h2>${t('train.breath')}</h2>
        <p id="result-text"></p>
        <button class="primary" id="train-done">${t('btn.done')}</button>
      </div>
    </div></div>`;
  }

  private apneaShell(): string {
    return `<div class="modal"><div class="panel" style="width:min(560px,100%)">
      <div id="play">
        <div class="dim" id="time"></div>
        <div class="heart" id="hr">70</div>
        <div class="dim">${t('train.hr')} · ${t('train.line')} 118</div>
        <div class="hr-gauge"><div class="hr-fill" id="hr-fill"></div><div class="hr-line" id="hr-line"></div></div>
        <div id="under"></div>
        <button class="primary" id="hold" style="margin-top:12px">${t('train.holdBtn')}${this.touch ? '' : ' · Space'}</button>
      </div>
      <div id="result" style="display:none">
        <h2>${t('train.apnea')}</h2>
        <p id="result-text"></p>
        <button class="primary" id="train-done">${t('btn.done')}</button>
      </div>
    </div></div>`;
  }

  private shop(m: UIModel): string {
    const item = (id: GearId, title: string, desc: string) => {
      const level = m.gear[id];
      const cost = nextCost(id, level);
      const pips = [0, 1, 2].map((i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
      const label = cost == null ? t('btn.max') : m.money < cost ? `${t('shop.poor')} ¥${cost}` : `${t('btn.buy')} ¥${cost}`;
      return `<div class="item panel">
        <h3>${title}</h3>
        <div class="pips">${pips}</div>
        <p>${desc}</p>
        <div class="dim">${f('shop.level', { n: level })}</div>
        <button id="buy-${id}" ${cost == null || m.money < cost ? 'disabled' : ''}>${label}</button>
      </div>`;
    };
    return `<div class="modal"><div class="panel">
      <h2>${t('shop.title')}</h2>
      <div class="shop-grid">
        ${item('fins', t('shop.fins'), t('shop.fins.desc'))}
        ${item('lens', t('shop.lens'), t('shop.lens.desc'))}
        ${item('suit', t('shop.suit'), t('shop.suit.desc'))}
        <div class="item panel locked">
          <h3>${t('shop.hole')}</h3>
          <p>${t('shop.hole.desc')}</p>
          <button disabled>${t('shop.soon')}</button>
        </div>
      </div>
      <div class="actions" style="margin-top:14px"><button id="back">${t('btn.back')}</button></div>
    </div></div>`;
  }

  private album(m: UIModel): string {
    const slot = (key: string, name: string, hint: string, moment: boolean) => {
      const entry = m.album[key];
      const pic = entry?.dataUrl
        ? `<img alt="" src="${entry.dataUrl}" />`
        : `<div class="ph">${moment ? '※' : '?'}</div>`;
      const score = entry ? f('album.best', { n: Math.round(entry.score) }) : t('album.miss');
      return `<div class="slot ${entry ? '' : 'empty'}">${pic}<b>${name}</b><span>${score}</span><span>${hint}</span></div>`;
    };
    const species = SPECIES.map((id) => slot(id, t(`sp.${id}`), t(`hint.${id}`), false)).join('');
    const moments = MOMENTS.map((id) => slot(`m:${id}`, t(`mo.${id}`), t(`hint.${id}`), true)).join('');
    return `<div class="modal"><div class="panel">
      <h2>${t('album.title')}</h2>
      <div class="grid">${species}${moments}</div>
      <div class="actions" style="margin-top:14px"><button id="back">${t('btn.back')}</button></div>
    </div></div>`;
  }

  private dive(m: UIModel): string {
    return `
      ${this.debugPanel(m, true)}
      <div class="hud-tl">
        <div class="lbl">${t('hud.depth')}</div>
        <div class="num" id="depth">0.0</div>
      </div>
      <div class="hud-tr">
        <div class="lbl">${t('hud.film')}</div>
        <div class="num" id="film">5</div>
        <div class="burst" id="burst">${t('toast.kick')}</div>
      </div>
      <div class="meter"><div class="pin" id="pin"></div></div>
      <div class="hud-bc panel">
        <div class="lbl">${t('hud.o2')}</div>
        <div class="bar o2" id="o2bar"><span id="o2fill"></span></div>
        <div class="lbl" style="margin-top:8px">${t('hud.stamina')}</div>
        <div class="bar stamina"><span id="stam"></span></div>
        <div class="warn" id="warn"></div>
      </div>
      <div class="legend">
        <div>${t(m.touch ? 'hud.legend1touch' : 'hud.legend1')}</div>
        <div>${t(m.touch ? 'hud.legend2touch' : 'hud.legend2')}</div>
      </div>
      <div class="vf" id="vf">
        <div class="border"></div>
        <i class="v" style="left:33.33%"></i>
        <i class="v" style="left:66.66%"></i>
        <i class="h" style="top:33.33%"></i>
        <i class="h" style="top:66.66%"></i>
        <div class="reticle"></div>
        <div class="vf-tag" id="focus"></div>
        <div class="vf-mm" id="mm"></div>
      </div>
      <div class="toasts" id="toasts"></div>
      <div id="vignette"></div>
      <div id="blackout"></div>
      <div id="flash"></div>
      <div class="pause" id="pause">
        <div class="panel">
          <h2>${t('hud.pause')}</h2>
          <p class="dim" id="pause-hint"></p>
          <button type="button" class="primary" id="resume">${t(m.touch ? 'btn.resumeTouch' : 'btn.resume')}</button>
          ${m.touch ? `<button type="button" id="touch-end-paused">${t('touch.end')}</button>` : ''}
        </div>
      </div>
      ${this.touchPad(m)}`;
  }

  private touchPad(m: UIModel): string {
    if (!m.touch) return '';
    return `<button type="button" class="touch-pause" id="touch-pause">${t('touch.pause')}</button>
      <div class="touch-pad">
        <button type="button" id="touch-end">${t('touch.end')}</button>
        <button type="button" id="touch-kick">${t('touch.kick')}</button>
        <button type="button" id="touch-sprint">${t('touch.sprint')}</button>
        <button type="button" id="touch-cam">${t('touch.camera')}</button>
        <button type="button" id="touch-shutter">${t('touch.shutter')}</button>
      </div>`;
  }

  private judge(m: UIModel): string {
    if (m.judgePhase === 'review') {
      const frames = m.photos.length
        ? `<div class="film">${m.photos
            .map((p, i) => {
              const empty = !p.score.species;
              const bad = !empty && p.score.total < BALANCE.minAccept;
              const caption = empty
                ? t('judge.emptyStrip')
                : `${f('judge.frame', { n: i + 1 })} · ${p.score.total}${bad ? ` · ${t('judge.rejected')}` : ''}`;
              const cls = empty ? 'empty' : bad ? 'bad' : '';
              return `<figure><img alt="" src="${p.dataUrl}" /><figcaption class="${cls}">${caption}</figcaption></figure>`;
            })
            .join('')}</div>`
        : `<p>${t('judge.none')}</p>`;
      return `<div class="modal"><div class="panel sheet">
        <div class="card-body">
          <p class="dim">${t('judge.kicker')}</p>
          <h2>${t('judge.review')}</h2>
          ${frames}
        </div>
        <div class="actions">
          <button class="primary" id="submit">${t('btn.submit')}</button>
        </div>
      </div></div>`;
    }
    if (m.judgePhase === 'summary' || m.photos.length === 0) {
      const best = m.photos.reduce((n, p) => Math.max(n, p.score.total), 0);
      const rejected = m.photos.filter((p) => p.score.species && p.score.total < BALANCE.minAccept).length;
      return `<div class="modal"><div class="panel settle" style="width:min(460px,100%)">
        <div class="card-body">
          <p class="dim">${t('judge.kicker')}</p>
          <h2>${t('judge.settle')}</h2>
          <div class="sum">
            <div>${t('judge.best')}</div><div>${best}</div>
            <div>${t('judge.rejected')}</div><div>${rejected}</div>
            <div>${t('judge.gross')}</div><div>¥${m.gross}</div>
            <div>${t('judge.fines')}</div><div>¥${m.fines}</div>
            <div>${t('judge.net')}</div><div class="net gold">¥${Math.max(0, m.net)}</div>
            <div>${t('judge.balance')}</div><div>¥${Math.round(m.money)}</div>
          </div>
          <p class="dim">${t('judge.note')}</p>
        </div>
        <div class="actions">
          <button class="primary" id="to-shore">${t('btn.shore')}</button>
        </div>
      </div></div>`;
    }
    const p = m.photos[m.judgeIndex] ?? m.photos[0];
    const last = m.judgeIndex >= m.photos.length - 1;
    const who = p.score.species ? t(`sp.${p.score.species}`) : t('hud.nofocus');
    const moment = p.score.momentId ? ` · ${t(`mo.${p.score.momentId}`)}` : '';
    const row = (label: string, value: number, max: number) =>
      `<div class="score-row"><span>${label}</span><div class="track"><span style="width:${(Math.min(max, value) / max) * 100}%"></span></div><b>${value}</b></div>`;
    return `<div class="modal"><div class="card">
      <div class="card-body">
        <p class="kicker">${t('judge.kicker')}</p>
        <h2>${f('judge.frame', { n: m.judgeIndex + 1 })}</h2>
        <p class="who">${who}${moment}</p>
        <img alt="" src="${p.dataUrl}" />
        ${row(t('judge.comp'), p.score.composition, 30)}
        ${row(t('judge.rarity'), p.score.rarity, 25)}
        ${row(p.score.momentNote === 'action' ? t('judge.momentAction') : p.score.momentNote === 'special' ? t('judge.momentSpecial') : t('judge.moment'), p.score.moment, 25)}
        ${row(t('judge.danger'), p.score.distanceDanger, 20)}
        <div class="total-line"><span>${t('judge.total')}</span><b>${p.score.total}</b></div>
        ${
          !p.score.species
            ? `<p class="comment">${t('judge.emptyNote')}</p><div class="prize">${t('judge.prize')} ¥0</div>`
            : p.score.total < BALANCE.minAccept
              ? `<div class="prize rejected">${t('judge.rejected')}</div><p class="comment">${t('judge.rejectedNote')}</p><div class="prize">${t('judge.prize')} ¥0</div>`
              : `<p class="comment">${t('cmt.' + p.score.comment)}</p><div class="prize">${t('judge.prize')} ¥${p.score.prize}</div>`
        }
      </div>
      <div class="actions">
        <button class="primary" id="next-card">${last ? t('btn.summary') : t('btn.next')}</button>
      </div>
    </div></div>`;
  }

  private patch(m: UIModel): void {
    if (m.mode === 'breath' && m.breath) this.patchBreath(m.breath);
    if (m.mode === 'apnea' && m.apnea) this.patchApnea(m.apnea);
    if (m.mode === 'dive') this.patchDive(m);
  }

  private patchBreath(s: BreathState): void {
    const play = this.root.querySelector('#play') as HTMLElement | null;
    const result = this.root.querySelector('#result') as HTMLElement | null;
    if (!play || !result) return;
    play.style.display = s.done ? 'none' : 'block';
    result.style.display = s.done ? 'block' : 'none';
    if (s.done) {
      const text = this.root.querySelector('#result-text');
      if (text) {
        const acc = Math.round(s.accuracy * 100);
        const gain = Math.round(s.gain * 1000) / 10;
        text.textContent = `${f('train.acc', { n: acc })} · ${gain > 0 ? f('train.lungUp', { n: gain }) : t('train.capped')}`;
      }
      return;
    }
    const phase = breathPhase(s);
    const into = breathInto(s);
    const set = (id: string, text: string) => {
      const el = this.root.querySelector(id);
      if (el) el.textContent = text;
    };
    set('#phase', s.intro > 0 ? t('train.ready') : t(`train.phase.${phase}`));
    set('#how', t(this.touch ? 'train.howTouch' : 'train.how'));
    set('#time', s.intro > 0 ? t('train.ready') : f('train.time', { n: Math.max(0, Math.ceil(s.duration - s.t)) }));
    const zone = this.root.querySelector('#zone') as HTMLElement | null;
    if (zone) {
      zone.style.left = `${BREATH_WINDOW_START * 100}%`;
      zone.style.width = `${(BREATH_WINDOW_END - BREATH_WINDOW_START) * 100}%`;
    }
    for (const name of ['inhale', 'hold', 'exhale'] as BreathPhase[]) {
      const on = s.intro <= 0 && name === phase;
      this.root.querySelector(`#pad-${name}`)?.classList.toggle('now', on);
      this.root.querySelector(`#k-${name}`)?.classList.toggle('now', on);
    }
    const puck = this.root.querySelector('#puck') as HTMLElement | null;
    if (puck) puck.style.left = `${into * 100}%`;
    const lane = this.root.querySelector('#lane');
    lane?.classList.toggle('perfect', s.flash === 'perfect' || s.flash === 'good');
    lane?.classList.toggle('miss', s.flash === 'miss');
    const word = s.flashT > 0 ? t(s.flash === 'perfect' ? 'train.perfect' : s.flash === 'good' ? 'train.good' : 'train.miss') : '';
    set('#flashword', word);
  }

  private patchApnea(s: ApneaState): void {
    const play = this.root.querySelector('#play') as HTMLElement | null;
    const result = this.root.querySelector('#result') as HTMLElement | null;
    if (!play || !result) return;
    play.style.display = s.done ? 'none' : 'block';
    result.style.display = s.done ? 'block' : 'none';
    if (s.done) {
      const text = this.root.querySelector('#result-text');
      if (text) {
        const gain = Math.round(s.gain * 1000) / 10;
        text.textContent = `${f('train.under', { n: s.under.toFixed(1) })} · ${gain > 0 ? f('train.effUp', { n: gain }) : t('train.capped')}`;
      }
      return;
    }
    const hr = this.root.querySelector('#hr');
    if (hr) {
      hr.textContent = String(Math.round(s.hr));
      hr.classList.toggle('fast', s.hr > s.line * 0.92);
    }
    const time = this.root.querySelector('#time');
    if (time) time.textContent = f('train.time', { n: Math.max(0, Math.ceil(s.duration - s.t)) });
    const fill = this.root.querySelector('#hr-fill') as HTMLElement | null;
    if (fill) {
      const pct = Math.min(100, (s.hr / 170) * 100);
      fill.style.width = `${pct}%`;
      fill.classList.toggle('over', s.hr > s.line);
    }
    const line = this.root.querySelector('#hr-line') as HTMLElement | null;
    if (line) line.style.left = `${(s.line / 170) * 100}%`;
    const under = this.root.querySelector('#under');
    if (under) under.textContent = f('train.under', { n: s.under.toFixed(1) });
  }

  private patchDive(m: UIModel): void {
    const set = (id: string, text: string) => {
      const el = this.root.querySelector(id);
      if (el) el.textContent = text;
    };
    set('#depth', m.depth.toFixed(1));
    set('#film', `${m.film}/${m.filmMax}`);
    const o2 = this.root.querySelector('#o2fill') as HTMLElement | null;
    const bar = this.root.querySelector('#o2bar');
    if (o2) o2.style.width = `${Math.max(0, Math.min(100, (m.o2 / m.maxO2) * 100))}%`;
    bar?.classList.toggle('low', m.lowO2);
    const stam = this.root.querySelector('#stam') as HTMLElement | null;
    if (stam) stam.style.width = `${Math.max(0, m.stamina)}%`;
    const warn = this.root.querySelector('#warn');
    if (warn) {
      warn.classList.toggle('charge', m.sharkCharging && !m.atSurface);
      if (m.atSurface) warn.innerHTML = t(m.touch ? 'hud.surfaceTouch' : 'hud.surface');
      else if (m.sharkCharging) warn.textContent = t('hud.sharkCharge');
      else warn.textContent = m.sharkThreat ? t('hud.shark') : m.warnReturn ? t('hud.return') : '';
    }
    const pin = this.root.querySelector('#pin') as HTMLElement | null;
    if (pin) pin.style.top = `${Math.max(0, Math.min(100, (m.depth / 40) * 100))}%`;
    this.root.querySelector('#vf')?.classList.toggle('on', m.viewfinder);
    set('#focus', m.focus);
    set('#mm', f('hud.mm', { n: m.mm }));
    const burst = this.root.querySelector('#burst');
    if (burst) {
      const sprinting = m.burstLeft > 0;
      const cooling = !sprinting && m.burstCd > 0;
      burst.classList.toggle('on', sprinting || cooling);
      burst.classList.toggle('cd', cooling);
      if (sprinting) burst.textContent = `${t('hud.sprint')} ${m.burstLeft.toFixed(1)}`;
      else if (cooling) burst.textContent = `${t('hud.cooldown')} ${m.burstCd.toFixed(1)}`;
    }
    this.root.querySelector('#pause')?.classList.toggle('on', m.paused);
    this.root.classList.toggle('is-paused', m.paused);
    this.root.classList.toggle('surfaced', m.atSurface);
    this.root.classList.toggle('aiming', m.viewfinder);
    const pauseHint = this.root.querySelector('#pause-hint');
    if (pauseHint) {
      pauseHint.innerHTML = m.atSurface
        ? t(m.touch ? 'hud.pauseHintTouch' : 'hud.pauseHint')
        : t(m.touch ? 'hud.pauseSteerTouch' : 'hud.pauseSteer');
    }
    this.root.classList.toggle('charging', m.sharkCharging && !m.atSurface);
    const toast = this.root.querySelector('#toasts');
    if (toast) toast.innerHTML = m.toasts.map((item) => `<div class="toast">${item.text ?? t(item.key)}</div>`).join('');
    const vig = this.root.querySelector('#vignette') as HTMLElement | null;
    const black = this.root.querySelector('#blackout') as HTMLElement | null;
    const flash = this.root.querySelector('#flash') as HTMLElement | null;
    if (vig) vig.style.opacity = String(m.sharkCharging && !m.atSurface ? Math.max(m.vignette, 0.72) : m.vignette);
    if (black) black.style.opacity = String(m.blackout);
    if (flash) flash.style.opacity = String(m.flash);
  }
}

function pct(n: number): number {
  return Math.round(n * 100);
}
