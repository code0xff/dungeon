import { SETTINGS_CONTROLS, SETTINGS_DEFAULTS } from './config';
import type { Settings } from './types';

const KEY = 'dungeon.settings.v1';
export const settings: Settings = { ...SETTINGS_DEFAULTS };
const listeners = new Set<() => void>();

function valid(key: keyof Settings, value: number): number {
  const { min, max } = SETTINGS_CONTROLS[key];
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : SETTINGS_DEFAULTS[key];
}

try {
  const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  if (typeof saved === 'object' && saved !== null) {
    for (const key of Object.keys(SETTINGS_DEFAULTS)) {
      // Keys come from the typed defaults, never from untrusted storage.
      const field = key as keyof Settings;
      const value: unknown = Reflect.get(saved, key);
      if (typeof value === 'number') settings[field] = valid(field, value);
    }
  }
} catch (error: unknown) {
  console.warn('[settings] preferences unavailable; using defaults', error);
}

function publish(): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); }
  catch (error: unknown) { console.warn('[settings] preferences could not be saved; changes apply this session', error); }
  for (const listener of listeners) listener();
}

/** Subscribers apply preferences; this data layer never imports renderer or audio. */
export function onSettingsChange(listener: () => void): void { listeners.add(listener); }
export function setSetting(key: keyof Settings, value: number): void {
  settings[key] = valid(key, value);
  publish();
}
export function resetSettings(): void {
  Object.assign(settings, SETTINGS_DEFAULTS);
  publish();
}
