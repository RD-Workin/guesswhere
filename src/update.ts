/**
 * Mises à jour acceptées explicitement (idees-securite.md, idée 2) : une
 * nouvelle version publiée n'est jamais installée sans l'accord de l'utilisateur.
 */

/** Page publique qui liste les changements de chaque version. */
export const CHANGES_URL = 'https://github.com/RD-Workin/guesswhere/commits/main';

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

/** Une nouvelle version est-elle prête et en attente d'accord ? */
export const updateWaiting = () => waiting !== null;
export const onUpdateWaiting = (fn: () => void) => listeners.add(fn);

/**
 * Enregistre le service worker. Une nouvelle version ne remplace pas
 * l'ancienne d'elle-même : elle attend que l'utilisateur l'accepte.
 */
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('./sw.js');
  const flag = (w: ServiceWorker | null) => {
    if (!w || !navigator.serviceWorker.controller) return; // première installation : rien à accepter
    waiting = w;
    listeners.forEach((fn) => fn());
  };
  flag(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => w.state === 'installed' && flag(w));
  });
}

/** Active la version en attente puis recharge l'app. */
export function acceptUpdate(): void {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage('activer');
}

/** Empreinte de la version installée (celle du service worker actif). */
export function installedVersion(): Promise<string> {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve('version de développement');
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.version) {
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve(e.data.version);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    sw.postMessage('version');
    setTimeout(() => resolve('inconnue'), 2000);
  });
}
