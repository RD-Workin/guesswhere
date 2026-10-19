type Child = Node | string | false | null | undefined;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Petit utilitaire de création d'éléments, sans innerHTML (aucune injection possible). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export function screen(...children: Child[]): HTMLElement {
  const root = document.getElementById('app')!;
  const el = h('main', { class: 'ecran' }, ...children);
  root.replaceChildren(el);
  return el;
}

/** Nombre au format français : 1 830 (espace insécable fine). */
export const nf = (n: number) => n.toLocaleString('fr-FR');

export const plural = (n: number, one: string, many: string) => `${nf(n)} ${n > 1 ? many : one}`;
