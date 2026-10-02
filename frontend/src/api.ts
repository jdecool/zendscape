export interface SnapshotInfo {
  id: number;
  name: string;
  nodeCount: number;
  handlesAvailable: boolean;
}

export interface Block {
  /** Hex string: 64-bit addresses do not fit a JavaScript number exactly. */
  base: string;
  kind: 'chunk' | 'huge';
  size: number;
}

/** Decoded allocations payload, see backend/src/Http/AllocationsPayload.php. */
export interface Allocations {
  count: number;
  blocks: Block[];
  classes: string[];
  types: string[];
  regions: string[];
  block: Uint32Array;
  offset: Uint32Array;
  size: Uint32Array;
  node: Uint32Array;
  class: Uint32Array;
  type: Uint16Array;
  region: Uint8Array;
}

export const NO_CLASS = 0xffffffff;

export interface NodeDetail {
  id: number;
  type: string;
  class: string | null;
  label: string;
  shallowSize: number;
  retainedSize: number;
  address: number | null;
  refcount: number | null;
  stringValue: string | null;
  sourceLocation: string | null;
}

export interface NodeSummary {
  id: number;
  type: string;
  label: string;
  shallowSize: number;
  retainedSize: number;
}

/** One step of a path: the edge named linkName leads into node. */
export interface PathStep {
  node: NodeSummary;
  linkName: string;
  strong: boolean;
}

export interface ClassUsage {
  class: string;
  count: number;
  totalShallowSize: number;
}

export interface Neighbourhood {
  nodes: NodeSummary[];
  edges: { from: number; to: number; name: string; strong: boolean }[];
  truncated: boolean;
}

interface Header {
  count: number;
  blocks: Block[];
  classes: string[];
  types: string[];
  regions: string[];
  columns: { name: string; type: 'u32' | 'u16' | 'u8'; offset: number }[];
}

const arrayTypes = { u32: Uint32Array, u16: Uint16Array, u8: Uint8Array } as const;

export function decodeAllocations(buffer: ArrayBuffer): Allocations {
  const headerLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength))) as Header;

  const column = <T extends 'u32' | 'u16' | 'u8'>(name: string, type: T): InstanceType<(typeof arrayTypes)[T]> => {
    const spec = header.columns.find((c) => c.name === name);
    if (spec?.type !== type) {
      throw new Error(`Allocations payload has no ${type} column "${name}"`);
    }
    // Views over the response buffer: the payload is aligned for zero-copy reads.
    return new arrayTypes[type](buffer, spec.offset, header.count) as InstanceType<(typeof arrayTypes)[T]>;
  };

  return {
    count: header.count,
    blocks: header.blocks,
    classes: header.classes,
    types: header.types,
    regions: header.regions,
    block: column('block', 'u32'),
    offset: column('offset', 'u32'),
    size: column('size', 'u32'),
    node: column('node', 'u32'),
    class: column('class', 'u32'),
    type: column('type', 'u16'),
    region: column('region', 'u8'),
  };
}

/** Whether string values are revealed (ADR 0007): masked unless the user asks. */
let revealStrings = false;

export function setRevealStrings(reveal: boolean): void {
  revealStrings = reveal;
}

async function get(path: string): Promise<Response> {
  const response = await fetch(revealStrings ? `${path}${path.includes('?') ? '&' : '?'}reveal=strings` : path);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${path} answered ${String(response.status)}`);
  }
  return response;
}

async function json<T>(path: string): Promise<T> {
  return (await (await get(path)).json()) as T;
}

const snapshotPath = (snapshot: number): string => `/api/snapshots/${String(snapshot)}`;

export const api = {
  async snapshots(): Promise<SnapshotInfo[]> {
    return (await (await get('/api/snapshots')).json()) as SnapshotInfo[];
  },
  async allocations(snapshot: number): Promise<Allocations> {
    return decodeAllocations(await (await get(`/api/snapshots/${String(snapshot)}/allocations`)).arrayBuffer());
  },
  node: (snapshot: number, node: number) => json<NodeDetail>(`${snapshotPath(snapshot)}/nodes/${String(node)}`),
  classes: (snapshot: number) => json<ClassUsage[]>(`${snapshotPath(snapshot)}/classes`),
  instances: (snapshot: number, className: string) =>
    json<NodeSummary[]>(`${snapshotPath(snapshot)}/classes/${encodeURIComponent(className)}/instances?limit=200`),
  topRetained: (snapshot: number) => json<NodeSummary[]>(`${snapshotPath(snapshot)}/top-retained?limit=200`),
  search: (snapshot: number, query: string) => json<NodeSummary[]>(`${snapshotPath(snapshot)}/search?q=${encodeURIComponent(query)}&limit=200`),
  byAddress: (snapshot: number, address: string) => json<{ node: number | null }>(`${snapshotPath(snapshot)}/address/${address}`),
  retentionPaths: (snapshot: number, node: number) => json<PathStep[][]>(`${snapshotPath(snapshot)}/nodes/${String(node)}/retention-paths?limit=5`),
  references: (snapshot: number, node: number, direction: 'in' | 'out', depth: number) =>
    json<Neighbourhood>(`${snapshotPath(snapshot)}/nodes/${String(node)}/references?direction=${direction}&depth=${String(depth)}&limit=300`),
  async upload(file: File): Promise<{ id: number; name: string }> {
    const response = await fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name },
      body: file,
    });
    const body = (await response.json()) as { id: number; name: string; error?: string };
    if (!response.ok) {
      throw new Error(body.error ?? `Upload failed with status ${String(response.status)}`);
    }
    return body;
  },
};
