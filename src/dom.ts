/** id로 엘리먼트를 찾는다. 없으면 즉시 실패시켜 조용한 null 참조를 막는다. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`DOM 요소를 찾을 수 없다: #${id}`);
  return found as T;
}

/** 첫 자식 엘리먼트(진행 바의 채움 div 등). */
export function firstChild(parent: HTMLElement): HTMLElement {
  const child = parent.firstElementChild;
  if (!child) throw new Error(`자식 엘리먼트가 없다: #${parent.id}`);
  return child as HTMLElement;
}

/** 부모 안에서 셀렉터로 자식을 찾는다. 없으면 즉시 실패. */
export function queryChild<T extends HTMLElement = HTMLElement>(parent: HTMLElement, selector: string): T {
  const found = parent.querySelector<T>(selector);
  if (!found) throw new Error(`자식 엘리먼트를 찾을 수 없다: #${parent.id} ${selector}`);
  return found;
}

/** 캔버스의 2D 컨텍스트. 없으면 즉시 실패. */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D 캔버스 컨텍스트를 만들 수 없다');
  return ctx;
}
