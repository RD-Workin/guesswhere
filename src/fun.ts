import { h } from './ui';

/** « Réduire les animations » d'iOS : plus aucun mouvement, valeurs finales tout de suite. */
export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface Verdict {
  emoji: string;
  text: string;
  /** Couleur du bandeau de résultat (classe CSS). */
  tone: 'top' | 'bien' | 'moyen' | 'loin';
}

/** Phrase de réaction après une manche, d'après les points (paliers d'environ un facteur 10 sur la distance). */
export function verdict(score: number): Verdict {
  if (score >= 4800) return { emoji: '🎯', text: 'Pile dessus !', tone: 'top' };
  if (score >= 4000) return { emoji: '🔥', text: 'Excellent !', tone: 'top' };
  if (score >= 3100) return { emoji: '😎', text: 'Très bien vu !', tone: 'bien' };
  if (score >= 2100) return { emoji: '👍', text: 'Pas mal du tout', tone: 'bien' };
  if (score >= 1200) return { emoji: '🤔', text: 'La bonne région… presque', tone: 'moyen' };
  return { emoji: '🌍', text: 'Le monde est grand !', tone: 'loin' };
}

/** Étoiles de fin de partie, sur 3, d'après la part du score maximal. */
export function stars(total: number, max: number): number {
  const r = max > 0 ? total / max : 0;
  return r >= 0.8 ? 3 : r >= 0.6 ? 2 : r >= 0.4 ? 1 : 0;
}

/** Compteur qui défile jusqu'à la valeur finale (à décorer : l'élément doit être aria-hidden). */
let skipped = 0;
/** Termine d'un coup les compteurs en cours (appui pour enchaîner plus vite). */
export const skipCounters = () => { skipped = performance.now(); };

export function countUp(el: HTMLElement, to: number, format: (n: number) => string, ms = 900) {
  if (calm() || to <= 0) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (t: number) => {
    const k = skipped >= t0 ? 1 : Math.min(1, (t - t0) / ms);
    el.textContent = format(Math.round(to * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = format(0);
  requestAnimationFrame(step);
}

const CONFETTI = ['#ffcc00', '#ff9f0a', '#ff375f', '#30d158', '#0a84ff', '#bf5af2'];

/** Pluie de confettis, purement décorative, retirée après l'animation. */
export function confetti(n = 48) {
  if (calm()) return;
  const layer = h('div', { class: 'confettis', 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) {
    const c = h('i');
    c.style.setProperty('--x', `${Math.random() * 100}vw`);
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 40}vw`);
    c.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    c.style.setProperty('--d', `${(1.6 + Math.random() * 1.4).toFixed(2)}s`);
    c.style.setProperty('--delai', `${(Math.random() * 0.4).toFixed(2)}s`);
    c.style.setProperty('--c', CONFETTI[i % CONFETTI.length]);
    layer.append(c);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3600);
}
