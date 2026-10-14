// COLOR CYCLING
//
// The picture is drawn only once. Every pixel holds a color number 1..64
// that depends on its distances d1 and d2 to two points: d1 + 2·d2 gives
// rings that close in around the second point. (With d1 + d2, the sum is
// the same all along the line between the points, and a flat patch of one
// color sits there.) Afterwards, 60 times per second, the program waits for the
// screen's next picture with in(VSYNC) and moves all 64 colors one place
// further in the palette chip: the rings flow outwards, and not a single
// byte of the screen changes. Watch the RAM view while it runs. Games of the
// 80s and 90s animated water, fire and waterfalls this way.
//
// The distances come from two tables, because the CPU can neither multiply
// nor take a square root quickly: squares[d] = d², root[n] = √(4·n), which
// is twice the distance for n = d²: half pixels make smoother rings. Every
// n has its own entry; a smaller table (n = d² / 16) would give all pixels
// near a point the same distance, a round patch of one color.
// ← and → on the joystick change the speed and the direction.
// Try 16 MHz: drawing takes a moment, cycling the colors hardly any time.

#pragma cpu 8x
#pragma display 0x4000, 128, 96, indexed8

#define W 128
#define H 96
#define SCREEN ((char*)0x4000)
#define COLORS 64
#define ROOTS 10900             // root[n] for n = d² < 10,900 (88² + 56² = 10,880)

int squares[W];
char root[ROOTS];               // up to 2 · 104
char red[COLORS];               // one trip around the color wheel
char green[COLORS];
char blue[COLORS];

// 0 → 248 → 0 while t goes from 0 to 63.
char wave(char t) {
    t = t & 63;
    return t < 32 ? t * 8 : (63 - t) * 8;
}

// Writes colors 1..64 into the palette chip, starting shift places further on the wheel.
void show_colors(char shift) {
    out(PALETTE, 1);
    for (char i = 0; i < COLORS; i++) {
        char c = (i + shift) & (COLORS - 1);
        out(COLOR, red[c]);
        out(COLOR, green[c]);
        out(COLOR, blue[c]);
    }
}

int distance(int dx, int dy) {
    if (dx < 0) dx = -dx;
    if (dy < 0) dy = -dy;
    return root[squares[dx] + squares[dy]];
}

void main() {
    for (char i = 0; i < COLORS; i++) {
        red[i] = wave(i);
        green[i] = wave(i + 21);
        blue[i] = wave(i + 42);
    }
    show_colors(0);

    for (int d = 0; d < W; d++) squares[d] = d * d;
    unsigned int n = 0;                         // unsigned: 4 · n goes up to 43,600
    for (unsigned int r = 0; n < ROOTS; r++)    // root[n] = r for r² ≤ 4·n < (r+1)²
        while (n < ROOTS && n * 4 < (r + 1) * (r + 1)) root[n++] = r;

    char *p = SCREEN;
    for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++)
            *p++ = 1 + ((distance(x - 40, y - 40) + 2 * distance(x - 88, y - 56)) & (COLORS - 1));

    char shift = 0;
    int speed = 1;
    for (;;) {
        char frame = in(VSYNC);                 // wait for the screen's next picture
        if ((frame & 7) == 0) {
            char keys = in(JOYSTICK);
            if (keys & JOY_RIGHT && speed < 4) speed++;
            if (keys & JOY_LEFT && speed > -4) speed--;
        }
        shift -= speed;                         // the rings flow outwards
        show_colors(shift);
    }
}
