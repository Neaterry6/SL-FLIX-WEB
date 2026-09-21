import { CaptionSettings } from '../types';
export type { CaptionSettings };

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  fontFamily: 'sans',
  fontSize: 'medium',
  fontColor: '#ffffff',
  bgColor: 'black-solid',
  bgOpacity: 85,
  textShadow: 'drop-shadow',
  textOutline: true,
  fontWeight: 'semibold'
};

const STORAGE_KEY = 'slflix_caption_settings';

export function getStoredCaptionSettings(): CaptionSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_CAPTION_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Failed to parse stored caption settings:', e);
  }
  return DEFAULT_CAPTION_SETTINGS;
}

export function saveStoredCaptionSettings(settings: CaptionSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('slflix_caption_settings_change', { detail: settings }));
  } catch (e) {
    console.error('Failed to save caption settings:', e);
  }
}

export function getCaptionFontFamilyCss(family: string): string {
  switch (family) {
    case 'roboto':
      return 'system-ui, -apple-system, Roboto, sans-serif';
    case 'serif':
      return 'Georgia, Cambria, "Times New Roman", serif';
    case 'mono':
      return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    case 'impact':
      return 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
    case 'comic':
      return '"Comic Sans MS", "Comic Sans", cursive, sans-serif';
    case 'sans':
    default:
      return 'Manrope, system-ui, sans-serif';
  }
}

export function getCaptionBgCss(bgColor: string, opacity: number): string {
  const alpha = Math.min(Math.max(opacity / 100, 0), 1);
  switch (bgColor) {
    case 'transparent':
      return 'transparent';
    case 'black-semi':
      return `rgba(0, 0, 0, ${alpha * 0.6})`;
    case 'charcoal':
      return `rgba(22, 22, 38, ${alpha})`;
    case 'neon':
      return `rgba(0, 30, 45, ${alpha})`;
    case 'black-solid':
    default:
      return `rgba(0, 0, 0, ${alpha})`;
  }
}

export function getCaptionTextShadowCss(shadowType: string, outline: boolean, color: string): string {
  const shadows: string[] = [];
  if (shadowType === 'drop-shadow') {
    shadows.push('0 2px 5px rgba(0,0,0,0.95)', '0 0 2px rgba(0,0,0,0.8)');
  } else if (shadowType === 'glow') {
    shadows.push('0 0 10px rgba(0,229,255,0.7)', '0 0 20px rgba(0,229,255,0.4)');
  }

  if (outline) {
    shadows.push(
      '-1px -1px 0 #000',
      '1px -1px 0 #000',
      '-1px 1px 0 #000',
      '1px 1px 0 #000',
      '0 2px 4px rgba(0,0,0,0.9)'
    );
  }

  return shadows.length > 0 ? shadows.join(', ') : 'none';
}
