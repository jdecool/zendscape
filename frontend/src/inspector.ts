import { api, type Neighbourhood, type NodeSummary, type PathStep } from './api';
import { h } from './dom';
import { formatBytes, humanizeLabel, humanizeType } from './format';

export type View =
  | { kind: 'classes' }
  | { kind: 'instances'; className: string }
  | { kind: 'largest' }
  | { kind: 'search'; query: string }
  | { kind: 'node'; id: number };

export interface InspectorHost {
  /** Snapshot currently explored, null when none is open. */
  snapshot(): number | null;
  /** Selects a node in the scene; returns whether it has memory drawn there. */
  focus(node: number, fly: boolean): boolean;
  /** Retention paths of the inspected node, as node ids from root to node, for the scene to draw. */
  showPaths(paths: number[][]): void;
}

const ADDRESS = /^(?:0x)?[0-9a-f]{6,16}$/i;

/**
 * The right-hand panel: lists to find suspects (classes, largest, search)
 * and a node view explaining what a node is and why it is still alive.
 * Views stack so Back returns to the list a node was picked from.
 */
export class Inspector {
  private history: View[] = [];
  private references: { direction: 'in' | 'out'; depth: number } = { direction: 'out', depth: 1 };
  /** Bumped on every render so late responses for a previous view are dropped. */
  private generation = 0;

  constructor(
    private readonly body: HTMLElement,
    private readonly tabs: HTMLElement,
    private readonly host: InspectorHost,
  ) {
    for (const button of tabs.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
      button.addEventListener('click', () => {
        const kind = button.dataset.view;
        this.open(kind === 'largest' ? { kind: 'largest' } : kind === 'search' ? { kind: 'search', query: '' } : { kind: 'classes' }, true);
      });
    }
  }

  get current(): View | undefined {
    return this.history[this.history.length - 1];
  }

  /** Shows a view; a root view (a tab) resets the history. */
  open(view: View, root = false): void {
    this.history = root ? [view] : [...this.history, view];
    this.render();
  }

  back(): void {
    if (this.history.length > 1) {
      this.history.pop();
      this.render();
    }
  }

  /** Inspects a node picked in the scene: replaces a node view rather than stacking up clicks. */
  inspect(node: number): void {
    if (this.current?.kind === 'node') {
      this.history.pop();
    }
    this.open({ kind: 'node', id: node });
  }

  /** Leaves the node view after the scene selection was cleared. */
  deselect(): void {
    if (this.current?.kind === 'node') {
      this.back();
    }
  }

  render(): void {
    const view = this.current;
    const snapshot = this.host.snapshot();
    const generation = ++this.generation;
    const tabView = this.history[0]?.kind === 'instances' ? 'classes' : this.history[0]?.kind;
    for (const button of this.tabs.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
      button.setAttribute('aria-current', String(button.dataset.view === tabView));
    }
    if (view?.kind !== 'node') {
      this.host.showPaths([]);
    }
    if (!view || snapshot === null) {
      this.body.replaceChildren();
      return;
    }

    const live = (): boolean => generation === this.generation;
    const content = h('div', { className: 'view' });
    this.body.replaceChildren(...(this.history.length > 1 ? [this.backButton()] : []), content);

    const fill = (task: Promise<Node[]>): void => {
      content.replaceChildren(h('p', { className: 'muted' }, 'Loading…'));
      task.then(
        (nodes) => {
          if (live()) {
            content.replaceChildren(...nodes);
          }
        },
        (error: unknown) => {
          if (live()) {
            content.replaceChildren(h('p', { className: 'error' }, error instanceof Error ? error.message : String(error)));
          }
        },
      );
    };

    switch (view.kind) {
      case 'classes':
        fill(this.classes(snapshot));
        break;
      case 'instances':
        fill(this.instances(snapshot, view.className));
        break;
      case 'largest':
        fill(api.topRetained(snapshot).then((nodes) => [h('h2', {}, 'Largest retained'), this.nodeList(nodes, 'retained')]));
        break;
      case 'search':
        content.replaceChildren(...this.search(snapshot, view, live));
        break;
      case 'node':
        fill(this.node(snapshot, view.id, live));
        break;
    }
  }

  private backButton(): HTMLButtonElement {
    const previous = this.history[this.history.length - 2];
    const label = previous?.kind === 'instances' ? previous.className : previous?.kind === 'node' ? 'previous node' : (previous?.kind ?? '');
    return h('button', { type: 'button', className: 'back', onclick: () => { this.back(); } }, `Back to ${label}`);
  }

  private async classes(snapshot: number): Promise<Node[]> {
    const classes = await api.classes(snapshot);
    if (classes.length === 0) {
      return [h('p', { className: 'muted' }, 'This snapshot holds no objects.')];
    }
    return [
      h('h2', {}, 'Objects by class'),
      h(
        'ol',
        { className: 'rows' },
        ...classes.map((usage) =>
          h(
            'li',
            {},
            h(
              'button',
              { type: 'button', className: 'row', onclick: () => { this.open({ kind: 'instances', className: usage.class }); } },
              h('span', { className: 'row-name' }, usage.class),
              h('span', { className: 'row-meta' }, `${usage.count.toLocaleString('en')} × `, formatBytes(usage.totalShallowSize / Math.max(usage.count, 1))),
              h('span', { className: 'row-size' }, formatBytes(usage.totalShallowSize)),
            ),
          ),
        ),
      ),
    ];
  }

  private async instances(snapshot: number, className: string): Promise<Node[]> {
    const nodes = await api.instances(snapshot, className);
    return [h('h2', {}, `${className} instances, largest first`), this.nodeList(nodes, 'retained')];
  }

  private search(snapshot: number, view: { kind: 'search'; query: string }, live: () => boolean): Node[] {
    const results = h('div', {});
    const input = h('input', {
      type: 'search',
      className: 'search',
      placeholder: 'Class, string or 0x address',
      'aria-label': 'Search nodes',
      value: view.query,
    });
    let timer: number | undefined;
    const run = (): void => {
      const query = input.value.trim();
      view.query = query;
      if (query === '') {
        results.replaceChildren(h('p', { className: 'muted' }, 'Search class names, function names and string values, or jump to an address.'));
        return;
      }
      results.replaceChildren(h('p', { className: 'muted' }, 'Searching…'));
      void (async () => {
        try {
          if (ADDRESS.test(query)) {
            const { node } = await api.byAddress(snapshot, query.replace(/^0x/i, ''));
            if (node !== null && live()) {
              this.select(node);
              return;
            }
          }
          // The server ranks by retained size; someone typing an exact value wants that value first.
          const exact = (label: string): boolean => label.endsWith(`= "${query}"`) || label.endsWith(`: ${query}`);
          const nodes = (await api.search(snapshot, query)).sort((a, b) => Number(exact(b.label)) - Number(exact(a.label)));
          if (live() && input.value.trim() === query) {
            results.replaceChildren(nodes.length === 0 ? h('p', { className: 'muted' }, `Nothing matches “${query}”.`) : this.nodeList(nodes, 'retained'));
          }
        } catch (error) {
          if (live()) {
            results.replaceChildren(h('p', { className: 'error' }, error instanceof Error ? error.message : String(error)));
          }
        }
      })();
    };
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 250);
    });
    run();
    queueMicrotask(() => {
      input.focus();
    });
    return [input, results];
  }

  private async node(snapshot: number, id: number, live: () => boolean): Promise<Node[]> {
    const [detail, paths] = await Promise.all([api.node(snapshot, id), api.retentionPaths(snapshot, id)]);
    if (live()) {
      this.host.showPaths(paths.map((path) => path.map((step) => step.node.id).reverse()));
    }
    const inScene = this.host.focus(id, false);

    const facts: [string, string, string?][] = [];
    if (detail.class !== null) {
      facts.push(['Type', humanizeType(detail.type)]);
    }
    if (detail.stringValue !== null) {
      facts.push(['Value', detail.stringValue, 'value']);
    }
    facts.push(['Size', formatBytes(detail.shallowSize)], ['Retains', formatBytes(detail.retainedSize)]);
    if (detail.address !== null) {
      facts.push(['Address', `0x${detail.address.toString(16)}`, 'address']);
    }
    if (detail.refcount !== null) {
      facts.push(['Refcount', String(detail.refcount)]);
    }
    if (detail.sourceLocation) {
      facts.push(['Defined in', detail.sourceLocation, 'address']);
    }

    const references = h('div', { className: 'references' });
    const loadReferences = (): void => {
      references.replaceChildren(h('p', { className: 'muted' }, 'Loading…'));
      void api.references(snapshot, id, this.references.direction, this.references.depth).then((graph) => {
        if (live()) {
          references.replaceChildren(this.referenceList(id, graph));
        }
      });
    };
    loadReferences();

    return [
      h('h2', { className: 'node-title' }, detail.class ?? humanizeType(detail.type)),
      ...(inScene ? [] : [h('p', { className: 'muted' }, 'Not drawn in the scene: this node owns no PHP heap memory of its own.')]),
      h(
        'dl',
        { className: 'facts' },
        ...facts.flatMap(([term, value, className]) => [h('dt', {}, term), h('dd', className ? { className } : {}, value)]),
      ),
      h('h3', {}, 'Why is it still alive?'),
      this.retention(paths),
      h(
        'div',
        { className: 'section-head' },
        h('h3', {}, 'References'),
        h(
          'div',
          { className: 'segmented small', role: 'radiogroup', 'aria-label': 'Reference direction' },
          ...(['out', 'in'] as const).map((direction) =>
            h(
              'label',
              {},
              h('input', {
                type: 'radio',
                name: 'direction',
                value: direction,
                checked: this.references.direction === direction,
                onchange: () => {
                  this.references.direction = direction;
                  loadReferences();
                },
              }),
              h('span', {}, direction === 'out' ? 'Holds' : 'Held by'),
            ),
          ),
        ),
        h(
          'select',
          {
            'aria-label': 'Depth',
            onchange: (event) => {
              this.references.depth = Number((event.target as HTMLSelectElement).value);
              loadReferences();
            },
          },
          ...[1, 2, 3].map((depth) => h('option', { value: String(depth), selected: this.references.depth === depth }, `${String(depth)} level${depth > 1 ? 's' : ''}`)),
        ),
      ),
      references,
    ];
  }

  private retention(paths: PathStep[][]): Node {
    if (paths.length === 0) {
      return h('p', { className: 'verdict' }, 'Nothing reachable from a root keeps it alive: it is garbage the cycle collector has not freed yet.');
    }
    if (paths.every((path) => path.length === 1)) {
      return h('p', { className: 'verdict' }, 'It is a root: the engine itself keeps it alive.');
    }
    return h(
      'ol',
      { className: 'paths' },
      ...paths.map((path) =>
        h(
          'li',
          {},
          ...[...path].reverse().flatMap((step, i) => [
            i > 0 ? h('span', { className: 'separator', 'aria-hidden': 'true' }, '›') : null,
            h('button', { type: 'button', className: 'step', title: humanizeLabel(step.node.label), onclick: () => { this.select(step.node.id); } }, step.linkName || humanizeType(step.node.type)),
          ]),
        ),
      ),
    );
  }

  private referenceList(id: number, graph: Neighbourhood): Node {
    const outgoing = this.references.direction === 'out';
    const level = new Map<number, number>([[id, 0]]);
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const rows: Node[] = [];
    for (const edge of graph.edges) {
      const [from, to] = outgoing ? [edge.from, edge.to] : [edge.to, edge.from];
      if (level.has(to)) {
        continue;
      }
      const depth = (level.get(from) ?? 0) + 1;
      level.set(to, depth);
      const node = byId.get(to);
      if (!node) {
        continue;
      }
      rows.push(
        h(
          'li',
          { style: `--depth: ${String(depth - 1)}` },
          h(
            'button',
            { type: 'button', className: 'row', onclick: () => { this.select(node.id); } },
            h('span', { className: 'row-name' }, h('span', { className: 'link' }, edge.name || '·'), ' ', humanizeLabel(node.label)),
            edge.strong ? null : h('span', { className: 'row-meta' }, 'weak'),
            h('span', { className: 'row-size' }, formatBytes(node.retainedSize)),
          ),
        ),
      );
    }
    if (rows.length === 0) {
      return h('p', { className: 'muted' }, outgoing ? 'It references nothing.' : 'Nothing references it.');
    }
    return h(
      'div',
      {},
      h('ol', { className: 'rows tree' }, ...rows),
      graph.truncated ? h('p', { className: 'muted' }, 'Showing the first 300 nodes.') : null,
    );
  }

  private nodeList(nodes: NodeSummary[], size: 'retained' | 'shallow'): Node {
    return h(
      'ol',
      { className: 'rows' },
      ...nodes.map((node) =>
        h(
          'li',
          {},
          h(
            'button',
            { type: 'button', className: 'row', onclick: () => { this.select(node.id); } },
            h('span', { className: 'row-name' }, humanizeLabel(node.label)),
            h('span', { className: 'row-size' }, formatBytes(size === 'retained' ? node.retainedSize : node.shallowSize)),
          ),
        ),
      ),
    );
  }

  /** A node picked from the panel: inspect it and fly the scene to it. */
  private select(node: number): void {
    this.open({ kind: 'node', id: node });
    this.host.focus(node, true);
  }
}
