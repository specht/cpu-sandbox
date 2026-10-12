// RAYCASTER
//
// Walk through a maze in 3D, like in Wolfenstein 3D (1992): ↑ ↓ walk, ← →
// turn, Space shows the map. Find the golden door. The number display shows
// how many pictures per second the CPU manages: try 16 and 64 MHz.
//
// For every column of the screen, a ray leaves the player and marches
// through the map in steps of 1/8 cell until it is inside a wall; five
// bisections between the last point outside and the first point inside then
// find the wall's surface to 1/256 of a cell. The
// farther the wall, the shorter its column: height = 64 / distance, the
// only division per column. Where the ray hit the wall picks the column of
// the 16 x 16 texture.
//
// The floor and ceiling of one screen row are all at the same distance, so
// one row needs a few multiplications, and each pixel only two additions
// and a texture lookup. No floating point anywhere: positions count in
// 1/256 cells, directions come from a sine table in which 64 means 1.0.
//
// Colors: the program writes a palette of 16 texture colors in 16
// brightnesses into the palette chip; color = 16 * shade + texture color,
// and far things get a darker shade. Two screen pages and in(VSYNC) make
// every picture appear complete.

#pragma cpu 8x
#pragma display 0x8000, 80, 50, indexed8

#define W 80
#define H 50
#define CELL 256                // positions in 1/256 cell
#define TURN 1                  // per 1/60 s; 256 = a full turn

char map[256] = {               // 16 x 16 cells: 0 floor, 1 brick, 2 stone, 3 wood, 4 the golden door
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,0,0,0,1,0,0,0,0,0,0,2,0,0,0,1,
    1,0,0,0,1,0,2,2,2,2,0,2,0,3,0,1,
    1,0,0,0,0,0,2,0,0,2,0,0,0,3,0,1,
    1,1,0,1,1,0,2,0,0,2,2,2,0,3,0,1,
    1,0,0,0,1,0,0,0,0,0,0,2,0,3,0,1,
    1,0,3,0,1,1,1,0,1,1,0,2,0,3,0,1,
    1,0,3,0,0,0,1,0,1,0,0,0,0,3,0,1,
    1,0,3,3,3,0,1,0,1,0,3,3,3,3,0,1,
    1,0,0,0,3,0,0,0,1,0,0,0,0,0,0,1,
    1,2,2,0,3,1,1,1,1,1,1,0,2,2,2,1,
    1,0,0,0,0,0,0,0,0,0,1,0,2,0,0,1,
    1,0,2,2,2,2,2,0,3,0,1,0,2,0,0,1,
    1,0,2,0,0,0,0,0,3,0,0,0,0,0,0,4,
    1,0,0,0,2,0,0,0,3,0,1,0,2,0,0,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1};

char quarter[65] = {            // sin of 0..64 (a quarter turn), 64 = 1.0
    0, 2, 3, 5, 6, 8, 9, 11, 12, 14, 16, 17, 19, 20, 22, 23, 24, 26, 27, 29, 30, 32,
    33, 34, 36, 37, 38, 39, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
    55, 56, 56, 57, 58, 59, 59, 60, 60, 61, 61, 62, 62, 62, 63, 63, 63, 64, 64, 64,
    64, 64, 64};
int sine[256];

char base[48] = {               // the 16 texture colors at full brightness
    0, 0, 0,        120, 40, 30,    170, 70, 50,    150, 140, 130,
    70, 72, 80,     110, 112, 120,  150, 152, 160,  70, 110, 60,
    90, 60, 35,     130, 90, 50,    170, 125, 75,   70, 85, 110,
    110, 125, 150,  45, 40, 50,     80, 70, 85,     250, 200, 60};
char textures[1536];            // six textures of 16 x 16: brick, stone, wood, door, floor, ceiling
char *pages[2] = {(char*)0x8000, (char*)0x9000};
char *page;

int row_start[H];               // y · W
int row_distance[H];            // floor distance of the rows below the horizon, in 1/256 cells
int ray_x, ray_y;               // the direction of the next column's ray, · 256
int ray_dx, ray_dy;             // … and how it changes from column to column
unsigned int px = CELL + 128, py = 3 * CELL + 128;  // the player (unsigned: never negative)
char angle = 0;                 // looking east
int dir_x, dir_y, plane_x, plane_y;     // view direction and the screen plane, 64 = 1.0

char random(char n) { return in(RANDOM) % n; }

// ---------------------------------------------------------------- setup

void make_textures() {
    for (int y = 0; y < 16; y++)
        for (int x = 0; x < 16; x++) {
            int i = 16 * y + x;
            char shift = (y >> 2) & 1 ? 4 : 0;          // bricks: every other row shifted
            textures[i] = (y & 3) == 3 || ((x + shift) & 7) == 7 ? 3 : 1 + random(2);
            textures[256 + i] = (x & 7) == 0 || (y & 7) == 0 ? 4 : 5 + random(2);
            textures[512 + i] = (x & 3) == 3 ? 8 : 9 + ((x + y + random(3)) & 1);
            textures[768 + i] = x == 0 || x == 15 || y == 0 || y == 15 || (x == 11 && (y & 4)) ? 9 : 15;
            textures[1024 + i] = x == 0 || y == 0 ? 13 : ((x >> 3) ^ (y >> 3)) & 1 ? 11 : 12;
            textures[1280 + i] = (y & 3) == 0 ? 13 : 14;
        }
}

void make_palette() {
    out(PALETTE, 0);
    for (char shade = 0; shade < 16; shade++)
        for (char c = 0; c < 48; c++)
            out(COLOR, (int)base[c] * (16 - shade) >> 4);
}

void make_tables() {
    for (int i = 0; i <= 64; i++) {
        sine[i] = quarter[i]; sine[128 - i] = quarter[i];
        sine[128 + i] = -(int)quarter[i];      // (int): -quarter[i] would be a char, 0..255
        sine[(256 - i) & 255] = -(int)quarter[i];
    }
    for (int y = 0; y < H; y++) row_start[y] = y * W;
    for (int y = H / 2 + 1; y < H; y++) row_distance[y] = 16384 / (2 * y - H + 1);
}

// ---------------------------------------------------------------- drawing

// What is at (x, y): the cell is the high byte of each coordinate.
#define wall(x, y) map[(((y) >> 8) << 4) + ((x) >> 8)]

// a · b / 64 without overflow, for 0 ≤ a < 16384 and −128 < b < 128.
int scale(int a, int b) { return (a >> 6) * b + (((a & 63) * b) >> 6); }

// Floor and ceiling: row y below the horizon and its mirror image above it.
void floor_and_ceiling() {
    for (int y = H / 2 + 1; y < H; y++) {
        int d = row_distance[y];
        char shade = d > 1920 ? 15 : (d * 2) >> 8;     // d / 128: two shades darker per cell
        // Texture coordinates in 1/4096 cell; only the position inside a cell
        // matters, so they may wrap around.
        unsigned int u = (px + scale(d, dir_x - plane_x)) << 4;
        unsigned int v = (py + scale(d, dir_y - plane_y)) << 4;
        int du = scale(d, plane_x) * 2 / 5, dv = scale(d, plane_y) * 2 / 5;   // · 2 · 16 / 80
        char *f = page + row_start[y], *c = page + row_start[H - 1 - y];
        char tint = 16 * shade;
        for (char x = 0; x < W; x++) {
            char t = ((v >> 8) & 15) * 16 + ((u >> 8) & 15);
            f[x] = textures[1024 + t] + tint;
            c[x] = textures[1280 + t] + tint;
            u += du;
            v += dv;
        }
    }
    char *mid = page + row_start[H / 2];        // the horizon: too far to see
    for (char x = 0; x < W; x++) mid[x] = 16 * 15;
}

// Casts the ray of column x and draws its piece of wall.
void column(char x) {
    int sx = ray_x >> 9, sy = ray_y >> 9;       // 1/8 cell along the view direction
    unsigned int rx = px, ry = py;              // inside the wall at the end
    int t = 0;                                  // distance in 1/256 cells
    while (!wall(rx, ry)) { rx += sx; ry += sy; t += 32; }
    // The surface lies between (ox, oy), outside, and (rx, ry), inside: five
    // times, test the point halfway and keep the half with the surface in it.
    unsigned int ox = rx - sx, oy = ry - sy;
    int to = t - 32;
    for (char i = 0; i < 5; i++) {
        unsigned int mx = (ox + rx) >> 1, my = (oy + ry) >> 1;
        int tm = (to + t) >> 1;
        if (wall(mx, my)) { rx = mx; ry = my; t = tm; }
        else { ox = mx; oy = my; to = tm; }
    }
    char kind = wall(rx, ry);
    // Which side was hit: the two points lie in different columns of cells
    // (a vertical wall) or rows (a horizontal one). At a corner, both: then
    // the cell beside the outside point tells.
    char side_x = (ox >> 8) != (rx >> 8) && ((oy >> 8) == (ry >> 8) || wall(rx, oy));
    char u = (char)(side_x ? ry : rx) >> 4;     // where in the cell: the texture column
    if (t < 16) t = 16;
    int h = 16384 / t;                          // 64 pixels at a distance of one cell
    char shade = t > 1920 ? 15 : (t * 2) >> 8;
    if (side_x && shade < 14) shade += 2;
    int top = H / 2 - h / 2;
    unsigned int v = 0, dv = t >> 2;            // texture rows · 256 per pixel: 16 · 256 / h
    if (top < 0) { v = -top * dv; top = 0; }
    int bottom = H / 2 + h / 2;
    if (bottom > H) bottom = H;
    char *tex = textures + 256 * (kind - 1) + u;
    char tint = 16 * shade;
    char *p = page + row_start[top] + x;
    for (int y = top; y < bottom; y++) {
        *p = tex[(v >> 8) * 16] + tint;
        p += W;
        v += dv;
    }
}

void minimap() {
    char *p = page + W + 1;
    for (char y = 0; y < 16; y++) {
        for (char x = 0; x < 16; x++) p[x] = map[16 * y + x] ? 16 * 2 + 6 : 0;
        p += W;
    }
    page[(1 + (py >> 8)) * W + 1 + (px >> 8)] = 15;
}

// ---------------------------------------------------------------- moving

void turn() {
    dir_x = sine[(angle + 64) & 255];
    dir_y = sine[angle];
    plane_x = -dir_y * 2 / 3;                   // 0.66: a field of view of 66°
    plane_y = dir_x * 2 / 3;
}

// Moves step · 4/256 cell along the view direction (backwards if negative).
void walk(int step) {
    unsigned int nx = px + dir_x * step / 16, ny = py + dir_y * step / 16;
    int margin_x = dir_x * step > 0 ? 96 : -96, margin_y = dir_y * step > 0 ? 96 : -96;   // keep 3/8 cell away
    if (!wall(nx + margin_x, py)) px = nx;      // slide along walls
    if (!wall(px, ny + margin_y)) py = ny;
}

char fanfare_notes[4] = {72, 76, 79, 84};

void fanfare() {
    out(NOTE_LENGTH, 10);
    for (char i = 0; i < 4; i++) {
        out(SPEAKER, fanfare_notes[i]);
        for (char f = 0; f < 9; f++) in(VSYNC);
    }
    px = CELL + 128; py = 3 * CELL + 128; angle = 0;
}

void main() {
    make_tables();
    make_textures();
    make_palette();
    turn();
    char hidden = 1, pictures = 0, second = in(TIMER), map_shown = 0, was_fire = 0;
    char last = in(TIMER);
    for (;;) {
        page = pages[hidden];
        floor_and_ceiling();
        ray_x = (dir_x - plane_x) << 8;         // the leftmost ray …
        ray_y = (dir_y - plane_y) << 8;
        ray_dx = plane_x * 512 / W;             // … turns a little for every column
        ray_dy = plane_y * 512 / W;
        for (char x = 0; x < W; x++) { column(x); ray_x += ray_dx; ray_y += ray_dy; }
        if (map_shown) minimap();
        in(VSYNC);
        out(SCREEN_PAGE, (int)page >> 8);
        hidden = 1 - hidden;

        pictures++;
        if ((char)(in(TIMER) - second) >= 60) { out(NUMBER, pictures); pictures = 0; second += 60; }

        // The timer says how many 1/60 s have passed since the last picture:
        // moving that far keeps the speed the same at any clock and any
        // number of pictures per second (about 2 cells and a quarter turn
        // per second). At most 0.4 s at once, so nobody jumps through a wall.
        char now = in(TIMER), passed = now - last;
        last = now;
        if (passed > 24) passed = 24;
        char keys = in(JOYSTICK);
        if (keys & JOY_LEFT) { angle -= TURN * passed; turn(); }
        if (keys & JOY_RIGHT) { angle += TURN * passed; turn(); }
        if (keys & JOY_UP) walk(2 * passed);
        if (keys & JOY_DOWN) walk(-(int)passed);
        if (keys & JOY_FIRE && !was_fire) map_shown = !map_shown;
        was_fire = keys & JOY_FIRE;
        if (wall(px + dir_x * 2, py + dir_y * 2) == 4) { fanfare(); turn(); }
    }
}
