import './style.css';
import { api, type Allocations, type SnapshotInfo } from './api';
import { formatBytes, humanizeRegion, humanizeType } from './format';
import { HeapScene, type ColorMode, type LegendEntry } from './scene';

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw new Error(`Missing #${id}`);
  }
  return found;
}

const snapshotSelect = element('snapshot', HTMLSelectElement);
const upload = element('upload', HTMLInputElement);
const status = element('status', HTMLDivElement);
const selection = element('selection', HTMLElement);
const legend = element('legend', HTMLOListElement);
const legendTitle = element('legend-title', HTMLHeadingElement);
const hint = element('hint', HTMLParagraphElement);

let current: { snapshot: number; data: Allocations } | null = null;
let colorMode: ColorMode = 'type';

const scene = new HeapScene(element('scene', HTMLCanvasElement), {
  onSelect: (allocation) => {
    void showSelection(allocation);
  },
  onControlsChange: (mode) => {
    hint.textContent =
      mode === 'fly'
        ? 'Flying: W A S D to move, R and F to rise and sink, drag to look. Press Esc to orbit again.'
        : 'Drag to orbit, right-drag to pan, scroll to zoom. Click a page to fly in, click an allocation to inspect it. Press F to fly.';
  },
});

function renderLegend(entries: LegendEntry[]): void {
  legendTitle.textContent = colorMode === 'type' ? 'Bytes by node type' : 'Bytes by class';
  legend.replaceChildren(
    ...entries.slice(0, 12).map((entry) => {
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = entry.color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = colorMode === 'type' ? humanizeType(entry.name) : entry.name;
      name.title = `${entry.name}: ${entry.count.toLocaleString('en')} allocations`;
      const bytes = document.createElement('span');
      bytes.className = 'bytes';
      bytes.textContent = formatBytes(entry.bytes);
      item.append(swatch, name, bytes);
      return item;
    }),
  );
}

async function showSelection(allocation: number | null): Promise<void> {
  if (allocation === null || !current) {
    selection.hidden = true;
    scene.select(null);
    return;
  }
  const { snapshot, data } = current;
  const node = data.node[allocation] ?? 0;
  scene.select(node);

  const block = data.blocks[data.block[allocation] ?? 0];
  const address = block ? `0x${(BigInt(block.base) + BigInt(data.offset[allocation] ?? 0)).toString(16)}` : '?';
  const detail = await api.node(snapshot, node);
  if (current.snapshot !== snapshot) {
    return;
  }

  const rows: [string, string, string?][] = [
    ...(detail.class === null ? [] : [['Type', humanizeType(detail.type)] as [string, string]]),
    ['Size', formatBytes(data.size[allocation] ?? 0)],
    ['Address', address, 'address'],
    ['Region', humanizeRegion(data.regions[data.region[allocation] ?? 0] ?? '?')],
    ['Retains', formatBytes(detail.retainedSize)],
  ];
  if (detail.refcount !== null) {
    rows.push(['Refcount', String(detail.refcount)]);
  }
  if (detail.sourceLocation) {
    rows.push(['Defined in', detail.sourceLocation, 'address']);
  }
  const title = document.createElement('h2');
  title.textContent = detail.class ?? humanizeType(detail.type);
  const list = document.createElement('dl');
  for (const [term, value, className] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (className) {
      dd.className = className;
    }
    list.append(dt, dd);
  }
  selection.replaceChildren(title, list);
  selection.hidden = false;
}

async function open(snapshot: number): Promise<void> {
  status.textContent = 'Loading allocations…';
  selection.hidden = true;
  try {
    const data = await api.allocations(snapshot);
    current = { snapshot, data };
    renderLegend(scene.load(data, colorMode));
    status.textContent = data.count === 0 ? 'This snapshot has no allocations in the PHP heap.' : '';
  } catch (error) {
    status.textContent = `Could not load the snapshot: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderSnapshots(snapshots: SnapshotInfo[], selected: number | null): void {
  snapshotSelect.replaceChildren(
    ...snapshots.map((s) => {
      const option = document.createElement('option');
      option.value = String(s.id);
      option.textContent = s.name;
      option.selected = s.id === selected;
      return option;
    }),
  );
  snapshotSelect.disabled = snapshots.length === 0;
}

snapshotSelect.addEventListener('change', () => {
  void open(Number(snapshotSelect.value));
});

upload.addEventListener('change', () => {
  const file = upload.files?.[0];
  if (!file) {
    return;
  }
  status.textContent = `Opening ${file.name}…`;
  void (async () => {
    try {
      const created = await api.upload(file);
      renderSnapshots(await api.snapshots(), created.id);
      await open(created.id);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      upload.value = '';
    }
  })();
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="color"]')) {
  radio.addEventListener('change', () => {
    colorMode = radio.value === 'class' ? 'class' : 'type';
    renderLegend(scene.recolor(colorMode));
  });
}

void (async () => {
  try {
    const snapshots = await api.snapshots();
    const first = snapshots[0];
    renderSnapshots(snapshots, first?.id ?? null);
    if (first) {
      await open(first.id);
    } else {
      status.textContent = 'Open a .rmem snapshot to explore its heap.';
    }
  } catch (error) {
    status.textContent = `Cannot reach the Zendscape server: ${error instanceof Error ? error.message : String(error)}`;
  }
})();
