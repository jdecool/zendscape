import { describe, expect, it } from 'vitest';
import { PAGE_PITCH, allocationRects, pageOrigin, placeBlocks } from './layout';

const BYTE = 1 / 64;

describe('allocationRects', () => {
  it('covers a small allocation inside one row', () => {
    expect(allocationRects(3 * 64 + 16, 32)).toEqual([{ x: 16 * BYTE, z: 3 * BYTE, width: 32 * BYTE, depth: BYTE }]);
  });

  it('splits an allocation crossing a row boundary', () => {
    expect(allocationRects(56, 16)).toEqual([
      { x: 56 * BYTE, z: 0, width: 8 * BYTE, depth: BYTE },
      { x: 0, z: BYTE, width: 8 * BYTE, depth: BYTE },
    ]);
  });

  it('merges full rows and keeps partial ends', () => {
    expect(allocationRects(32, 64 * 3)).toEqual([
      { x: 32 * BYTE, z: 0, width: 32 * BYTE, depth: BYTE },
      { x: 0, z: BYTE, width: 1, depth: 2 * BYTE },
      { x: 0, z: 3 * BYTE, width: 32 * BYTE, depth: BYTE },
    ]);
  });

  it('continues on the next page, which sits one pitch to the right', () => {
    const rects = allocationRects(4096 - 64, 128);
    expect(rects).toEqual([
      { x: 0, z: 63 * BYTE, width: 1, depth: BYTE },
      { x: PAGE_PITCH, z: 0, width: 1, depth: BYTE },
    ]);
  });

  it('covers whole pages of a large allocation with one rect each', () => {
    const rects = allocationRects(0, 3 * 4096);
    expect(rects).toHaveLength(3);
    expect(rects.map((r) => r.depth)).toEqual([1, 1, 1]);
  });

  it('gives empty allocations a visible byte', () => {
    expect(allocationRects(0, 0)).toHaveLength(1);
  });
});

describe('pageOrigin', () => {
  it('lays 32 pages per row', () => {
    expect(pageOrigin(31)).toEqual({ x: 31 * PAGE_PITCH, z: 0 });
    expect(pageOrigin(32)).toEqual({ x: 0, z: PAGE_PITCH });
    expect(pageOrigin(511)).toEqual({ x: 31 * PAGE_PITCH, z: 15 * PAGE_PITCH });
  });
});

describe('placeBlocks', () => {
  it('shelf-packs chunks in address order without overlap', () => {
    const placements = placeBlocks(Array<number>(5).fill(2 * 1024 * 1024));
    expect(placements.map((p) => p.pages)).toEqual([512, 512, 512, 512, 512]);
    for (const [i, a] of placements.entries()) {
      for (const b of placements.slice(i + 1)) {
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.z + a.depth <= b.z || b.z + b.depth <= a.z;
        expect(apart).toBe(true);
      }
    }
  });

  it('gives huge blocks as many page rows as they need', () => {
    const [huge] = placeBlocks([3 * 1024 * 1024]);
    expect(huge?.pages).toBe(768);
    expect(huge?.depth).toBeCloseTo(24 * PAGE_PITCH - 0.06);
  });
});
