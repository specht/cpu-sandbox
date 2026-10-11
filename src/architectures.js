/** One cumulative teaching ISA; profiles add instructions and address space. */
export const ARCHITECTURES = Object.freeze({
  cpu8: Object.freeze({ id: 'cpu8', name: 'MiniCPU 8', description: '8-bit PC · 256 B shared RAM · registers and jumps', memorySize: 256, addressBits: 8, stack: false, index: false }),
  cpu8s: Object.freeze({ id: 'cpu8s', name: 'MiniCPU 8S', description: '8-bit PC · 256 B RAM · stack, CALL and RET', memorySize: 256, addressBits: 8, stack: true, index: false }),
  cpu8x: Object.freeze({ id: 'cpu8x', name: 'MiniCPU 8X', description: '16-bit PC · 4 KiB shared RAM · 16-bit X and stack', memorySize: 4096, addressBits: 16, stack: true, index: true }),
});
export function architecture(id = 'cpu8') {
  const result = ARCHITECTURES[typeof id === 'string' ? id : id?.id];
  if (!result) throw new RangeError(`Unknown CPU architecture: ${id}`);
  return result;
}
