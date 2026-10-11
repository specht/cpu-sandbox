# Teaching with CPU Sandbox

MiniCPU has four 8-bit registers, 256 bytes of shared RAM and ZF/CF. The
visualizer can *interpret* any portion of RAM as a framebuffer in different
formats. This tiny, completely inspectable architecture is useful for
connecting algorithms and machine-level execution.

## Short progression

1. **Instructions and state:** Run `01-add.asm`. Examine register changes and
   machine bytes. Ask which bytes encode the instruction and its operands.
2. **Control flow:** In `02-countdown.asm`, step through `DEC`/`JNZ`; observe
   the program counter and zero flag. Change the initial value.
3. **Algorithms:** In `03-division.asm`, interpret the loop invariant:
   `numerator = quotient × divisor + remainder`. Explain why the loop terminates.
4. **Representation:** In `04-square-root.asm`, subtract successive odd numbers
   to calculate the integer square root. Determine the output for 0, 1, 24, 25.
5. **Addressing and memory:** In `08-data.asm`, compare immediate, direct and
   register-indirect modes. Locate the string bytes with `.org` and `.db`.
6. **Graphics:** In `05-fill-rectangle.asm`, calculate the address of pixel
   `(x,y) = (3,2)` as `0x80 + 2×16 + 3 = 0xA3`; discuss how row bytes follow from width and bit depth.
7. **Complexity:** Use `06-primes.asm` to count executed instructions, and propose
   changes to the divisibility test. Distinguish time and memory complexity.
8. **Persistent loops:** `07-bouncing-dot.asm` intentionally never halts;
   practice pausing, resetting and exploring a pixel-based state machine.
9. **Packed pixels:** Compare `09-monochrome-32x8.asm`, `10-cga-2bit.asm` and
   `11-pico8-4bit.asm`. Keep RAM unchanged and switch only pixel format: how
   do groups of bits become colors? Why does the resolution change?
10. **Color representation:** Compare `13-rgb332.asm` and `14-rgb24.asm`.
    Why is RGB888 so memory-expensive? How many bytes does each row use?
11. **Monochrome animation:** Run `15-checkerboard-animation.asm` and
    change bit depth while the CPU keeps drawing. Explain why 512 pixels
    occupy only 64 bytes. Why is the program still able to execute?
12. **Self-modifying code:** Step through `12-self-modifying.asm` and watch the
    machine-code inspector change the immediate byte from 0 to 42. Predict
    register B at program termination before pressing Step.

## Exercises

- Write a program that calculates `1+2+...+n` for values small enough not to
  overflow. Document what happens when an 8-bit result exceeds 255.
- Implement integer multiplication by repeated addition, and explain how to
  avoid an off-by-one error when the multiplier is zero.
- Read eight values at addresses `0x70..0x77` using register-indirect loads
  and find their maximum. Explain why code and data can share RAM.
- Draw only the border of a rectangle, then compare its store count with the
  filled rectangle example.
- Rewrite the prime number algorithm as a sieve (if it can fit in this tiny
  memory model); compare instruction counts and discuss trade-offs.

## Pitfalls worth discussing

- There is **one RAM**; the display reads whichever region the controller
  chooses. A program can accidentally overwrite its own instructions when its
  graphics region intersects its program. The controller is not CPU hardware.
- The registers and arithmetic wrap at 8 bits; interpreting `CF` as borrow
  for subtraction is not the same as signed arithmetic.
- A label represents a byte address, **not** an instruction index.
- RAM is writable, including bytes that originally held machine instructions.
  This makes self-modifying programs possible (and occasionally surprising).
- Halting and an infinite loop are different: the latter needs a manual pause
  or an execution bound. Never claim the bounded Run-to-end means termination.

### Suggested experiment: one byte, four interpretations

Load `10-cga-2bit.asm`, run to HLT and inspect RAM at `0xA0`. It contains
`0x1B`, binary `00011011`. With 2-bit indexing this maps to four palette
indices `0, 1, 2, 3`. Change the controller to 1-bit indexed at the same
start address (adjust width and height to suit): now the identical byte
represents *eight* pixels. Change to grayscale: the same byte represents
*one* pixel with brightness 27. No assembly or CPU step is involved in any
of these changes. This makes the distinction between a stored byte and the
meaning a device assigns to it explicit.

The students' files live in the Git-tracked class repository under `programs/`.
Examples bundled with the application are read-only; copies belong to students.
