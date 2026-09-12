import { SETTINGS_CONTROLS, SETTINGS_DEFAULTS } from './config';
import { el } from './dom';
import { onSettingsChange, resetSettings, setSetting, settings } from './settings';
import type { Settings } from './types';

const panel = el('settings');
const rows = new Map<keyof Settings, { input: HTMLInputElement; output: HTMLOutputElement }>();

function refresh(): void {
  for (const [key, row] of rows) {
    row.input.value = String(settings[key]);
    row.output.value = key === 'fov' ? `${settings[key]}°`
      : key.endsWith('Sensitivity') ? `${(settings[key] / SETTINGS_DEFAULTS[key]).toFixed(1)}×`
        : `${Math.round(settings[key] * 100)}%`;
  }
}

/** Lazy construction keeps DOM wiring out of the renderer's import cycle. */
export function openSettingsPanel(): void {
  if (!rows.size) {
    for (const key of Object.keys(SETTINGS_CONTROLS)) {
      // The keys originate in our complete Settings descriptor, not saved JSON.
      const field = key as keyof Settings;
      const control = SETTINGS_CONTROLS[field];
      const label = document.createElement('label');
      label.className = 'settingRow';
      const name = document.createElement('span');
      name.textContent = control.label;
      const input = document.createElement('input');
      input.id = `setting-${field}`;
      input.type = 'range';
      input.min = String(control.min); input.max = String(control.max); input.step = String(control.step);
      const output = document.createElement('output');
      output.htmlFor.add(input.id);
      input.addEventListener('input', () => setSetting(field, input.valueAsNumber));
      label.append(name, output, input);
      el('settingsRows').append(label);
      rows.set(field, { input, output });
    }
    el('settingsReset').addEventListener('click', resetSettings);
    onSettingsChange(refresh);
  }
  refresh();
  panel.style.display = 'flex';
}
export function closeSettingsPanel(): void { panel.style.display = 'none'; }
