/**
 * Preferences (accessibility, notifications, privacy) + React glue for the
 * visual engines.
 *
 * Everything lives in localStorage: the app is local-first, and none of this
 * ever leaves the machine (spec §43). Accessibility toggles are applied as data
 * attributes on <html> so the CSS can respond without React re-renders.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { visualEngine, type QualityTier, type VisualProfile } from './visual-engine';

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

export interface Preferences {
  largeText: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  lowData: boolean;
  /** Notifications for new devices, drops, disconnects and applied fixes. */
  notifyDevices: boolean;
  notifySpeedDrop: boolean;
  notifyDisconnect: boolean;
  notifySmartFix: boolean;
  /** Advanced Mode visibility. */
  advanced: boolean;
  /** One-time developer welcome screen. */
  developerWelcomeSeen: boolean;
  qualityOverride?: QualityTier;
}

const DEFAULTS: Preferences = {
  largeText: false,
  highContrast: false,
  reducedMotion: false,
  lowData: false,
  notifyDevices: true,
  notifySpeedDrop: true,
  notifyDisconnect: true,
  notifySmartFix: true,
  advanced: false,
  developerWelcomeSeen: false,
};

const STORAGE_KEY = 'urlm.preferences.v1';

function loadPreferences(): Preferences {
  if (typeof localStorage === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return DEFAULTS;
  }
}

function applyPreferences(preferences: Preferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.text = preferences.largeText ? 'large' : 'normal';
  root.dataset.contrast = preferences.highContrast ? 'high' : 'normal';
  root.dataset.motion = preferences.reducedMotion ? 'reduced' : 'full';
}

let preferences: Preferences = typeof window === 'undefined' ? DEFAULTS : loadPreferences();
const preferenceListeners = new Set<() => void>();

export function getPreferences(): Preferences {
  return preferences;
}

export function updatePreferences(patch: Partial<Preferences>): void {
  preferences = { ...preferences, ...patch };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }
  applyPreferences(preferences);
  if (patch.reducedMotion !== undefined) {
    document.documentElement.dataset.motion = patch.reducedMotion ? 'reduced' : 'full';
  }
  if (patch.qualityOverride !== undefined || patch.reducedMotion !== undefined) {
    visualEngine.setTierOverride(preferences.qualityOverride, true);
  }
  for (const listener of preferenceListeners) listener();
}

export function initPreferences(): void {
  applyPreferences(preferences);
  visualEngine.restoreTierOverride();
  if (preferences.reducedMotion) visualEngine.setTierOverride('lite', false);
}

/* ------------------------------------------------------------------ *
 * React context
 * ------------------------------------------------------------------ */

interface VisualContextValue {
  profile: VisualProfile;
  fps: number;
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
  report: () => Record<string, unknown>;
}

const VisualContext = createContext<VisualContextValue | null>(null);

export function VisualProvider({ children }: { children: ReactNode }): JSX.Element {
  const [profile, setProfile] = useState<VisualProfile>(visualEngine.getSnapshot());
  const [prefs, setPrefs] = useState<Preferences>(getPreferences());
  const [fps, setFps] = useState(60);

  useEffect(() => {
    visualEngine.start();
    const unsubscribe = visualEngine.subscribe(() => setProfile(visualEngine.getSnapshot()));
    const onPreferences = () => setPrefs(getPreferences());
    preferenceListeners.add(onPreferences);
    const fpsTimer = window.setInterval(() => setFps(visualEngine.fps), 2000);
    return () => {
      unsubscribe();
      preferenceListeners.delete(onPreferences);
      window.clearInterval(fpsTimer);
    };
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => updatePreferences(patch), []);
  const report = useCallback(() => ({ ...visualEngine.report(), preferences: getPreferences() }), []);
  const value = useMemo<VisualContextValue>(
    () => ({ profile, fps, preferences: prefs, update, report }),
    [profile, fps, prefs, update, report],
  );

  return <VisualContext.Provider value={value}>{children}</VisualContext.Provider>;
}

export function useVisuals(): VisualContextValue {
  const context = useContext(VisualContext);
  if (!context) throw new Error('useVisuals must be used inside <VisualProvider>');
  return context;
}

/**
 * Register a per-frame callback with a frame budget. The callback receives a
 * mutable ref object — never React state — so the hot path allocates nothing.
 */
export function useTicker(
  id: string,
  callback: (now: number, deltaMs: number) => void,
  fps = 60,
  enabled = true,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const handler = (now: number, delta: number) => callbackRef.current(now, delta);
    visualEngine.addTicker(`${id}`, handler, fps);
    return () => visualEngine.removeTicker(`${id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fps, enabled]);
}

/** Number that eases towards its target — used by the speed-test counters. */
export function useAnimatedNumber(value: number, durationMs = 450): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = performance.now();
    const from = fromRef.current;
    const delta = value - from;
    if (Math.abs(delta) < 0.005) {
      setDisplay(value);
      return;
    }
    const step = (now: number) => {
      const progress = Math.min(1, (now - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + delta * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return display;
}

/** True while the document is hidden — lets panels park their work. */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Ticking clock for "آخر تحديث" labels — 1 Hz, cheap, only where used. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
