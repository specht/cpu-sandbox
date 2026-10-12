// GAME OF LIFE
//
// John Conway's cellular automaton on a 64 x 48 grid. Every generation, a
// cell counts its eight neighbours: a living cell with two or three stays
// alive, an empty cell with exactly three is born, all others die.
//
// The rules work on two arrays of 0s and 1s: the next generation is computed
// from the current one, then the two swap roles. The screen is separate and
// only shows the result in color: a newborn cell glows white, an old one
// cools to orange, and a dead one leaves a short fading trail. The number
// display counts the generations (up to 255: it shows one byte); Space or any
// other key scatters new random cells. About 15 generations per second at
// 16 MHz, 30 at 32 MHz.

#pragma cpu 8x
#pragma display 0x4000, 64, 48, indexed8, fire_256

#define W 64
#define H 48
#define SCREEN ((char*)0x4000)

char grid_a[W * H];
char grid_b[W * H];
char *now = grid_a, *next = grid_b;

void scatter() {
    for (int i = 0; i < W * H; i++) now[i] = in(RANDOM) < 70;    // about a quarter alive
}

void main() {
    int generation = 0;
    scatter();
    for (;;) {
        if (in(JOYSTICK)) { scatter(); generation = 0; }
        // The border stays empty, so every inner cell has eight neighbours.
        for (int y = 1; y < H - 1; y++) {
            char *cell = now + y * W + 1, *result = next + y * W + 1, *dot = SCREEN + y * W + 1;
            for (char x = 1; x < W - 1; x++) {
                char neighbours = cell[-W - 1] + cell[-W] + cell[-W + 1]
                                + cell[-1] + cell[1]
                                + cell[W - 1] + cell[W] + cell[W + 1];
                char alive = neighbours == 3 || (neighbours == 2 && *cell);
                *result = alive;
                char heat = *dot;
                if (alive) *dot = *cell ? (heat > 120 ? heat - 15 : 120) : 255;   // born white, cools to orange
                else *dot = heat > 50 ? heat - 50 : 0;                            // a short fading trail
                cell++;
                result++;
                dot++;
            }
        }
        char *swap = now;
        now = next;
        next = swap;
        out(NUMBER, ++generation);
    }
}
