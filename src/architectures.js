/** The three MiniCPU levels. Each level keeps everything of the previous one. */
export const ARCHITECTURES = Object.freeze({
  cpu8: Object.freeze({
    id: 'cpu8', directive: '8', name: 'MiniCPU 8',
    summary: '256 bytes of RAM, four registers, flags and jumps',
    memorySize: 256, addressBits: 8, stack: false, index: false,
  }),
  cpu8s: Object.freeze({
    id: 'cpu8s', directive: '8s', name: 'MiniCPU 8S',
    summary: 'adds a stack: PUSH, POP, CALL and RET',
    memorySize: 256, addressBits: 8, stack: true, index: false,
  }),
  cpu8x: Object.freeze({
    id: 'cpu8x', directive: '8x', name: 'MiniCPU 8X',
    summary: 'adds 4 KiB of RAM, 16-bit addresses and the pointer registers X and Y',
    memorySize: 4096, addressBits: 16, stack: true, index: true,
  }),
});

export function architecture(id = 'cpu8') {
  const result = ARCHITECTURES[typeof id === 'string' ? id : id?.id];
  if (!result) throw new RangeError(`Unknown CPU architecture: ${id}`);
  return result;
}

/** `.cpu 8x` → cpu8x */
export function architectureFromDirective(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/^minicpu\s*/, '');
  return Object.values(ARCHITECTURES).find(arch => arch.directive === key) ?? null;
}
