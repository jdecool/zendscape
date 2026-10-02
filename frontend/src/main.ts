import './style.css';
import { api, setRevealStrings, type Allocations, type DiffResult, type SnapshotInfo } from './api';
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
const baselineSelect = element('baseline', HTMLSelectElement);
const changesRadio = document.querySelector<HTMLInputElement>('input[name="color"][value="changes"]');
let snapshots: SnapshotInfo[] = [];
let comparison: { baseline: number; name: string; diff: Promise<DiffResult> } | null = null;
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
  changes: () => (comparison ? { baseline: comparison.name, diff: comparison.diff } : null),
});

function checkColorMode(mode: ColorMode): void {
  colorMode = mode;
  const radio = document.querySelector<HTMLInputElement>(`input[name="color"][value="${mode}"]`);
  if (radio) {
    radio.checked = true;
  }
}

function setColorMode(mode: ColorMode): void {
  checkColorMode(mode);
  renderLegend(scene.recolor(mode));
}

/** Compares the displayed snapshot with a baseline; the scene then shows what is new in green. */
async function compareWith(baseline: number | null): Promise<void> {
  const snapshot = current?.snapshot;
  if (baseline === null || snapshot === undefined) {
    comparison = null;
    scene.setNewNodes([]);
    if (changesRadio) {
      changesRadio.disabled = true;
    }
    if (colorMode === 'changes') {
      setColorMode('type');
    }
    if (inspector.current?.kind === 'changes') {
      inspector.render();
    }
    return;
  }
  const diff = api.diff(baseline, snapshot);
  comparison = { baseline, name: snapshots.find((s) => s.id === baseline)?.name ?? 'baseline', diff };
  inspector.open({ kind: 'changes' }, true);
  try {
    const result = await diff;
    if (comparison.diff !== diff) {
      return;
    }
    scene.setNewNodes(result.newObjects);
    if (changesRadio) {
      changesRadio.disabled = false;
    }
    setColorMode('changes');
  } catch (error) {
    status.textContent = `Could not compare the snapshots: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderBaselines(): void {
  const others = snapshots.filter((s) => s.id !== current?.snapshot);
  baselineSelect.replaceChildren(
    new Option('Nothing', ''),
    ...others.map((s) => new Option(s.name, String(s.id), false, s.id === comparison?.baseline)),
  );
  baselineSelect.disabled = others.length === 0;
}

baselineSelect.addEventListener('change', () => {
  void compareWith(baselineSelect.value === '' ? null : Number(baselineSelect.value));
});

function renderLegend(entries: LegendEntry[]): void {
  legendTitle.textContent = { type: 'Bytes by node type', class: 'Bytes by class', changes: 'Bytes by age' }[colorMode];
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
    // A comparison is relative to the displayed snapshot: switching snapshots ends it.
    comparison = null;
    if (changesRadio) {
      changesRadio.disabled = true;
    }
    checkColorMode(colorMode === 'changes' ? 'type' : colorMode);
    renderLegend(scene.load(data, colorMode));
    renderBaselines();
    inspector.open({ kind: 'classes' }, true);
    status.textContent = data.count === 0 ? 'This snapshot has no allocations in the PHP heap.' : '';
  } catch (error) {
    status.textContent = `Could not load the snapshot: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderSnapshots(list: SnapshotInfo[], selected: number | null): void {
  snapshots = list;
  snapshotSelect.replaceChildren(
    ...list.map((s) => {
      const option = document.createElement('option');
      option.value = String(s.id);
      option.textContent = s.name;
      option.selected = s.id === selected;
      return option;
    }),
  );
  snapshotSelect.disabled = list.length === 0;
  renderBaselines();
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
    setColorMode(radio.value === 'class' ? 'class' : radio.value === 'changes' ? 'changes' : 'type');
  });
}

void (async () => {
  try {
    const list = await api.snapshots();
    // Snapshots are usually given in capture order: open the latest, the one to compare against the others.
    const latest = list[list.length - 1];
    renderSnapshots(list, latest?.id ?? null);
    if (latest) {
      await open(latest.id);
    } else {
      status.textContent = 'Open a .rmem snapshot to explore its heap.';
    }
  } catch (error) {
    status.textContent = `Cannot reach the Zendscape server: ${error instanceof Error ? error.message : String(error)}`;
  }
})();
