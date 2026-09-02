/** Look an element up by id. Throws rather than handing back a silent null. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`no such element: #${id}`);
  return found as T;
}

/** First child element — the fill div of a progress bar, and the like. */
export function firstChild(parent: HTMLElement): HTMLElement {
  const child = parent.firstElementChild;
  if (!child) throw new Error(`element has no children: #${parent.id}`);
  return child as HTMLElement;
}

/** Find a descendant by selector. Throws when there is none. */
export function queryChild<T extends HTMLElement = HTMLElement>(parent: HTMLElement, selector: string): T {
  const found = parent.querySelector<T>(selector);
  if (!found) throw new Error(`no matching child: #${parent.id} ${selector}`);
  return found;
}

/** A canvas 2D context. Throws when the browser refuses one. */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not get a 2D canvas context');
  return ctx;
}
