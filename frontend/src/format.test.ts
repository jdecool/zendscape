import { describe, expect, it } from 'vitest';
import { formatBytes, humanizeRegion, humanizeType } from './format';

describe('formatBytes', () => {
  it('picks the largest unit below 1024', () => {
    expect(formatBytes(56)).toBe('56 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
  });
});

describe('humanizeType', () => {
  it('turns reli context names into words', () => {
    expect(humanizeType('ArrayPossibleOverheadContext')).toBe('Array possible overhead');
    expect(humanizeType('StringContext')).toBe('String');
    expect(humanizeType('ObjectsStoreContext')).toBe('Objects store');
  });
});

describe('humanizeRegion', () => {
  it('names reli regions', () => {
    expect(humanizeRegion('zend_mm_heap')).toBe('PHP heap');
    expect(humanizeRegion('something_new')).toBe('something_new');
  });
});
