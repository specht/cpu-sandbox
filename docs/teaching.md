# Teaching with the CPU Sandbox

The examples form one path from a single addition to a 3D maze, in chapters.
Each chapter ends with the tasks it prepares for (**Your turn**): the
examples show the instructions and ideas a task needs, never its solution.
Every example opens on the CPU level it needs (its `.cpu` line); the picker
shows the level next to the file name. The demos (fire, scroller, Mandelbrot,
inferno, cube, raycaster …) are there to show what the little machine can
do — start a lesson with one of them.

## 1. MiniCPU 8: instructions and loops

1. **`01-add`**: step through four instructions. Which bytes in the margin
   are the opcode, which the operands? How many cycles does each take?
2. **`02-loop`**: `DEC` and `JNZ`. Watch PC jump back, A shrink, B grow and
   ZF change. Start with 10 instead of 5. What happens with 0, and why is
   B then 128?
3. **`03-division`**: quotient and remainder by subtraction. The loop
   invariant is `13 = quotient × 4 + remainder`. Why does the loop end?

## 2. Memory and the screen

4. **`04-memory`**: constant, fixed address, address in a register. Find the
   text at `0x60` in the RAM view.
5. **`05-self-modifying`**: a program changes its own instruction. Predict B
   before you run it. The margin shows the changed byte in amber.
6. **`06-rectangle`**: pixel (x, y) is at `0x80 + 16·y + x`. Draw only the
   border instead, then compare the cycle counts.
7. **`07-pixel-formats`**: one ramp of bytes, many pictures. Switch the pixel
   format and explain each picture from the bits.

**Your turn:** the tasks *Add*, *Length*, *Maximum*, *Fibonacci*,
*Multiply*, *Sort* and *Checkerboard*, in this order.

## 3. Devices: input and output

8. **`08-input`**: the program polls three devices in a loop. Why does the
   dot move exactly ten times per second, at any clock? What happens at
   1 kHz? Which key codes do Enter and Backspace give?
9. **`09-fire`** (demo): the whole effect in 80 bytes next to its own
   screen, with random numbers from port 3. Set the clock to 100 kHz and to
   1 MHz: how many frames per second does each give? Drag the screen down
   over the code. What changes when the random cooling uses `AND C, 15`
   instead of `AND C, 31`?

**Your turn:** *Countdown* and *Typed digits*.

## 4. MiniCPU 8S: subroutines and the stack

10. **`10-subroutines`**: step through nested `CALL`s and watch SP and the
    bytes at `0xFC`–`0xFF`. Which return address is on the stack when?
11. **`11-hanoi`**: the Towers of Hanoi, a function that calls itself twice,
    with its four arguments on the stack. Step into a few calls and find
    n, from, to and via in the RAM view. How low does SP get? Why could the
    arguments not live at fixed addresses? Change it to three disks; why
    would five not fit on this screen?
12. **`12-scroller`** (demo): two subroutines move a 32 × 8 LED sign. Change
    the message — each letter is a list entry pointing to a glyph. Add a
    glyph of your own. How many cycles does one frame need?

**Your turn:** no task needs the stack, but any task may use it: add
`.cpu 8s` and write *Multiply* or *Maximum* as a subroutine.

## 5. MiniCPU 8X: more memory, pointers

13. **`13-pointers`**: X reads, Y writes. Why are A–D not enough as pointers
    on 8X? Compare the bytes of `LDA A, [0x70]` on 8S and on 8X (switch the
    CPU menu): the same source, longer code, more cycles.
14. **`14-mandelbrot`** (demo): signed fixed-point numbers, a table of squares
    instead of multiplication, and 9-bit arithmetic with the carry flag. Run it
    at 1 MHz (about six seconds) and at 16 MHz. Try another section of the set
    by changing the offsets in `row` and `pixel`.
15. **`15-inferno`** (demo): the fire from MiniCPU 8 at 128 × 96 pixels, with
    the even simpler algorithm from DOOM. Compare it with `09-fire`: what
    does 8X make possible, and what does each pixel cost in cycles? Make the
    wind blow the other way.
16. **`16-breakout`** (game): find where it waits for the timer, reads the
    joystick and asks the screen what the ball is about to hit. Lower the
    clock until the game slows down — how many cycles does one step need?
    Then tap Space very briefly: why is the tap sometimes missed?

**Your turn:** *Average* and *Reverse a text*.

## 6. C: the same machine, one level up

17. **`17-first-c.c`** (MiniCPU 8S): a loop, a function and a call. Open the
    Assembly tab and find the C lines in it. Where do `i`, `sum` and `n` live?
    What does `square(n)` push, and how does the result come back?

**Your turn:** solve a task from chapter 2 again, in C. **Class progress**
shows both solutions side by side: how many more bytes and cycles does C
cost? Then the C tasks: *Factorial*, *gcd*, *Primes*, *Letters* and *Line*.

## 7. C: demos and games

18. **`18-cube.c`** (demo): 3D rotation with a sine table in fixed
    point, perspective, hidden faces, flat shading, filled polygons and page
    flipping. `fill()` is written in assembly: count its cycles per byte and
    compare with `clear` loops the compiler generates. Switch the RAM view to
    256 bytes per row and watch the two pages take turns. `make_palette()`
    computes 192 colors: give the cube other colors.
19. **`19-snake.c`** (game): every device at once. How does `in(VSYNC)` pace
    the game, and why is the joystick read in every frame? How does the snake
    know what is in front of it? Make the walls deadly only on two sides.
20. **`20-plasma.c`** (demo): three waves from one table of 64 values. Why
    does `(char)(…)` make the rainbow go round? Change the waves.
21. **`21-life.c`**: Conway's Game of Life. Count the cycles of one
    generation; how could the neighbour count be made cheaper?
22. **`22-stars.c`**: perspective in one line, `x / z`. Watch the stars in the
    RAM map; why do the `(int)` casts matter? Tint the far stars blue by
    changing the palette, not the drawing code.
23. **`23-color-cycling.c`**: a picture that moves without changing RAM.
    Watch the RAM view while it runs. How many `OUT`s does one frame need, and
    how many cycles would redrawing the screen cost instead? Make the rings
    flow inwards; cycle only half of the colors.
24. **`24-arpeggio-organ.c`**: an instrument. Play "New Born" (Em H Em H Em
    C G H: Shift+T, +, Shift+T, +, Shift+T, Q, I, +). A press starts its
    chord at once: why does the program compare the key with the one held
    in the last frame, and what would happen without `held`? Why is the
    note played *before* the picture is updated? ← and → switch between
    five arpeggio patterns: add a sixth, or make the digit row play single
    notes.
25. **`25-raycaster.c`**: a 3D maze, like Wolfenstein 3D, without floating
    point. Find the golden door. Watch the frames per second on the number
    display at different clocks. Pause a few times: in which function is
    the CPU most often, and why? Why is the floor cheaper per pixel than the
    walls? Change the map, the textures or the fog.

## Cycles: inside one instruction

Switch on **Cycles** next to the step buttons and step with →: every press
is one clock cycle. Fetch the opcode, decode it, fetch the operands, read or
write RAM, jump. Good questions for any example: Why does `LDA A, [0x80]`
take one cycle more than `LDI A, 0x80`? What does `CALL` write, and where?
Why does a taken `JZ` cost one cycle more than one that is not taken?

## Tasks with automatic checks

Sixteen tasks check themselves: **+** creates a program for a task,
**Check** runs its test cases and **Class progress** compares the working
solutions by cycles and bytes. Eleven of them suit assembly on MiniCPU 8
and can be solved again in C on 8X, to see the price of C side by side; five
are C tasks (recursion, gcd, a sieve, counting letters, drawing a line). See
[tasks.md](tasks.md).

## Projects

Open-ended, without a check — for fast students or as homework:

- A dot that bounces off the edges of the screen forever, leaving a fading
  trail (8).
- The integer square root: subtract 1, 3, 5, 7, … until nothing is left, and
  count (8).
- Add two 16-bit numbers stored as low/high bytes with `ADD` and `ADC`.
- Write a function `plot(x, y)` for the 16 × 8 gray screen that takes its
  arguments on the stack, and use it to draw a diagonal (8S).
- The Towers of Hanoi without recursion: the smallest disk moves every other
  turn, always in the same direction.
- Make the fire burn sideways, or give the scroller a second line of text.
- A reaction game: wait a random time (port 3), light the screen and count
  timer ticks until Space is pressed. Show the result on the number display.
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
