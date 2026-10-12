// PLASMA
//
// The classic demo effect: every pixel adds up three waves, one running
// across, one down and one diagonally, and the sum picks a color from a
// rainbow. All waves come from one table of 64 values, so the CPU never
// computes a sine; per pixel it only looks up, adds and stores. As the waves
// move and the rainbow turns, the picture flows.
//
// The pixels are 8-bit RGB 3-3-2 colors (3 bits red, 3 green, 2 blue), so
// the rainbow is computed once at the start, as a table of 256 colors.
// char arithmetic wraps around at 256, which is exactly what a color table
// that goes round in a circle needs. Two pages make the animation smooth.
// Try 16 MHz.

#pragma cpu 8x
#pragma display 0x2000, 80, 60, rgb332

#define W 80
#define H 60

char *pages[2] = {(char*)0x2000, (char*)0x4000};    // 80 x 60 bytes each

char wave[64] = {                                   // 32 + 31 sin, one turn
    32, 35, 38, 41, 44, 47, 49, 52, 54, 56, 58, 59, 61, 62, 62, 63,
    63, 63, 62, 62, 61, 59, 58, 56, 54, 52, 49, 47, 44, 41, 38, 35,
    32, 29, 26, 23, 20, 17, 15, 12, 10, 8, 6, 5, 3, 2, 2, 1,
    1, 1, 2, 2, 3, 5, 6, 8, 10, 12, 15, 17, 20, 23, 26, 29};
char rainbow[256];
char across[W];                 // the wave across, for this frame
char down[H];                   // the wave down, for this frame

void make_rainbow() {
    for (int i = 0; i < 256; i++) {
        char k = i / 4;                             // 0..63: one turn of the wave
        char red = wave[k & 63] / 8;                // 0..7
        char green = wave[(k + 21) & 63] / 8;       // a third of a turn later
        char blue = wave[(k + 42) & 63] / 16;       // 0..3
        rainbow[i] = (red << 5) | (green << 2) | blue;
    }
}

void main() {
    make_rainbow();
    char t = 0, hidden = 1;
    for (;;) {
        for (char x = 0; x < W; x++) across[x] = wave[(x + t) & 63] + wave[(2 * x - t) & 63];
        for (char y = 0; y < H; y++) down[y] = wave[(y * 2 + t + t) & 63];
        char *p = pages[hidden];
        for (char y = 0; y < H; y++) {
            char row = down[y] + t;                 // + t turns the rainbow
            char diagonal = y - t;
            for (char x = 0; x < W; x++)
                *p++ = rainbow[(char)(across[x] + row + wave[(x + diagonal) & 63])];
        }
        out(SCREEN_PAGE, (int)pages[hidden] >> 8);
        hidden = 1 - hidden;
        t++;
    }
}
