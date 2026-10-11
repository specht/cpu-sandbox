// ROTATING CUBE
//
// A wireframe cube in 3D, written in C. Every frame turns the eight corners
// around two axes, projects them onto the screen with perspective (farther
// away = closer to the middle) and draws the twelve edges with Bresenham's
// line algorithm: edges at the back in magenta, at the front in white.
//
// Double buffering: there are two screen pages. The program clears and draws
// the hidden one, then shows it with out(SCREEN_PAGE, …), so you never see a
// half-drawn cube. Watch the start address of the screen jump back and forth.
//
// There is no multiplication instruction and no floating point: sin and cos
// come from a table in which 64 means 1.0, and the compiler calls small
// helper routines for * and /. The assembly view shows them at the end.
// The timer sets the angle, so the cube turns at the same speed at any
// clock; at 4 MHz it draws about 20 pictures per second, at 16 MHz 80.

#pragma cpu 8x
#pragma display 0x0900, 64, 48, indexed2, cga_palette_1_high

#define SIZE 16                 // half the length of an edge
#define DISTANCE 80             // how far away the cube is
#define ZOOM 50                 // larger: a bigger picture
#define BACK 1                  // colors: magenta
#define FRONT 3                 //         white

char *pages[2] = {(char*)0x0900, (char*)0x0C00};   // 64 x 48 pixels, 768 bytes each
char *page;                                         // the page being drawn

int sine[64] = {
    0, 6, 12, 19, 24, 30, 36, 41, 45, 49, 53, 56, 59, 61, 63, 64,
    64, 64, 63, 61, 59, 56, 53, 49, 45, 41, 36, 30, 24, 19, 12, 6,
    0, -6, -12, -19, -24, -30, -36, -41, -45, -49, -53, -56, -59, -61, -63, -64,
    -64, -64, -63, -61, -59, -56, -53, -49, -45, -41, -36, -30, -24, -19, -12, -6};

int corners[24] = {             // x, y, z of the eight corners
    -SIZE, -SIZE, -SIZE,   SIZE, -SIZE, -SIZE,   SIZE, SIZE, -SIZE,   -SIZE, SIZE, -SIZE,
    -SIZE, -SIZE,  SIZE,   SIZE, -SIZE,  SIZE,   SIZE, SIZE,  SIZE,   -SIZE, SIZE,  SIZE};
char edges[24] = {0, 1, 1, 2, 2, 3, 3, 0,   4, 5, 5, 6, 6, 7, 7, 4,   0, 4, 1, 5, 2, 6, 3, 7};

int screen_x[8];                // the corners on the screen …
int screen_y[8];
int depth[8];                   // … and how far away they are

// Four pixels share a byte, the leftmost one in the highest two bits.
char keep[4] = {0x3F, 0xCF, 0xF3, 0xFC};
char bits[16] = {0, 0, 0, 0,   0x40, 0x10, 0x04, 0x01,
                 0x80, 0x20, 0x08, 0x02,   0xC0, 0x30, 0x0C, 0x03};

void plot(int x, int y, char color) {
    if (x < 0 || x >= 64 || y < 0 || y >= 48) return;  // never write outside the page
    char *p = page + y * 16 + x / 4;
    char k = x & 3;
    *p = (*p & keep[k]) | bits[color * 4 + k];
}

void line(int x0, int y0, int x1, int y1, char color) {
    int dx = x1 - x0, dy = y1 - y0, sx = 1, sy = 1;
    if (dx < 0) { dx = -dx; sx = -1; }
    if (dy < 0) { dy = -dy; sy = -1; }
    int error = dx - dy;
    for (;;) {
        plot(x0, y0, color);
        if (x0 == x1 && y0 == y1) break;
        int twice = error + error;
        if (twice > -dy) { error -= dy; x0 += sx; }
        if (twice < dx) { error += dx; y0 += sy; }
    }
}

void clear() {
    char *p = page, *end = page + 768;
    while (p != end) *p++ = 0;
}

// Turns all corners by the angle a around the y axis and b around the x axis
// (64 steps make a full turn) and projects them onto the screen.
void project(char a, char b) {
    int sa = sine[a & 63], ca = sine[(a + 16) & 63];
    int sb = sine[b & 63], cb = sine[(b + 16) & 63];
    for (char i = 0; i < 8; i++) {
        int x = corners[3 * i], y = corners[3 * i + 1], z = corners[3 * i + 2];
        int x1 = (x * ca - z * sa) / 64;
        int z1 = (x * sa + z * ca) / 64;
        int y1 = (y * cb - z1 * sb) / 64;
        int z2 = (y * sb + z1 * cb) / 64;
        screen_x[i] = 32 + x1 * ZOOM / (z2 + DISTANCE);
        screen_y[i] = 24 + y1 * ZOOM / (z2 + DISTANCE);
        depth[i] = z2;
    }
}

// Draws the edges at the back (color BACK) or at the front (FRONT).
void edges_in(char color) {
    for (char e = 0; e < 12; e++) {
        char from = edges[2 * e], to = edges[2 * e + 1];
        char front = depth[from] + depth[to] < 0;
        if (front == (color == FRONT))
            line(screen_x[from], screen_y[from], screen_x[to], screen_y[to], color);
    }
}

void main() {
    char hidden = 1;
    for (;;) {
        page = pages[hidden];
        clear();
        char t = in(TIMER);
        project(t / 2, t / 3);
        edges_in(BACK);                     // the front edges are drawn last,
        edges_in(FRONT);                    // so they cover the back ones
        out(SCREEN_PAGE, (int)page >> 8);   // show the finished picture
        hidden = 1 - hidden;
    }
}
