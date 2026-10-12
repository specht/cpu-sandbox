// LANDSCAPE
//
// A fractal landscape with mountains and lakes that mirror them, 256 x 192
// pixels in 16 colors. ↑ ↓ move, ← → turn, Space makes a new landscape.
// The number display shows which one. One picture takes about two and a
// half seconds at 64 MHz: watch it fade in.
//
// The landscape: the diamond-square algorithm builds a height map of
// 128 x 128 bytes from random numbers. It starts with one height, then
// fills in the middle of every square and every diamond, adding smaller
// and smaller random bumps: mountains, hills, stones. Everything below the
// water level is a lake.
//
// The picture: for every column of the screen, a ray marches over the map
// from near to far, in bigger steps the farther it gets. At every step the
// height under the ray (interpolated between four cells) is projected onto
// the screen; whatever rises above the part of the column drawn so far is
// drawn, like in the game Comanche (1992).
//
// The lake: a water pixel shows what a ray reflected at the water surface
// would hit. Each step remembers where its mirror image appears on the
// screen; the first step farther away whose mirror image reaches the pixel
// is what the water reflects, else the sky.
//
// The fade: the columns come in the order 0, 128, 64, 192, 32, 160, 96, …,
// each one halving a gap. Until the columns in its gap are computed, a
// column lends them its colors: more and more pixels of the gap, in the
// order of an 8 x 8 Bayer matrix. So the whole picture is there at once,
// coarse at first, and sharp pixels sprinkle in until it is complete.
//
// The colors: four ramps of four colors (water and sky, grass, rock, snow).
// The program computes 49 brightnesses per ramp, and ordered dithering
// with a 4 x 4 Bayer matrix mixes the two nearest colors of the ramp in a
// fine pattern, so 16 colors look like many more.

#pragma cpu 8x
#pragma display 0x8000, 256, 192, indexed4

#define W 256
#define H 192
#define SCREEN ((char*)0x8000)
#define HORIZON 64
#define STEPS 160               // 5 segments of 32 steps, each step twice as long as before
#define WATER 64                // the water level
#define ABOVE 12                // the camera above the ground (or the water)

char map[129 * 129];            // 128 x 128 heights, the first row and column repeated at the end
int row_start[129];             // y · 129: where row y of the map starts

char palette[48] = {
    18, 34, 80,     46, 88, 160,    110, 160, 220,  205, 228, 250,      // water and sky
    22, 48, 28,     46, 90, 42,     92, 138, 58,    150, 176, 86,       // grass
    62, 54, 52,     108, 94, 82,    150, 136, 120,  186, 176, 160,      // rock
    110, 122, 150,  170, 182, 204,  224, 230, 242,  255, 255, 255};     // snow

char bayer[16] = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5};
char fade[64] = {               // the order in which pixels fade in: an 8 x 8 Bayer matrix
    0, 32, 8, 40, 2, 34, 10, 42,    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,   60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,   63, 31, 55, 23, 61, 29, 53, 21};
char fade_limit[9] = {64, 16, 24, 32, 40, 48, 56, 64, 0};      // how many of the 64 pixels a round fills
char reversed[256];             // i with its 8 bits in reverse order
char quarter[65] = {            // sin of 0..64 (a quarter turn), 64 = 1.0
    0, 2, 3, 5, 6, 8, 9, 11, 12, 14, 16, 17, 19, 20, 22, 23, 24, 26, 27, 29, 30, 32,
    33, 34, 36, 37, 38, 39, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
    55, 56, 56, 57, 58, 59, 59, 60, 60, 61, 61, 62, 62, 62, 63, 63, 63, 64, 64, 64,
    64, 64, 64};
int sine[256];
int ripple[64];                 // small waves: −1 … 2 rows
char curve[256];                // for the height map: stretched and squared heights

// A tone is a color before dithering: ramp · 64 + brightness 0..48.
char sky[H];                    // the tone of the sky in every row
int step_size[5] = {16, 32, 64, 128, 256};      // in 1/256 cells
char near_part[STEPS], far_part[STEPS];         // 524288 / distance = 64 · near + far
int water_y[STEPS];             // the row of the water surface at each step

// One column, front to back:
int mirror_y[STEPS];            // where each step's mirror image reaches down to
char next_higher[STEPS];        // the next step whose mirror image reaches farther down
int lowest_beyond[STEPS];       // the lowest row any mirror image from this step on reaches
char step_tone[STEPS];
char row_tone[H];
char row_step[H];               // for water rows: the step of the water, else 255

unsigned int cam_x, cam_y;      // the camera, in 1/256 cells
int cam_h;                      // its height · 16
char angle;
int dir_x, dir_y;               // the view direction, 64 = 1.0

// ---------------------------------------------------------------- the landscape

int at(char x, char y) { return row_start[y & 127] + (x & 127); }

int bump(int amplitude) { return ((int)in(RANDOM) - 128) * amplitude >> 7; }

void put(char x, char y, int h) { map[at(x, y)] = h < 0 ? 0 : h > 255 ? 255 : h; }

void generate() {
    map[0] = 128;
    int amplitude = 120;
    for (char side = 128; side >= 2; side = side >> 1) {
        char half = side >> 1;
        // The middle of every square: the average of its corners and a bump.
        for (int y = 0; y < 128; y += side)
            for (int x = 0; x < 128; x += side) {
                int sum = (int)map[at(x, y)] + map[at(x + side, y)] + map[at(x, y + side)] + map[at(x + side, y + side)];
                put(x + half, y + half, (sum >> 2) + bump(amplitude));
            }
        // The middle of every diamond: the average of its four neighbours.
        for (int y = 0; y < 128; y += half)
            for (int x = (y & half) ? 0 : half; x < 128; x += side) {
                int sum = (int)map[at(x - half, y)] + map[at(x + half, y)] + map[at(x, y - half)] + map[at(x, y + half)];
                put(x, y, (sum >> 2) + bump(amplitude));
            }
        amplitude = amplitude * 9 >> 4;
    }
    // Stretch the heights to 0 … 255 and square them: flat valleys, steep peaks.
    char low = 255, high = 0;
    for (int i = 0; i < 128 * 129; i++) {
        if (map[i] < low) low = map[i];
        if (map[i] > high) high = map[i];
    }
    for (int v = low; v <= high; v++) {
        unsigned int n = (unsigned int)(v - low) * 255 / (high - low);
        curve[v] = n * n >> 8;
    }
    for (int i = 0; i < 128 * 129; i++) map[i] = curve[map[i]];
    // Repeat the first column and row at the end, so that x + 1 and y + 1 never wrap.
    for (char y = 0; y < 128; y++) map[row_start[y] + 128] = map[row_start[y]];
    for (char x = 0; x <= 128; x++) map[128 * 129 + x] = map[x];
}

// The camera goes onto a lake, looking across the water at the highest
// mountains: it tries every 8th cell in 16 directions.
void place_camera() {
    char best = 0;
    for (char y = 4; y < 128; y += 8)
        for (char x = 4; x < 128; x += 8) {
            if (map[at(x, y)] >= WATER) continue;
            for (int a = 0; a < 256; a += 16) {
                int dx = sine[(a + 64) & 255], dy = sine[a];
                char highest = 0, d = 2;
                for (; d < 10; d += 2) if (map[at(x + (dx * d >> 6), y + (dy * d >> 6))] >= WATER) break;
                if (d < 10) continue;                   // land right in front: no view
                for (; d < 34; d += 4) {
                    char h = map[at(x + (dx * d >> 6), y + (dy * d >> 6))];
                    if (h > highest) highest = h;
                }
                if (highest > best) {
                    best = highest;
                    cam_x = (unsigned int)x << 8 | 128;
                    cam_y = (unsigned int)y << 8 | 128;
                    angle = a;
                }
            }
        }
}

// ---------------------------------------------------------------- tables

void make_tables() {
    for (int i = 0; i < 256; i++) {
        char r = 0;
        for (char bit = 0; bit < 8; bit++) if (i & (1 << bit)) r = r | (128 >> bit);
        reversed[i] = r;
    }
    for (int y = 1; y < 129; y++) row_start[y] = row_start[y - 1] + 129;
    for (int i = 0; i <= 64; i++) {
        sine[i] = quarter[i]; sine[128 - i] = quarter[i];
        sine[128 + i] = -(int)quarter[i]; sine[(256 - i) & 255] = -(int)quarter[i];
    }
    for (char i = 0; i < 64; i++) ripple[i] = (sine[i * 4] + 32) >> 5;    // -1 … 2
    for (char y = 0; y < H; y++) sky[y] = y < HORIZON ? 26 + (y >> 2) + (y >> 3) : 48;
    // 524288 / distance in two parts, so that projecting needs no overflow.
    unsigned int d = 256;
    char i = 0;
    for (char s = 0; s < 5; s++)
        for (char k = 0; k < 32; k++) {
            unsigned int f = 65535 / (d >> 3);       // 524288 / d
            near_part[i] = f >> 6;
            far_part[i] = f & 63;
            d += step_size[s];
            i++;
        }
    out(PALETTE, 0);
    for (char c = 0; c < 48; c++) out(COLOR, palette[c]);
}

// How far below the horizon (negative: above) a height difference appears at step i.
int project(int dh, char i) {
    unsigned int a = (dh < 0 ? -dh : dh) >> 3;
    int p = ((a * near_part[i]) >> 3) + ((a * far_part[i]) >> 9);
    return dh < 0 ? -p : p;
}

// ---------------------------------------------------------------- drawing

// Column x of the picture. Until its neighbours up to x + width − 1 are
// computed, it also lends them its colors: the pixels whose number in the
// fade pattern is below the limit.
void column(int x, int width, char limit) {
    int dx = dir_x - (dir_y * (2 * x - 255) >> 8);      // the plane is the direction turned right
    int dy = dir_y + (dir_x * (2 * x - 255) >> 8);
    int top = H;                                        // rows top … H − 1 are drawn
    char *b = bayer + (x & 3);                          // the column of the dithering pattern
    unsigned int d = 256;
    char i = 0;
    for (char s = 0; s < 5; s++) {
        int size = step_size[s];
        unsigned int rx = cam_x + dx * (int)(d >> 6), ry = cam_y + dy * (int)(d >> 6);
        int sx = (dx * size + 32) >> 6, sy = (dy * size + 32) >> 6;
        for (char k = 0; k < 32; k++) {
            char fx = (char)rx >> 4, fy = (char)ry >> 4;      // 1/16 cells inside the cell
            char *m = map + row_start[(ry >> 8) & 127] + ((rx >> 8) & 127);
            char h00 = m[0], h10 = m[1], h01 = m[129], h11 = m[130];
            // The height between the four cells, · 16: each cell is two flat
            // triangles. gx and gy: how steeply the triangle rises along x and y.
            int gx, gy;
            if (fx >= fy) { gx = (int)h10 - h00; gy = (int)h11 - h10; }
            else { gx = (int)h11 - h01; gy = (int)h01 - h00; }
            int h = ((int)h00 << 4) + gx * fx + gy * fy;
            char tone, water = 0;
            if (h < WATER * 16) { h = WATER * 16; tone = 20; water = 1; }
            else {
                int light = 22 - gx - (gx >> 1) - (gy >> 1) + (i >> 3);     // the sun shines from −x and a little −y
                light = light < 0 ? 0 : light > 48 ? 48 : light;
                int steep = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
                char ramp = h > 205 * 16 ? 3 : h > 170 * 16 || steep > 16 ? 2 : 1;       // snow, rock, grass
                tone = (ramp << 6) + light;
            }
            int y = HORIZON + project(cam_h - h, i);
            step_tone[i] = tone;
            mirror_y[i] = water ? -1 : water_y[i] + water_y[i] - y;      // the water itself mirrors nothing
            if (y < top) {
                if (y < 0) y = 0;
                if (i < 96) for (int r = y; r < top; r++) { row_tone[r] = tone; row_step[r] = water ? i : 255; }
                else {
                    // Far away: haze, more and more pixels in the color of the sky at the horizon.
                    char haze = (i - 96) >> 2;
                    for (int r = y; r < top; r++) {
                        row_tone[r] = haze > b[(r & 3) << 2] ? 40 : tone;
                        row_step[r] = water ? i : 255;
                    }
                }
                top = y;
            }
            rx += sx; ry += sy;
            i++;
        }
        d += size << 5;
    }
    for (int r = 0; r < top; r++) { row_tone[r] = sky[r]; row_step[r] = 255; }

    // The lake. For every step: the next one farther away whose mirror image
    // reaches lower, and how low any mirror image beyond it reaches.
    next_higher[STEPS - 1] = STEPS;
    lowest_beyond[STEPS - 1] = mirror_y[STEPS - 1];
    for (int k = STEPS - 2; k >= 0; k--) {
        char j = k + 1;
        while (j < STEPS && mirror_y[j] <= mirror_y[k]) j = next_higher[j];
        next_higher[k] = j;
        lowest_beyond[k] = mirror_y[k] > lowest_beyond[k + 1] ? mirror_y[k] : lowest_beyond[k + 1];
    }
    char wave_x = x >> 4;
    for (char r = top; r < H; r++) {
        if (row_step[r] == 255) continue;
        char below = r - HORIZON;               // water is always below the horizon
        // The first step beyond the water whose mirror image reaches this row; with
        // a little ripple. Mountains of mirror images that are too short are skipped.
        int wave = ripple[(r + r + r + wave_x) & 63];
        int want = r + wave;
        if (below >= 32) want += wave;          // bigger waves nearby
        if (below >= 64) want += wave + wave;
        char j = row_step[r] + 1, t;
        if (j < STEPS && lowest_beyond[j] >= want) {
            while (mirror_y[j] < want) j = next_higher[j];
            t = step_tone[j];
        } else {
            // The sky: the farther below the horizon, the higher up the sky that
            // is mirrored, the deeper its blue.
            int light = 46 - ((want - HORIZON) >> 2);
            t = light < 12 ? 12 : light;
        }
        // Water is darker than what it mirrors (the land much darker than the
        // sky), and waves make stripes. Some pixels take the blue of the water
        // instead: more of them, the steeper we look down.
        char light = t & 63;
        light = t < 64 ? light - (light >> 3) : (light >> 1) + (light >> 3);    // 7/8 or 5/8
        int striped = light + ripple[((r << 2) + r + (wave_x << 1)) & 63] - 1;
        light = striped < 0 ? 0 : striped;
        t = 4 + (below >> 4) > b[(r & 3) << 2] ? light : (t & 0xC0) + light;
        row_tone[r] = t;
    }

    // Dither the tones into 16 colors and write them into the screen, two
    // pixels per byte. An odd column is the last one of its round: it only
    // sets its own pixels. An even column also fills the gap to its right
    // with its own colors, byte by byte, where the fade pattern says so.
    char *q = SCREEN + (x >> 1), column_byte = x >> 1;
    for (char r = 0; r < H; r++) {
        char t = row_tone[r], light = t & 63;
        char base = ((t >> 4) & 12) + (light >> 4), fraction = light & 15;
        char *dither = bayer + ((r & 3) << 2);
        if (x & 1) *q = (*q & 0xF0) | (base + (fraction > dither[x & 3]));
        else {
            // The two pixels of a byte at x ≡ 0 and at x ≡ 2 (mod 4).
            char pair0 = ((base + (fraction > dither[0])) << 4) | (base + (fraction > dither[1]));
            char pair2 = ((base + (fraction > dither[2])) << 4) | (base + (fraction > dither[3]));
            char pair = x & 2 ? pair2 : pair0, other = x & 2 ? pair0 : pair2;
            char *fill = fade + ((r & 7) << 3);
            q[0] = fill[column_byte & 7] < limit ? pair : (q[0] & 0x0F) | (pair & 0xF0);
            for (char k = 1; k < width >> 1; k++) {
                if (fill[(column_byte + k) & 7] < limit) q[k] = k & 1 ? other : pair;
            }
        }
        q += 128;
    }
}

void picture() {
    dir_x = sine[(angle + 64) & 255];
    dir_y = sine[angle];
    char *m = map + at(cam_x >> 8, cam_y >> 8);
    int ground = m[0] > WATER ? m[0] : WATER;
    cam_h = (ground + ABOVE) << 4;
    for (char i = 0; i < STEPS; i++) water_y[i] = HORIZON + project(cam_h - WATER * 16, i);
    // The columns in the order 0, 128, 64, 192, 32, 160, …: each new one halves a
    // gap, so the whole picture is there early and gets sharper and sharper.
    int width = 256;
    char round = 0;
    for (int i = 0; i < W; i++) {
        if (i && !(i & (i - 1))) { width = width >> 1; round++; }     // i is a power of two: a new round
        column(reversed[i], width, fade_limit[round]);
    }
}

void main() {
    make_tables();
    char number = 1;
    for (;;) {
        out(NUMBER, number);
        generate();
        place_camera();
        char again = 1;
        while (again) {
            picture();
            char keys = 0;
            while (!keys) { in(VSYNC); keys = in(JOYSTICK); }
            if (keys & JOY_LEFT) angle -= 16;
            if (keys & JOY_RIGHT) angle += 16;
            if (keys & (JOY_UP | JOY_DOWN)) {
                int step = keys & JOY_UP ? 8 : -8;          // two cells: 64 · 8 = 512
                cam_x += dir_x * step;
                cam_y += dir_y * step;
            }
            if (keys & JOY_FIRE) { number++; again = 0; }
            while (in(JOYSTICK)) in(VSYNC);                 // wait until the key is released
        }
    }
}
