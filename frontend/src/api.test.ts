import { describe, expect, it } from 'vitest';
import { decodeAllocations } from './api';

/** Builds a payload the way backend/src/Http/AllocationsPayload.php lays it out. */
function payload(columns: { name: string; type: 'u32' | 'u16' | 'u8'; values: number[] }[]): ArrayBuffer {
  const count = columns[0]?.values.length ?? 0;
  const width = { u32: 4, u16: 2, u8: 1 };
  const header = { count, blocks: [{ base: '0x7f0000200000', kind: 'chunk', size: 2097152 }], classes: ['Product'], types: ['ObjectContext'], regions: ['zend_mm_heap'], columns: [] as object[] };
  const placeholder = JSON.stringify({ ...header, columns: columns.map((c) => ({ name: c.name, type: c.type, offset: 1e12 })) });
  let offset = Math.ceil((4 + placeholder.length) / 4) * 4;
  header.columns = columns.map((c) => {
    const spec = { name: c.name, type: c.type, offset };
    offset = Math.ceil((offset + count * width[c.type]) / 4) * 4;
    return spec;
  });
  const buffer = new ArrayBuffer(offset);
  const json = JSON.stringify(header).padEnd(placeholder.length);
  new DataView(buffer).setUint32(0, json.length, true);
  new Uint8Array(buffer, 4).set(new TextEncoder().encode(json));
  for (const [i, c] of columns.entries()) {
    const spec = header.columns[i] as { offset: number };
    const view = c.type === 'u32' ? new Uint32Array(buffer, spec.offset, count) : c.type === 'u16' ? new Uint16Array(buffer, spec.offset, count) : new Uint8Array(buffer, spec.offset, count);
    view.set(c.values);
  }
  return buffer;
}

describe('decodeAllocations', () => {
  it('reads every column as a view over the payload', () => {
    const decoded = decodeAllocations(
      payload([
        { name: 'block', type: 'u32', values: [0, 0, 0] },
        { name: 'offset', type: 'u32', values: [0, 64, 4096] },
        { name: 'size', type: 'u32', values: [56, 32, 4096] },
        { name: 'node', type: 'u32', values: [7, 8, 9] },
        { name: 'class', type: 'u32', values: [0, 0xffffffff, 0] },
        { name: 'type', type: 'u16', values: [0, 0, 0] },
        { name: 'region', type: 'u8', values: [0, 0, 0] },
      ]),
    );

    expect(decoded.count).toBe(3);
    expect([...decoded.offset]).toEqual([0, 64, 4096]);
    expect([...decoded.node]).toEqual([7, 8, 9]);
    expect([...decoded.class]).toEqual([0, 0xffffffff, 0]);
    expect(decoded.blocks[0]?.base).toBe('0x7f0000200000');
  });

  it('rejects a payload missing a column', () => {
    expect(() => decodeAllocations(payload([{ name: 'block', type: 'u32', values: [0] }]))).toThrow(/offset/);
  });
});
