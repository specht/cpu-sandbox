// SOLID CUBE
//
// A shaded cube in 3D, written in C. Every frame turns the corners and the
// face normals around two axes and projects the corners onto the screen with
// perspective. A face is drawn only if it faces the viewer, filled row by row,
// and the more directly it faces the viewer, the brighter its color: the
// palette ramps_256 has 32 shades of each color.
//
// Double buffering: there are two screen pages of 12 KiB each. The program
// draws into the hidden page and then shows it with out(SCREEN_PAGE, …), so
// you never see a half-drawn cube.
//
// The hottest loop, filling bytes, is written in assembly inside the C
// function fill(). sin and cos come from a table in which 64 means 1.0.
// The timer sets the angle, so the cube turns at the same speed at any
// clock; try 16 MHz.

#pragma cpu 8x
#pragma display 0x4000, 128, 96, indexed8, ramps_256

#define WIDTH 128
#define HEIGHT 96
#define SIZE 28                 // half the length of an edge
#define DISTANCE 150            // how far away the cube is
#define ZOOM 96                 // larger: a bigger picture (it must stay on the screen)

char *pages[2] = {(char*)0x4000, (char*)0x7000};    // 128 x 96 pixels each
char *page;                                         // the page being drawn
int used_top[2] = {0, 0};       // the rows the last picture on each page covered
int used_bottom[2] = {HEIGHT - 1, HEIGHT - 1};

int sine[64] = {
    0, 6, 12, 19, 24, 30, 36, 41, 45, 49, 53, 56, 59, 61, 63, 64,
    64, 64, 63, 61, 59, 56, 53, 49, 45, 41, 36, 30, 24, 19, 12, 6,
    0, -6, -12, -19, -24, -30, -36, -41, -45, -49, -53, -56, -59, -61, -63, -64,
    -64, -64, -63, -61, -59, -56, -53, -49, -45, -41, -36, -30, -24, -19, -12, -6};

int corners[24] = {             // x, y, z of the eight corners
    -SIZE, -SIZE, -SIZE,   SIZE, -SIZE, -SIZE,   SIZE, SIZE, -SIZE,   -SIZE, SIZE, -SIZE,
    -SIZE, -SIZE,  SIZE,   SIZE, -SIZE,  SIZE,   SIZE, SIZE,  SIZE,   -SIZE, SIZE,  SIZE};
char faces[24] = {0, 1, 2, 3,   5, 4, 7, 6,   4, 0, 3, 7,   1, 5, 6, 2,   4, 5, 1, 0,   3, 2, 6, 7};
int normals[18] = {0, 0, -64,   0, 0, 64,   -64, 0, 0,   64, 0, 0,   0, -64, 0,   0, 64, 0};
// The palette ramps_256 has eight ramps of 32 shades: color = 32 * ramp + shade.
char ramps[6] = {1, 2, 3, 4, 5, 6};     // red, orange, yellow, green, cyan, blue

int screen_x[8];                // the corners on the screen
int screen_y[8];
char left[HEIGHT];              // the span of the face being filled, per row
char right[HEIGHT];
int top, bottom;
int sa, ca, sb, cb;             // sin and cos of the two angles
int tx, ty, tz;                 // the result of turn()

// Fills count bytes from p with color. The loop is assembly: four
// instructions per byte. The arguments are on the stack above the return
// address: color at [SP+2], count at [SP+3], p at [SP+5].
void fill(char *p, int count, char color) {
    asm("LDA A, [SP+2]          ; A = color\n"
        "LDA Y, [SP+3]          ; Y = count\n"
        "LDA X, [SP+5]          ; X = p\n"
        "CMP Y, 0\n"
        "JZ fill_done\n"
        "fill_loop:\n"
        "STA [X], A\n"
        "INC X\n"
        "DEC Y\n"
        "JNZ fill_loop\n"
        "fill_done:");
}

// Turns (x, y, z) around the y axis and then the x axis.
void turn(int x, int y, int z) {
    tx = (x * ca - z * sa) / 64;
    int z1 = (x * sa + z * ca) / 64;
    ty = (y * cb - z1 * sb) / 64;
    tz = (y * sb + z1 * cb) / 64;
}

// Widens the spans of the rows from (x0, y0) to (x1, y1), with x in 1/256.
void edge(int x0, int y0, int x1, int y1) {
    if (y0 > y1) { int t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
    unsigned int x = x0 * 256 + 128;
    int step = 0;
    if (y1 > y0) step = (x1 - x0) * 256 / (y1 - y0);
    for (int y = y0; y <= y1; y++) {
        char column = x >> 8;
        if (column < left[y]) left[y] = column;
        if (column > right[y]) right[y] = column;
        x += step;
    }
    if (y0 < top) top = y0;
    if (y1 > bottom) bottom = y1;
}

// Fills face f: first the span of every row, then the rows.
void draw_face(char f, char color) {
    char *corner = faces + 4 * f;
    int all_top = top, all_bottom = bottom;
    top = HEIGHT; bottom = 0;
    for (char i = 0; i < 4; i++) {
        char a = corner[i], b = corner[(i + 1) & 3];
        int ya = screen_y[a], yb = screen_y[b];
        for (int y = ya < yb ? ya : yb; y <= (ya < yb ? yb : ya); y++) { left[y] = WIDTH - 1; right[y] = 0; }
    }
    for (char i = 0; i < 4; i++) {
        char a = corner[i], b = corner[(i + 1) & 3];
        edge(screen_x[a], screen_y[a], screen_x[b], screen_y[b]);
    }
    for (int y = top; y <= bottom; y++)
        fill(page + y * WIDTH + left[y], right[y] - left[y] + 1, color);
    if (all_top < top) top = all_top;
    if (all_bottom > bottom) bottom = all_bottom;
}

void main() {
    char hidden = 1;
    for (;;) {
        page = pages[hidden];
        // Clear only the rows the last picture on this page covered.
        fill(page + used_top[hidden] * WIDTH, (used_bottom[hidden] - used_top[hidden] + 1) * WIDTH, 0);

        char t = in(TIMER);
        char a = t / 2, b = t / 4;
        sa = sine[a & 63]; ca = sine[(a + 16) & 63];
        sb = sine[b & 63]; cb = sine[(b + 16) & 63];
        for (char i = 0; i < 8; i++) {
            turn(corners[3 * i], corners[3 * i + 1], corners[3 * i + 2]);
            screen_x[i] = WIDTH / 2 + tx * ZOOM / (tz + DISTANCE);
            screen_y[i] = HEIGHT / 2 + ty * ZOOM / (tz + DISTANCE);
        }
        top = HEIGHT; bottom = 0;
        for (char f = 0; f < 6; f++) {
            turn(normals[3 * f], normals[3 * f + 1], normals[3 * f + 2]);
            if (tz >= 0) continue;                  // facing away: hidden
            int light = -tz;                        // 1 .. 64: how directly it faces us
            char shade = 6 + light * 25 / 64;       // 6 .. 31
            draw_face(f, 32 * ramps[f] + shade);
        }
        used_top[hidden] = top;
        used_bottom[hidden] = bottom;
        out(SCREEN_PAGE, (int)page >> 8);           // show the finished picture
        hidden = 1 - hidden;
    }
}
