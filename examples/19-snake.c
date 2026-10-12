// SNAKE
//
// Steer the snake with the arrow keys and eat the red apples: every apple
// makes it longer, and every third one a little faster. Don't bite yourself
// or the wall. Run the program, then click the screen so that the keys go to
// the joystick; after a crash, any key starts a new game.
//
// The game uses every device: the joystick steers, vsync sets the pace,
// the random number device places the apples, the speaker beeps and the
// number display shows the score. The screen is the game board: get() reads
// back what is at a square, so the snake finds walls, itself and apples by
// looking. Its body is a ring buffer: the new head is written at one end and
// the tail is erased at the other.

#pragma cpu 8x
#pragma display 0x2000, 32, 24, indexed4, pico_8

#define SCREEN ((char*)0x2000)  // 32 x 24 squares, two per byte
#define W 32
#define H 24
#define WALL 5                  // pico-8 colors: dark gray,
#define BODY 11                 // green,
#define HEAD 10                 // yellow,
#define APPLE 8                 // red
#define ROOM 1024               // the most squares the snake can cover (a power of two)

char body_x[ROOM];
char body_y[ROOM];

void set(int x, int y, char color) {
    char *p = SCREEN + y * (W / 2) + x / 2;
    if (x & 1) *p = (*p & 0xF0) | color;
    else *p = (*p & 0x0F) | (color << 4);
}

char get(int x, int y) {
    char pair = SCREEN[y * (W / 2) + x / 2];
    return x & 1 ? pair & 0x0F : pair >> 4;
}

void place_apple() {
    int x, y;
    do {
        x = 1 + in(RANDOM) % (W - 2);
        y = 1 + in(RANDOM) % (H - 2);
    } while (get(x, y) != 0);
    set(x, y, APPLE);
}

void main() {
    for (;;) {
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
                set(x, y, x == 0 || y == 0 || x == W - 1 || y == H - 1 ? WALL : 0);

        int x = W / 2, y = H / 2;           // the head
        int dx = 1, dy = 0;                 // the direction of the last step
        int next_dx = 1, next_dy = 0;       // the direction of the next step
        int head = 0, tail = 0, grow = 3, score = 0;
        char delay = 8;                     // frames per step
        body_x[0] = x;
        body_y[0] = y;
        set(x, y, HEAD);
        place_apple();
        out(NUMBER, 0);

        char frames = 0;
        for (;;) {
            // Read the joystick in every frame, so that short taps count, but
            // never turn back into the snake's own neck.
            in(VSYNC);                      // wait for the next frame: 60 per second
            char keys = in(JOYSTICK);
            if (keys & JOY_LEFT && dx == 0) { next_dx = -1; next_dy = 0; }
            if (keys & JOY_RIGHT && dx == 0) { next_dx = 1; next_dy = 0; }
            if (keys & JOY_UP && dy == 0) { next_dx = 0; next_dy = -1; }
            if (keys & JOY_DOWN && dy == 0) { next_dx = 0; next_dy = 1; }
            if (++frames < delay) continue;
            frames = 0;

            dx = next_dx;
            dy = next_dy;
            set(x, y, BODY);                // the old head becomes body
            x += dx;
            y += dy;
            char ahead = get(x, y);
            if (ahead == WALL || ahead == BODY) break;
            set(x, y, HEAD);
            head = (head + 1) & (ROOM - 1);
            body_x[head] = x;
            body_y[head] = y;
            if (ahead == APPLE) {
                score++;
                grow += 2;
                if (score % 3 == 0 && delay > 2) delay--;
                out(NUMBER, score);
                out(SPEAKER, 72 + delay);
                place_apple();
            }
            if (grow) grow--;
            else {                          // the tail moves on
                set(body_x[tail], body_y[tail], 0);
                tail = (tail + 1) & (ROOM - 1);
            }
        }

        out(SPEAKER, 40);                   // crashed
        set(x - dx, y - dy, APPLE);
        while (in(JOYSTICK)) {}             // wait until the keys are released …
        while (!in(JOYSTICK)) {}            // … and for a new key
    }
}
