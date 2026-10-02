type Child = Node | string | null | undefined | false;

/** Minimal element builder: attributes go through setAttribute, except on* handlers and className. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | boolean | ((event: Event) => void) | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value === 'function') {
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === 'className' && typeof value === 'string') {
      element.className = value;
    } else if (value === true) {
      element.setAttribute(name, '');
    } else if (typeof value === 'string') {
      element.setAttribute(name, value);
    }
  }
  element.append(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false));
  return element;
}
