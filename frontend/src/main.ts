import './style.css';
import { api, setRevealStrings, type Allocations, type SnapshotInfo } from './api';
import { formatBytes, humanizeType } from './format';
import { Inspector } from './inspector';
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
const reveal = element('reveal', HTMLInputElement);
const legend = element('legend', HTMLOListElement);
const legendTitle = element('legend-title', HTMLHeadingElement);
const hint = element('hint', HTMLParagraphElement);

let current: { snapshot: number; data: Allocations } | null = null;
let colorMode: ColorMode = 'type';

const scene = new HeapScene(element('scene', HTMLCanvasElement), {
  onSelect: (allocation) => {
    if (allocation === null || !current) {
      scene.select(null);
      inspector.deselect();
      return;
    }
    inspector.inspect(current.data.node[allocation] ?? 0);
  },
  onControlsChange: (mode) => {
    hint.textContent =
      mode === 'fly'
        ? 'Flying: W A S D to move, R and F to rise and sink, drag to look. Press Esc to orbit again.'
        : 'Drag to orbit, right-drag to pan, scroll to zoom. Click a page to fly in, click an allocation to inspect it. Press F to fly.';
  },
});

// The inspector floats over the right of the canvas; on narrow screens it becomes a bottom sheet instead.
const inspectorPanel = document.querySelector<HTMLElement>('.inspector');
if (inspectorPanel) {
  new ResizeObserver(() => {
    const bounds = inspectorPanel.getBoundingClientRect();
    scene.setRightInset(bounds.top < window.innerHeight / 3 ? window.innerWidth - bounds.left : 0);
  }).observe(inspectorPanel);
}

const inspector = new Inspector(element('inspector', HTMLDivElement), document.querySelector('.tabs') ?? document.body, {
  snapshot: () => current?.snapshot ?? null,
  focus: (node, fly) => (fly ? scene.focus(node) : (scene.select(node), scene.hasNode(node))),
  showPaths: (paths) => {
    scene.showPaths(paths);
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

async function open(snapshot: number): Promise<void> {
  status.textContent = 'Loading allocations…';
  try {
    const data = await api.allocations(snapshot);
    current = { snapshot, data };
    renderLegend(scene.load(data, colorMode));
    inspector.open({ kind: 'classes' }, true);
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

reveal.addEventListener('change', () => {
  setRevealStrings(reveal.checked);
  inspector.render();
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
