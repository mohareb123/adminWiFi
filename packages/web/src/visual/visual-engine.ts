/**
 * SmoothnessEngine + AdaptiveVisualEngine (spec §30/§31, §41/§48/§54).
 *
 * One animation frame loop for the whole app:
 *  - every effect layer registers a *ticker* with its own frame budget
 *    (graphs at 30 FPS, the network map at up to 60, chrome at 10);
 *  - an FPS governor watches the real frame rate and steps the visual quality
 *    down *before* the user notices a stutter, and back up when the device
 *    proves it can take it;
 *  - the loop pauses entirely when the tab is hidden or motion is reduced —
 *    no permanent animation is allowed to burn battery.
 *
 * Nothing in here touches the network or React state on the hot path: tickers
 * receive time, not data, and data is pulled from refs the components own.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

export type QualityTier = 'ultra' | 'high' | 'balanced' | 'lite';

export interface VisualProfile {
  tier: QualityTier;
  /** Frame budget used by the governor. */
  targetFps: number;
  /** Particles in the network map. */
  particles: number;
  /** Blur radius cap in px (0 = no blur at all). */
  blurPx: number;
  glow: boolean;
  gradients: boolean;
  animations: boolean;
  /** Background grid / aurora layers. */
  backdrop: boolean;
}

const TIERS: Record<QualityTier, VisualProfile> = {
  ultra: { tier: 'ultra', targetFps: 120, particles: 64, blurPx: 26, glow: true, gradients: true, animations: true, backdrop: true },
  high: { tier: 'high', targetFps: 60, particles: 44, blurPx: 20, glow: true, gradients: true, animations: true, backdrop: true },
  balanced: { tier: 'balanced', targetFps: 60, particles: 26, blurPx: 12, glow: true, gradients: true, animations: true, backdrop: true },
  lite: { tier: 'lite', targetFps: 30, particles: 12, blurPx: 0, glow: false, gradients: false, animations: false, backdrop: false },
};

export const TIER_PROFILES = TIERS;

export interface DeviceCapability {
  cores: number;
  memoryGb?: number;
  estimatedRefreshHz: number;
  saveData: boolean;
  reducedMotion: boolean;
  reducedTransparency: boolean;
  touch: boolean;
}

interface Ticker {
  id: string;
  callback: (now: number, deltaMs: number) => void;
  /** Minimum milliseconds between calls (frame budget). */
  intervalMs: number;
  lastRun: number;
  priority: number;
}

export class VisualEngine {
  private tickers = new Map<string, Ticker>();
  private listeners = new Set<() => void>();
  private frameHandle = 0;
  private lastFrameAt = 0;
  private frameDurations: number[] = [];
  private lastGovernorAt = 0;
  private downgradeStreak = 0;
  private upgradeStreak = 0;
  private running = false;

  capability: DeviceCapability = {
    cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
    estimatedRefreshHz: 60,
    saveData: false,
    reducedMotion: false,
    reducedTransparency: false,
    touch: typeof window !== 'undefined' && 'ontouchstart' in window,
  };

  /** Current measured frames per second (smoothed). */
  fps = 60;

  profile: VisualProfile = TIERS.balanced;

  private tierOverride?: QualityTier;

  constructor() {
    if (typeof window === 'undefined') return;
    this.probeCapability();
  }

  /* ------------------------------------------------------------------ *
   * Capability probe (runs once, never blocks the main thread)
   * ------------------------------------------------------------------ */

  private probeCapability(): void {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const transparencyQuery = window.matchMedia('(prefers-reduced-transparency: reduce)');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

    this.capability = {
      ...this.capability,
      memoryGb: memory,
      saveData: Boolean(connection?.saveData) || connection?.effectiveType === 'slow-2g',
      reducedMotion: motionQuery.matches,
      reducedTransparency: transparencyQuery.matches,
    };

    // Measure the real screen refresh rate over 600 ms without blocking input.
    let frames = 0;
    const started = performance.now();
    const sample = (now: number) => {
      frames += 1;
      if (now - started < 600) {
        requestAnimationFrame(sample);
        return;
      }
      const hz = frames / ((now - started) / 1000);
      this.capability.estimatedRefreshHz = hz > 100 ? 120 : hz > 75 ? 90 : 60;
      this.applyAutoTier();
    };
    requestAnimationFrame(sample);

    motionQuery.addEventListener?.('change', (event) => {
      this.capability = { ...this.capability, reducedMotion: event.matches };
      this.refreshProfile();
    });
    transparencyQuery.addEventListener?.('change', (event) => {
      this.capability = { ...this.capability, reducedTransparency: event.matches };
      this.refreshProfile();
    });
  }

  private applyAutoTier(): void {
    this.refreshProfile();
  }

  /** Picks a starting tier from the device, then lets the governor adjust it. */
  private suggestedTier(): QualityTier {
    const { cores, memoryGb, reducedMotion, saveData, reducedTransparency, estimatedRefreshHz } = this.capability;
    if (reducedMotion || saveData) return 'lite';
    const weak = cores <= 4 || (memoryGb !== undefined && memoryGb <= 4);
    if (weak) return reducedTransparency ? 'lite' : 'balanced';
    if (this.capability.touch && cores <= 6) return 'balanced';
    if (estimatedRefreshHz >= 120 && cores >= 8) return 'ultra';
    return 'high';
  }

  setTierOverride(tier: QualityTier | undefined, persist = true): void {
    this.tierOverride = tier;
    if (persist && typeof localStorage !== 'undefined') {
      if (tier) localStorage.setItem('urlm.quality', tier);
      else localStorage.removeItem('urlm.quality');
    }
    this.refreshProfile();
  }

  restoreTierOverride(): void {
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem('urlm.quality') as QualityTier | null;
    if (stored && stored in TIERS) this.tierOverride = stored;
    this.refreshProfile();
  }

  private refreshProfile(): void {
    const tier = this.tierOverride ?? this.suggestedTier();
    const base = TIERS[tier];
    const particles = this.capability.reducedMotion ? 0 : base.particles;
    const animations = base.animations && !this.capability.reducedMotion;
    const next: VisualProfile = {
      ...base,
      particles,
      animations,
      backdrop: base.backdrop && !this.capability.reducedMotion,
      blurPx: this.capability.reducedTransparency ? 0 : base.blurPx,
    };
    this.profile = next;
    this.publishVisualProfile();
    for (const listener of this.listeners) listener();
  }

  private publishVisualProfile(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const { tier, blurPx, particles, animations, gradients, glow, backdrop } = this.profile;
    root.dataset.quality = tier;
    root.style.setProperty('--blur-strength', `${blurPx}px`);
    root.style.setProperty('--particle-count', String(particles));
    root.dataset.animations = animations ? 'on' : 'off';
    root.dataset.gradients = gradients ? 'on' : 'off';
    root.dataset.glow = glow ? 'on' : 'off';
    root.dataset.backdrop = backdrop ? 'on' : 'off';
    root.dataset.reducedMotion = this.capability.reducedMotion ? 'on' : 'off';
    root.dataset.refresh = String(this.capability.estimatedRefreshHz);
  }

  /* ------------------------------------------------------------------ *
   * Subscription (React)
   * ------------------------------------------------------------------ */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VisualProfile => this.profile;

  /* ------------------------------------------------------------------ *
   * Ticker registry — one loop for every effect layer
   * ------------------------------------------------------------------ */

  addTicker(id: string, callback: (now: number, deltaMs: number) => void, fps = 60, priority = 0): void {
    this.tickers.set(id, { id, callback, intervalMs: fps >= 1000 ? 0 : 1000 / fps, lastRun: 0, priority });
    this.start();
  }

  removeTicker(id: string): void {
    this.tickers.delete(id);
    if (this.tickers.size === 0) this.stop();
  }

  start(): void {
    if (this.running || typeof window === 'undefined') return;
    this.running = true;
    this.lastFrameAt = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.frameHandle = requestAnimationFrame(loop);
      const delta = now - this.lastFrameAt;
      this.lastFrameAt = now;
      this.recordFrame(delta, now);
      this.runTickers(now, delta);
    };
    this.frameHandle = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    // Hidden tab: everything stops. No exceptions (spec §48).
    if (document.hidden) {
      this.lastFrameAt = performance.now();
    } else {
      this.lastFrameAt = performance.now();
    }
  };

  private runTickers(now: number, delta: number): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    const ordered = [...this.tickers.values()].sort((a, b) => b.priority - a.priority);
    for (const ticker of ordered) {
      if (ticker.intervalMs > 0 && now - ticker.lastRun < ticker.intervalMs) continue;
      ticker.lastRun = now;
      try {
        ticker.callback(now, delta);
      } catch {
        this.tickers.delete(ticker.id);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * FPS governor
   * ------------------------------------------------------------------ */

  private recordFrame(delta: number, now: number): void {
    this.frameDurations.push(delta);
    if (this.frameDurations.length > 90) this.frameDurations.shift();
    if (now - this.lastGovernorAt < 1200) return;
    this.lastGovernorAt = now;

    const average = this.frameDurations.reduce((total, value) => total + value, 0) / this.frameDurations.length;
    this.fps = Math.min(240, Math.round(1000 / Math.max(1, average)));
    if (this.tierOverride) return;

    const target = this.profile.targetFps;
    if (this.fps < Math.min(50, target * 0.75)) {
      this.downgradeStreak += 1;
      this.upgradeStreak = 0;
    } else if (this.fps >= Math.min(target, 58)) {
      this.upgradeStreak += 1;
      this.downgradeStreak = 0;
    } else {
      this.downgradeStreak = 0;
      this.upgradeStreak = 0;
    }

    if (this.downgradeStreak >= 3) {
      this.downgradeStreak = 0;
      const order: QualityTier[] = ['ultra', 'high', 'balanced', 'lite'];
      const index = order.indexOf(this.profile.tier);
      if (index >= 0 && index < order.length - 1) {
        this.profile = TIERS[order[index + 1] as QualityTier];
        this.publishVisualProfile();
        for (const listener of this.listeners) listener();
      }
    } else if (this.upgradeStreak >= 6) {
      this.upgradeStreak = 0;
      const order: QualityTier[] = ['lite', 'balanced', 'high', 'ultra'];
      const index = order.indexOf(this.profile.tier);
      const ceiling = this.suggestedTier();
      const ceilingIndex = order.indexOf(ceiling);
      if (index >= 0 && index < ceilingIndex) {
        this.profile = TIERS[order[index + 1] as QualityTier];
        this.publishVisualProfile();
        for (const listener of this.listeners) listener();
      }
    }
  }

  /** Diagnostics for the Advanced Mode performance panel. */
  report(): Record<string, unknown> {
    return {
      tier: this.profile.tier,
      fps: this.fps,
      frameBudgetMs: Math.round(1000 / this.profile.targetFps),
      tickers: [...this.tickers.keys()],
      device: this.capability,
      autoTier: this.tierOverride ? `locked:${this.tierOverride}` : 'automatic',
    };
  }
}

export const visualEngine = new VisualEngine();
