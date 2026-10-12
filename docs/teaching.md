# Teaching with the CPU Sandbox

The examples form one path from a single addition to a fractal. Every
example opens on the CPU level it needs (its `.cpu` line); the picker shows
the level next to the file name.

## MiniCPU 8: instructions, memory, loops

1. **`01-add`**: step through four instructions. Which bytes in the margin
   are the opcode, which the operands? How many cycles does each take?
2. **`02-countdown`**: `DEC` and `JNZ`. Watch PC jump back and ZF change.
   Change the start value — what happens with 0?
3. **`03-division`**: quotient and remainder by subtraction. The loop
   invariant is `13 = quotient × 4 + remainder`. Why does the loop end?
4. **`04-square-root`**: subtract odd numbers. Predict D for 0, 1, 24, 25.
5. **`05-memory`**: constant, fixed address, address in a register. Find the
   string at `0x60` in the RAM view.
6. **`06-rectangle`**: pixel (x, y) is at `0x80 + 16·y + x`. Draw only the
   border instead, then compare the cycle counts.
7. **`07-primes`**: trial division is slow — note the cycles, then make it
   faster (stop at √n, skip even numbers, or write a sieve).
8. **`08-self-modifying`**: a program changes its own instruction. Predict B
   before you run it. The margin shows the changed byte in amber.
9. **`09-pixel-formats`**: one ramp of bytes, many pictures. Switch the pixel
   format and explain each picture from the bits.
10. **`10-bouncing-dot`**: a program that never halts. Pause, step back and
    find where direction and trail are stored.
11. **`11-fire`** (demo): the whole effect in 80 bytes next to its own
    screen. Set the clock to 100 kHz and to 1 MHz: how many frames per
    second does each give? Drag the screen down over the code. What changes
    when the random cooling uses `AND C, 15` instead of `AND C, 31`?

## MiniCPU 8S: subroutines and the stack

12. **`12-subroutines`**: step through nested `CALL`s and watch SP and the
    bytes at `0xFC`–`0xFF`. Which return address is on the stack when?
13. **`13-recursion`**: Fibonacci by a function that calls itself, with its
    argument and a local variable on the stack (`SUB SP`, `[SP+n]`). Draw the stack
    for fib(3) on paper, then step through it. Why would a local variable at
    a fixed address break the recursion?
14. **`14-scroller`** (demo): two subroutines move a 32 × 8 LED sign. Change
    the message — each letter is a list entry pointing to a glyph. Add a
    glyph of your own. How many cycles does one frame need?

## MiniCPU 8X: more memory, pointers

15. **`15-pointers`**: X reads, Y writes. Why are A–D not enough as pointers
    on 8X? Compare the bytes of `LDA A, [0x70]` on 8S and on 8X (switch the
    CPU menu): the same source, longer code, more cycles.
16. **`16-lines`**: Bresenham's line algorithm with only addition and
    comparison. `plot` computes a 16-bit address with `ADD X, X` and
    `ADD X, A`. Add a second shape.
17. **`17-mandelbrot`** (demo): signed fixed-point numbers, a table of squares
    instead of multiplication, and 9-bit arithmetic with the carry flag. Run it
    at 1 MHz (about six seconds) and at 16 MHz. Try another section of the set
    by changing the offsets in `row` and `pixel`.
18. **`18-inferno`** (demo): the fire from MiniCPU 8 at 128 × 96 pixels, with
    the even simpler algorithm from DOOM. Compare it with `11-fire`: what
    does 8X make possible, and what does each pixel cost in cycles? Make the
    wind blow the other way.

## Devices: input and output

19. **`19-input`** (MiniCPU 8): the program polls three devices in a loop. Why
    does the dot move exactly ten times per second, at any clock? What happens
    at 1 kHz? Which key codes do Enter and Backspace give?
20. **`20-breakout`** (MiniCPU 8X): a complete game. Find where it waits for
    the timer, reads the joystick and asks the screen what the ball is about
    to hit. Lower the clock until the game slows down — how many cycles does
    one step need? Then tap Space very briefly: why is the tap sometimes
    missed?

## C: the same machine, one level up

21. **`21-first-c.c`** (MiniCPU 8S): a loop, a function and a call. Open the
    Assembly tab and find the C lines in it. Where do `i`, `sum` and `n` live?
    What does `square(n)` push, and how does the result come back?
22. **`22-cube.c`** (MiniCPU 8X, demo): 3D rotation with a sine table in fixed
    point, perspective, hidden faces, flat shading, filled polygons and page
    flipping. `fill()` is written in assembly: count its cycles per byte and
    compare with `clear` loops the compiler generates. Switch the RAM view to
    256 bytes per row and watch the two pages take turns. `make_palette()`
    computes 192 colors: give the cube other colors.
23. **`23-snake.c`** (game): every device at once. How does `in(VSYNC)` pace
    the game, and why is the joystick read in every frame? How does the snake
    know what is in front of it? Make the walls deadly only on two sides.
24. **`24-plasma.c`** (demo): three waves from one table of 64 values. Why
    does `(char)(…)` make the rainbow go round? Change the waves.
25. **`25-life.c`**: Conway's Game of Life. Count the cycles of one
    generation; how could the neighbour count be made cheaper?
26. **`26-stars.c`**: perspective in one line, `x / z`. Watch the stars in the
    RAM map; why do the `(int)` casts matter? Tint the far stars blue by
    changing the palette, not the drawing code.
27. **`27-color-cycling.c`**: a picture that moves without changing RAM.
    Watch the RAM view while it runs. How many `OUT`s does one frame need, and
    how many cycles would redrawing the screen cost instead? Make the rings
    flow inwards; cycle only half of the colors.

## Exercises

- Sum 1 + 2 + … + n. What happens when the result passes 255? Use CF to
  detect it.
- Multiply by repeated addition; then by shifting and adding. Count cycles.
- Find the largest of eight bytes at `0x70`–`0x77` with `LDA A, [B]`.
- Write a function `plot(x, y)` for the 16 × 8 gray screen that takes its
  arguments on the stack, and use it to draw a diagonal (8S).
- Compute n! recursively and find the largest n whose result fits in a byte.
- Add two 16-bit numbers stored as low/high bytes with `ADD` and `ADC`.
- Make the fire burn sideways, or give the scroller a second line of text.
- A reaction game: wait a random time (port 3), light the screen and count
  timer ticks until Space is pressed. Show the result on the number display.
- Write the same small program in C and in assembly. Compare the size and the
  cycles with the code the compiler generates.
- Pong: one paddle on the joystick, the other one steered by the computer
  (it follows the ball, but only every other step), the ball from Breakout,
  and a score for each side.
- Breakout: make the bricks two pixels tall, give bricks in higher rows more
  points, or speed the ball up after every ten bricks.

## Worth discussing

- There is **one RAM**. The screen and the stack are just regions of it, and
  a store to the wrong address can change the program itself.
- A label is the address of a byte, not a line number.
- 8-bit arithmetic wraps: 255 + 1 = 0 with CF set. `-1` is 255.
- "Halted" and "still running" are different: an endless loop needs Pause.
- Cycles are what take time, not lines of source: compare a loop on 8S
  and on 8X.
