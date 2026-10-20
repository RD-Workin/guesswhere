/** Apparence : suit le réglage de l'iPhone, ou clair / sombre forcé depuis les Réglages. */
export type Theme = 'auto' | 'clair' | 'sombre';

const KEY = 'apparence';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'clair' || t === 'sombre' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme;
  else root.dataset.theme = t === 'sombre' ? 'dark' : 'light';
  // Barre d'état d'iOS : même couleur que le fond choisi.
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name=theme-color]')) {
    const light = m.media.includes('light');
    m.content = t === 'auto' ? (light ? '#f2f2f7' : '#000000') : t === 'sombre' ? '#000000' : '#f2f2f7';
  }
}

export function setTheme(t: Theme) {
  try {
    if (t === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch { /* stockage indisponible : le choix vaut pour cette ouverture */ }
  applyTheme(t);
}

export const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
