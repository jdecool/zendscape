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

async function get(path: string): Promise<Response> {
  const response = await fetch(path);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${path} answered ${String(response.status)}`);
  }
  return response;
}

export const api = {
  async snapshots(): Promise<SnapshotInfo[]> {
    return (await (await get('/api/snapshots')).json()) as SnapshotInfo[];
  },
  async allocations(snapshot: number): Promise<Allocations> {
    return decodeAllocations(await (await get(`/api/snapshots/${String(snapshot)}/allocations`)).arrayBuffer());
  },
  async node(snapshot: number, node: number): Promise<NodeDetail> {
    return (await (await get(`/api/snapshots/${String(snapshot)}/nodes/${String(node)}`)).json()) as NodeDetail;
  },
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
