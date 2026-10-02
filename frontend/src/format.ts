export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('en', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit] ?? 'B'}`;
}

/** reli names node types after its walker contexts: "ArrayPossibleOverheadContext" reads as "Array possible overhead". */
export function humanizeType(type: string): string {
  // reli calls an array node its header; to a PHP developer it is simply the array.
  if (type === 'ArrayHeaderContext') {
    return 'Array';
  }
  const words = type.replace(/Context$/, '').split(/(?<=[a-z])(?=[A-Z])/);
  return words.map((word, i) => (i === 0 ? word : word.toLowerCase())).join(' ');
}

const regionNames: Record<string, string> = {
  zend_mm_heap: 'PHP heap',
  zend_mm_huge: 'PHP heap, huge block',
  vm_stack: 'VM stack',
  compiler_arena: 'Compiler arena',
  outside: 'Outside the PHP heap',
};

export function humanizeRegion(region: string): string {
  return regionNames[region] ?? region;
}

/** Labels start with the node type ("ObjectContext: Foo", "StringContext = \"bar\""); humanize that prefix only. */
export function humanizeLabel(label: string): string {
  return label.replace(/^[A-Z]\w*Context\b/, (type) => humanizeType(type));
}
