import * as THREE from 'three';
import { FlyControls } from 'three/addons/controls/FlyControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NO_CLASS, type Allocations } from './api';
import { PAGE_SIZE, ROW_BYTES, allocationRects, pageOrigin, placeBlocks, type BlockPlacement } from './layout';

export type ColorMode = 'type' | 'class';

export interface LegendEntry {
  name: string;
  color: string;
  bytes: number;
  count: number;
}

export interface SceneEvents {
  onSelect(allocation: number | null): void;
  onControlsChange(mode: 'orbit' | 'fly'): void;
}

const colors = {
  substrate: new THREE.Color('#1b1d3a'),
  slab: new THREE.Color('#2a2d52'),
  emptyPage: new THREE.Color('#33376a'),
  unclassified: new THREE.Color('#6d71a3'),
  selection: new THREE.Color('#ffd15c'),
  retention: new THREE.Color('#ff9e5c'),
};

/** Below this distance from a block, its allocations replace its page bars (ADR 0004). */
const DETAIL_DISTANCE = 60;
const DRAG_TOLERANCE = 4;
const BEAM_HEIGHT = 8;

interface BlockMeshes {
  placement: BlockPlacement;
  center: THREE.Vector3;
  radius: number;
  pageBars: THREE.InstancedMesh;
  allocations: THREE.InstancedMesh;
  /** instance id => allocation index */
  rectOwners: Uint32Array;
}

/**
 * The 3D heap. Blocks (ZendMM chunks and huge blocks) sit on the ground in
 * address order; each shows its pages as occupancy bars from afar and its
 * allocations byte for byte up close.
 */
export class HeapScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
  private readonly orbit: OrbitControls;
  private readonly fly: FlyControls;
  private controlsMode: 'orbit' | 'fly' = 'orbit';
  private readonly timer = new THREE.Timer();
  /** GPU resources of the current snapshot, released when another one loads. */
  private disposables: { dispose(): void }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly world = new THREE.Group();
  private blocks: BlockMeshes[] = [];
  private data: Allocations | null = null;
  private highlight: THREE.InstancedMesh | null = null;
  private pathArcs: THREE.Mesh<THREE.TubeGeometry>[] = [];
  private readonly pathMaterial = new THREE.MeshBasicMaterial({
    color: colors.retention,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  /** node id => its first allocation, to find a node picked from a list in the scene */
  private firstAllocation = new Map<number, number>();
  private pointerDown: { x: number; y: number } | null = null;
  /** Pixels covered by the inspector on the right, kept out of the visual center. */
  private rightInset = 0;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: SceneEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = colors.substrate;
    this.scene.fog = new THREE.Fog(colors.substrate, 250, 900);
    this.scene.add(new THREE.HemisphereLight('#cfd3ff', '#1b1d3a', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(-0.6, 1, 0.4);
    this.scene.add(sun, this.world);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.fly = new FlyControls(this.camera, canvas);
    this.fly.dragToLook = true;
    this.fly.rollSpeed = 0.6;
    this.fly.enabled = false;

    canvas.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY };
      this.flight = null;
    });
    canvas.addEventListener('pointerup', (e) => {
      const down = this.pointerDown;
      this.pointerDown = null;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_TOLERANCE && e.button === 0) {
        this.pick(e.clientX, e.clientY);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      // F also means "sink" to FlyControls, so leaving flight needs its own key.
      if ((e.key === 'f' && this.controlsMode === 'orbit') || (e.key === 'Escape' && this.controlsMode === 'fly')) {
        this.toggleControls();
      }
    });
    new ResizeObserver(() => {
      this.resize();
    }).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.frame();
    });
  }

  /** Builds the scene for a snapshot and returns the legend of the chosen coloring. */
  load(data: Allocations, mode: ColorMode): LegendEntry[] {
    this.clear();
    this.data = data;
    const placements = placeBlocks(data.blocks.map((b) => b.size));
    const perBlock = placements.map(() => [] as number[]);
    for (let i = 0; i < data.count; i++) {
      perBlock[data.block[i] ?? 0]?.push(i);
      const node = data.node[i] ?? 0;
      if (!this.firstAllocation.has(node)) {
        this.firstAllocation.set(node, i);
      }
    }

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0.5, 0.5, 0.5); // instances are positioned by their corner, which is how the layout thinks
    const material = new THREE.MeshLambertMaterial();
    const slabMaterial = new THREE.MeshLambertMaterial({ color: colors.slab });
    const floorMaterial = new THREE.MeshLambertMaterial({ color: colors.emptyPage });
    this.disposables.push(box, material, slabMaterial, floorMaterial);

    this.blocks = placements.map((placement, b) => {
      const group = new THREE.Group();
      group.position.set(placement.x, 0, placement.z);
      this.world.add(group);

      const slab = new THREE.Mesh(box, slabMaterial);
      slab.position.set(-0.4, -0.14, -0.4);
      slab.scale.set(placement.width + 0.8, 0.12, placement.depth + 0.8);
      group.add(slab);

      const indices = perBlock[b] ?? [];
      const rects = indices.map((i) => allocationRects(data.offset[i] ?? 0, data.size[i] ?? 0));
      const rectCount = rects.reduce((sum, r) => sum + r.length, 0);
      const allocations = new THREE.InstancedMesh(box, material, Math.max(rectCount, 1));
      allocations.count = rectCount;
      const rectOwners = new Uint32Array(rectCount);
      const matrix = new THREE.Matrix4();
      let instance = 0;
      for (const [k, allocationRectsOfOne] of rects.entries()) {
        const allocation = indices[k] ?? 0;
        const height = allocationHeight(data.size[allocation] ?? 0);
        for (const rect of allocationRectsOfOne) {
          // A hairline gap between neighbours keeps densely packed bins legible.
          const gap = Math.min(0.12 / ROW_BYTES, rect.width * 0.3);
          matrix.makeScale(rect.width - gap, height, rect.depth - Math.min(gap, rect.depth * 0.3));
          matrix.setPosition(rect.x, 0, rect.z);
          allocations.setMatrixAt(instance, matrix);
          rectOwners[instance++] = allocation;
        }
      }
      allocations.computeBoundingSphere();
      group.add(allocations);

      const pageBars = new THREE.InstancedMesh(box, material, placement.pages);
      group.add(pageBars);

      // The page grid stays visible at every distance, so empty pages read as free memory.
      const floor = new THREE.InstancedMesh(box, floorMaterial, placement.pages);
      for (let page = 0; page < placement.pages; page++) {
        const origin = pageOrigin(page);
        floor.setMatrixAt(page, matrix.makeScale(1, 0.01, 1).setPosition(origin.x, -0.012, origin.z));
      }
      floor.computeBoundingSphere();
      group.add(floor);
      this.disposables.push(allocations, pageBars, floor);

      const center = new THREE.Vector3(placement.x + placement.width / 2, 0, placement.z + placement.depth / 2);
      return { placement, center, radius: Math.hypot(placement.width, placement.depth) / 2, pageBars, allocations, rectOwners };
    });

    const legend = this.recolor(mode);
    this.frameAll();
    return legend;
  }

  /** Recolors allocations and page bars, returning the legend of the new coloring. */
  recolor(mode: ColorMode): LegendEntry[] {
    const data = this.data;
    if (!data) {
      return [];
    }
    const categoryOf = (i: number): number => (mode === 'type' ? (data.type[i] ?? 0) : (data.class[i] ?? NO_CLASS));
    const names = mode === 'type' ? data.types : data.classes;

    const bytes = new Map<number, number>();
    const counts = new Map<number, number>();
    for (let i = 0; i < data.count; i++) {
      const category = categoryOf(i);
      bytes.set(category, (bytes.get(category) ?? 0) + (data.size[i] ?? 0));
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    // Hues follow rank by bytes so the biggest consumers get the most distinct colors.
    const ranked = [...bytes.keys()].filter((c) => c !== NO_CLASS).sort((a, b) => (bytes.get(b) ?? 0) - (bytes.get(a) ?? 0));
    const palette = new Map(ranked.map((category, rank) => [category, prism(rank)]));
    const colorOf = (category: number): THREE.Color => palette.get(category) ?? colors.unclassified;

    const color = new THREE.Color();
    for (const block of this.blocks) {
      for (let k = 0; k < block.allocations.count; k++) {
        block.allocations.setColorAt(k, colorOf(categoryOf(block.rectOwners[k] ?? 0)));
      }
      if (block.allocations.instanceColor) {
        block.allocations.instanceColor.needsUpdate = true;
      }

      // Page bars: height is occupancy, color is the category owning most bytes of the page.
      const pageBytes = new Float64Array(block.placement.pages);
      const pageOwner = new Map<number, Map<number, number>>();
      for (let k = 0; k < block.allocations.count; k++) {
        const allocation = block.rectOwners[k] ?? 0;
        if (k > 0 && block.rectOwners[k - 1] === allocation) {
          continue;
        }
        spreadOverPages(data.offset[allocation] ?? 0, data.size[allocation] ?? 0, (page, used) => {
          pageBytes[page] = (pageBytes[page] ?? 0) + used;
          const owners = pageOwner.get(page) ?? new Map<number, number>();
          const category = categoryOf(allocation);
          owners.set(category, (owners.get(category) ?? 0) + used);
          pageOwner.set(page, owners);
        });
      }
      const matrix = new THREE.Matrix4();
      for (let page = 0; page < block.placement.pages; page++) {
        const occupancy = Math.min(1, (pageBytes[page] ?? 0) / PAGE_SIZE);
        const origin = pageOrigin(page);
        matrix.makeScale(1, 0.02 + occupancy * 0.9, 1);
        matrix.setPosition(origin.x, 0, origin.z);
        block.pageBars.setMatrixAt(page, matrix);
        const owners = pageOwner.get(page);
        const dominant = owners ? [...owners.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
        color.copy(dominant === undefined ? colors.emptyPage : colorOf(dominant));
        block.pageBars.setColorAt(page, color.lerp(colors.emptyPage, 0.5 * (1 - occupancy)));
      }
      block.pageBars.instanceMatrix.needsUpdate = true;
      if (block.pageBars.instanceColor) {
        block.pageBars.instanceColor.needsUpdate = true;
      }
      block.pageBars.computeBoundingSphere();
    }

    // Allocations without a class are the backdrop classes stand out against: listed last.
    return [...bytes.entries()]
      .sort((a, b) => Number(a[0] === NO_CLASS) - Number(b[0] === NO_CLASS) || b[1] - a[1])
      .map(([category, total]) => ({
        name: category === NO_CLASS ? 'Not an object' : (names[category] ?? '?'),
        color: `#${colorOf(category).getHexString()}`,
        bytes: total,
        count: counts.get(category) ?? 0,
      }));
  }

  /** Outlines every allocation of the given node, or clears the selection. */
  select(node: number | null): void {
    if (this.highlight) {
      this.highlight.removeFromParent();
      this.highlight.dispose();
      this.highlight = null;
    }
    const data = this.data;
    if (node === null || !data) {
      return;
    }
    const matrices: THREE.Matrix4[] = [];
    let beamAt: THREE.Vector3 | null = null;
    for (let i = 0; i < data.count; i++) {
      if (data.node[i] !== node) {
        continue;
      }
      const placement = this.blocks[data.block[i] ?? 0]?.placement;
      if (!placement) {
        continue;
      }
      const height = allocationHeight(data.size[i] ?? 0) + 0.04;
      beamAt ??= this.allocationTop(i);
      for (const rect of allocationRects(data.offset[i] ?? 0, data.size[i] ?? 0)) {
        const pad = 0.02;
        matrices.push(
          new THREE.Matrix4()
            .makeScale(rect.width + 2 * pad, height, rect.depth + 2 * pad)
            .setPosition(placement.x + rect.x - pad, 0, placement.z + rect.z - pad),
        );
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    const material = new THREE.MeshBasicMaterial({ color: colors.selection, transparent: true, opacity: 0.85 });
    const highlight = new THREE.InstancedMesh(box, material, matrices.length);
    highlight.addEventListener('dispose', () => {
      box.dispose();
      material.dispose();
    });
    matrices.forEach((m, k) => {
      highlight.setMatrixAt(k, m);
    });
    highlight.computeBoundingSphere();
    this.world.add(highlight);
    this.highlight = highlight;

    // A probe beam above the selection keeps a 16-byte allocation findable from across the heap.
    if (beamAt) {
      const beamGeometry = new THREE.CylinderGeometry(0.035, 0.035, BEAM_HEIGHT, 8).translate(0, BEAM_HEIGHT / 2, 0);
      const beamMaterial = new THREE.MeshBasicMaterial({ color: colors.selection, transparent: true, opacity: 0.55 });
      const beam = new THREE.Mesh(beamGeometry, beamMaterial);
      beam.position.copy(beamAt);
      this.world.add(beam);
      highlight.addEventListener('dispose', () => {
        beam.removeFromParent();
        beamGeometry.dispose();
        beamMaterial.dispose();
      });
    }
  }

  /** Shifts the projection so what the camera looks at sits centered in the area left uncovered. */
  setRightInset(pixels: number): void {
    this.rightInset = pixels;
    this.resize();
  }

  /** True when the node owns memory drawn in the scene, i.e. it can be selected and flown to. */
  hasNode(node: number): boolean {
    return this.firstAllocation.has(node);
  }

  /** Selects a node and flies to it; returns false when the node has nothing drawn in the scene. */
  focus(node: number): boolean {
    this.select(node);
    const allocation = this.firstAllocation.get(node);
    const top = allocation === undefined ? null : this.allocationTop(allocation);
    if (!top) {
      return false;
    }
    this.flyTo(top, 9);
    return true;
  }

  /**
   * Draws each retention path (node ids from root to target) as arcs between
   * the allocations of consecutive nodes. Nodes without memory of their own
   * (array elements, property lists) are skipped, so an arc spans the hop from
   * one real allocation to the next.
   */
  showPaths(paths: readonly (readonly number[])[]): void {
    for (const arc of this.pathArcs) {
      arc.removeFromParent();
      arc.geometry.dispose();
    }
    this.pathArcs = [];
    for (const path of paths) {
      const stops = path
        .map((node) => this.firstAllocation.get(node))
        .filter((allocation): allocation is number => allocation !== undefined)
        .map((allocation) => this.allocationTop(allocation))
        .filter((point): point is THREE.Vector3 => point !== null);
      for (let k = 1; k < stops.length; k++) {
        const from = stops[k - 1];
        const to = stops[k];
        if (!from || !to || from.distanceTo(to) < 0.05) {
          continue;
        }
        const lift = 0.6 + Math.min(from.distanceTo(to) * 0.35, 6);
        const middle = from.clone().lerp(to, 0.5).setY(Math.max(from.y, to.y) + lift);
        const curve = new THREE.QuadraticBezierCurve3(from, middle, to);
        const arc = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.03 + lift * 0.004, 6), this.pathMaterial);
        this.world.add(arc);
        this.pathArcs.push(arc);
      }
    }
  }

  toggleControls(): void {
    this.controlsMode = this.controlsMode === 'orbit' ? 'fly' : 'orbit';
    this.orbit.enabled = this.controlsMode === 'orbit';
    this.fly.enabled = this.controlsMode === 'fly';
    if (this.controlsMode === 'orbit') {
      // Resume orbiting around what the pilot was looking at.
      const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.orbit.target.copy(this.camera.position).addScaledVector(ahead, Math.max(5, this.camera.position.y * 2));
      this.orbit.update();
    }
    this.events.onControlsChange(this.controlsMode);
  }

  /** Center of the top face of an allocation's first rectangle, in world space. */
  private allocationTop(allocation: number): THREE.Vector3 | null {
    const data = this.data;
    const placement = data ? this.blocks[data.block[allocation] ?? 0]?.placement : undefined;
    const rect = data ? allocationRects(data.offset[allocation] ?? 0, data.size[allocation] ?? 0)[0] : undefined;
    if (!data || !placement || !rect) {
      return null;
    }
    return new THREE.Vector3(
      placement.x + rect.x + rect.width / 2,
      allocationHeight(data.size[allocation] ?? 0) + 0.04,
      placement.z + rect.z + rect.depth / 2,
    );
  }

  private pick(clientX: number, clientY: number): void {
    const bounds = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    // ponytail: CPU raycast per visible block, fine at tens of thousands of instances per block; GPU id picking if it lags.
    const candidates = this.blocks.flatMap((b) => [b.allocations, b.pageBars].filter((m) => m.visible));
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
    if (hit?.instanceId === undefined) {
      this.events.onSelect(null);
      return;
    }
    const block = this.blocks.find((b) => b.allocations === hit.object || b.pageBars === hit.object);
    if (!block) {
      return;
    }
    if (hit.object === block.allocations) {
      this.events.onSelect(block.rectOwners[hit.instanceId] ?? null);
      return;
    }
    // A page bar stands for its allocations: fly close enough for them to appear.
    const origin = pageOrigin(hit.instanceId);
    this.flyTo(new THREE.Vector3(block.placement.x + origin.x + 0.5, 0, block.placement.z + origin.z + 0.5), 7);
  }

  private flyTo(target: THREE.Vector3, distance: number): void {
    if (this.controlsMode === 'fly') {
      this.toggleControls();
    }
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.flight = {
      from: this.camera.position.clone(),
      to: target.clone().addScaledVector(direction, distance),
      fromTarget: this.orbit.target.clone(),
      toTarget: target,
      t: 0,
    };
  }

  private frameAll(): void {
    const box = new THREE.Box3();
    for (const block of this.blocks) {
      box.expandByPoint(new THREE.Vector3(block.placement.x, 0, block.placement.z));
      box.expandByPoint(new THREE.Vector3(block.placement.x + block.placement.width, 1, block.placement.z + block.placement.depth));
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 10);
    // Fit the layout's bounding sphere in the narrower field of view, so portrait screens see it whole too.
    const radius = Math.max(Math.hypot(size.x, size.z) / 2, 5);
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 0.95;
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(new THREE.Vector3(-0.35, 0.75, 0.85).normalize(), distance);
    this.camera.near = 0.02;
    this.camera.far = span * 20;
    this.camera.updateProjectionMatrix();
    this.orbit.update();
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = distance * 1.5;
      this.scene.fog.far = distance * 6;
    }
    this.fly.movementSpeed = Math.max(4, span / 6);
  }

  private frame(): void {
    this.timer.update();
    const delta = this.timer.getDelta();
    if (this.flight) {
      const flight = this.flight;
      flight.t = Math.min(1, flight.t + delta / 0.6);
      const eased = 1 - (1 - flight.t) ** 3;
      this.camera.position.lerpVectors(flight.from, flight.to, eased);
      this.orbit.target.lerpVectors(flight.fromTarget, flight.toTarget, eased);
      if (flight.t >= 1) {
        this.flight = null;
      }
    }
    if (this.controlsMode === 'orbit') {
      this.orbit.update();
    } else {
      this.fly.update(delta);
    }

    for (const block of this.blocks) {
      const distance = Math.max(0, this.camera.position.distanceTo(block.center) - block.radius);
      const near = distance < DETAIL_DISTANCE;
      block.allocations.visible = near;
      block.pageBars.visible = !near;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    if (this.rightInset > 0 && this.rightInset < width / 2) {
      this.camera.setViewOffset(width, height, this.rightInset / 2, 0, width, height);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  private clear(): void {
    this.select(null);
    this.showPaths([]);
    this.firstAllocation.clear();
    this.world.clear();
    for (const resource of this.disposables) {
      resource.dispose();
    }
    this.disposables = [];
    this.blocks = [];
  }
}

/** Taller blocks for bigger allocations, on a log scale so 16-byte strings stay visible next to 2 MB arrays. */
function allocationHeight(size: number): number {
  return Math.min(0.5, 0.04 + 0.03 * Math.log2(1 + size / 16));
}

/**
 * Golden-angle hues so consecutive ranks never sit side by side on the wheel,
 * with lightness alternating in a three-step cycle so hues that do come back
 * around still differ in value.
 */
function prism(rank: number): THREE.Color {
  const hue = (0.6 + rank * 0.381966) % 1;
  return new THREE.Color().setHSL(hue, 0.7, [0.64, 0.52, 0.74][rank % 3] ?? 0.6);
}

function spreadOverPages(offset: number, size: number, visit: (page: number, bytes: number) => void): void {
  let start = offset;
  const end = offset + Math.max(size, 1);
  while (start < end) {
    const page = Math.floor(start / PAGE_SIZE);
    const pageEnd = Math.min(end, (page + 1) * PAGE_SIZE);
    visit(page, pageEnd - start);
    start = pageEnd;
  }
}
