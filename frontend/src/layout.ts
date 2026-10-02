/**
 * Physical layout of the scene (ADR 0004), in world units where one page is
 * one unit square. A page is drawn as 64 rows of 64 bytes, so an allocation
 * covers exactly the bytes it owns and ZendMM bin packing shows as stripes.
 */

export const PAGE_SIZE = 4096;
export const ROW_BYTES = 64;
export const PAGES_PER_ROW = 32;
export const PAGE_GAP = 0.06;
export const PAGE_PITCH = 1 + PAGE_GAP;
const BLOCK_GAP = 6;
const BYTE = 1 / ROW_BYTES;

/** Axis-aligned footprint on the ground plane (x right, z towards the viewer). */
export interface Rect {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface BlockPlacement {
  x: number;
  z: number;
  pages: number;
  width: number;
  depth: number;
}

export function pagesIn(blockSize: number): number {
  return Math.ceil(blockSize / PAGE_SIZE);
}

/** Top-left corner of a page, relative to its block. */
export function pageOrigin(page: number): { x: number; z: number } {
  return { x: (page % PAGES_PER_ROW) * PAGE_PITCH, z: Math.floor(page / PAGES_PER_ROW) * PAGE_PITCH };
}

/**
 * Shelf-packs blocks in address order: rows of blocks no wider than a
 * square arrangement of chunks would be, each row as deep as its deepest block.
 */
export function placeBlocks(blockSizes: readonly number[]): BlockPlacement[] {
  const footprints = blockSizes.map((size) => {
    const pages = pagesIn(size);
    return {
      pages,
      width: Math.min(pages, PAGES_PER_ROW) * PAGE_PITCH - PAGE_GAP,
      depth: Math.ceil(pages / PAGES_PER_ROW) * PAGE_PITCH - PAGE_GAP,
    };
  });
  const chunkWidth = PAGES_PER_ROW * PAGE_PITCH - PAGE_GAP;
  const maxRowWidth = Math.ceil(Math.sqrt(blockSizes.length)) * (chunkWidth + BLOCK_GAP);

  const placements: BlockPlacement[] = [];
  let x = 0;
  let z = 0;
  let rowDepth = 0;
  for (const footprint of footprints) {
    if (x > 0 && x + footprint.width > maxRowWidth) {
      x = 0;
      z += rowDepth + BLOCK_GAP;
      rowDepth = 0;
    }
    placements.push({ x, z, ...footprint });
    x += footprint.width + BLOCK_GAP;
    rowDepth = Math.max(rowDepth, footprint.depth);
  }
  return placements;
}

/**
 * Rectangles covering the bytes [offset, offset + size) of a block, relative
 * to the block: per page, a partial first row, a run of full rows, and a
 * partial last row.
 */
export function allocationRects(offset: number, size: number): Rect[] {
  const rects: Rect[] = [];
  let start = offset;
  const end = offset + Math.max(size, 1);

  while (start < end) {
    const page = Math.floor(start / PAGE_SIZE);
    const pageEnd = Math.min(end, (page + 1) * PAGE_SIZE);
    const origin = pageOrigin(page);
    let inPage = start - page * PAGE_SIZE;
    const inPageEnd = pageEnd - page * PAGE_SIZE;

    while (inPage < inPageEnd) {
      const row = Math.floor(inPage / ROW_BYTES);
      const column = inPage % ROW_BYTES;
      const fullRows = column === 0 ? Math.floor((inPageEnd - inPage) / ROW_BYTES) : 0;
      if (fullRows > 0) {
        rects.push({ x: origin.x, z: origin.z + row * BYTE, width: 1, depth: fullRows * BYTE });
        inPage += fullRows * ROW_BYTES;
      } else {
        const bytes = Math.min(ROW_BYTES - column, inPageEnd - inPage);
        rects.push({ x: origin.x + column * BYTE, z: origin.z + row * BYTE, width: bytes * BYTE, depth: BYTE });
        inPage += bytes;
      }
    }
    start = pageEnd;
  }
  return rects;
}
