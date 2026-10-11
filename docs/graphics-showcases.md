# Three graphics showcases

These programs make actual images by executing assembly code. They contain no
pre-rendered bitmap and require no special CPU graphics instructions. A
`.display` directive is only a **suggestion to the web display controller**:
it has no machine-code bytes and never changes RAM or the CPU.

For each example, select the indicated CPU model and press **Run to end**.
Open the RAM inspector and change the display palette to separate *what is
stored* from *how the stored bytes are interpreted*.

## MiniCPU 8: Prism Gradient — `17-prism-gradient.asm`

- Display: 16×16, indexed 4-bit, `0x80..0xFF` (128 B).
- Code: 67 B in `0x00..0x42`, 256 B total shared RAM.
- Drawing: a nested loop writes eight bytes per row. Each byte stores two
  color indices: upper nibble for the left pixel, lower nibble for the right.
- The hue wraps at 16 and shifts by one index at each new row, creating a
  **smooth diagonal spectral gradient** with no lookup tables or multiplication.
- This deliberately replaces the older Plasma Garden as the introductory
  static graphics showcase; it is easier to understand and visually clearer.

**Discussion:** Why is four `SHL B` instructions equivalent to multiplying by
16? Why does the palette change the appearance but not the program? What
happens if the second index is equal to the first instead of being incremented?

## MiniCPU 8S: Neon Halo — `21-stack-neon-halo.asm`

- Display: 16×12, indexed 4-bit, `0x90..0xEF` (96 B).
- Code: 105 B. At `0xF0..0xFF`, the top 16 bytes are intentionally reserved
  for the downward-growing stack, rather than framebuffer data.
- The main loop calls `shade_pair` repeatedly. The subroutine saves A on the
  stack, recovers `x` and `y` from the byte's memory address, and evaluates
  `2 × (|x-8| + |y-6|) mod 16` to create vivid diamond-shaped concentric bands.
- It packs neighboring palette entries into one byte, restores A, writes
  the packed value to RAM, and returns. The CPU returns with SP unchanged.

**Discussion:** Why must A survive the subroutine? Where is the return
address stored? What would happen if the display ended at `0xFF`, right where
the stack begins? How would this program look without the double-distance
scaling (`SHL B`)?

## MiniCPU 8X: Neon Orbit — `22-extended-neon-orbit.asm`

- Display: 64×48, indexed 4-bit: **3,072 pixels using 1,536 bytes** at
  `0x0800..0x0DFF`. Code lives below `0x0100`, variables below `0x0100`,
  and the stack begins at `0x1000`.
- The `X` register is an address pointer that increments through the image.
  Two calls to `shade` compute two colors per packed framebuffer byte.
- The shade routine approximates circular distance from `(32,24)` using
  `max(abs(x-32), abs(y-24)) + min(abs(x-32), abs(y-24))/2`.
  The division by two is `SHR`, and the final palette index is masked with 15.
- The resulting image looks like concentric neon rings, despite having no
  floating-point arithmetic, multiplication, square roots, or graphics API.

**Discussion:** Why does this calculation form nearly circular rings rather
than diamond shapes? How can `X` address `0x0800` if each general-purpose
register remains 8-bit? How is `CALL16` different from `CALL`? What is the
minimal architectural change needed to store 1,536 bytes of pixel data?

## Teaching suggestion

Display the three pictures side by side and ask students to predict their
memory requirements *before* introducing the stack or extended addressing.
Emphasize that increasing the resolution does not require more colors or a
wider ALU: more addressable RAM is the critical resource here.
