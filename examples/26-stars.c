// STARFIELD
//
// Flying through space: 160 stars come closer every frame. A star at
// distance z appears at 64 + 32·x/z, so it starts near the middle and moves
// outwards faster and faster as z gets small - that is all there is to
// perspective. Closer stars are brighter: colors 0..31 of the palette
// ramps_256 are 32 shades of gray, and the closest stars are two pixels wide.
// When a star passes by, it starts again far away.
//
// The joystick sets the speed (↑ faster, ↓ slower), the number display shows
// it, and the timer paces the frames at 60 per second. Each star erases the
// pixel it drew last time, so there is no need to clear the screen.
// Note the (int) casts: in(RANDOM) - 128 would stay a char and wrap.
// Try 16 MHz.

#pragma cpu 8x
#pragma display 0x4000, 128, 96, indexed8, ramps_256

#define W 128
#define H 96
#define STARS 160
#define SCREEN ((char*)0x4000)

int star_x[STARS];
int star_y[STARS];
int star_z[STARS];
char *drawn[STARS];             // where each star was drawn last (0: nowhere)
char wide[STARS];               // 1 if it was drawn two pixels wide

void new_star(char i, int z) {
    star_x[i] = ((int)in(RANDOM) - 128) * 4;
    star_y[i] = ((int)in(RANDOM) - 128) * 3;
    star_z[i] = z;
}

void main() {
    char speed = 2;
    for (char i = 0; i < STARS; i++) new_star(i, 1 + in(RANDOM));
    char last = in(TIMER);
    for (;;) {
        while (in(TIMER) == last) {}        // wait for the next tick
        last = in(TIMER);
        if ((last & 7) == 0) {              // a held key changes the speed 7 times a second
            char keys = in(JOYSTICK);
            if (keys & JOY_UP && speed < 12) speed++;
            if (keys & JOY_DOWN && speed > 0) speed--;
        }
        out(NUMBER, speed);

        for (char i = 0; i < STARS; i++) {
            char *old = drawn[i];
            if (old) {                      // erase the old dot
                *old = 0;
                if (wide[i]) old[1] = 0;
            }
            drawn[i] = 0;
            int z = star_z[i] - speed;
            if (z < 8) { new_star(i, 255); z = 255; }
            star_z[i] = z;
            int x = W / 2 + star_x[i] * 32 / z;
            int y = H / 2 + star_y[i] * 32 / z;
            if (x < 0 || x >= W - 1 || y < 0 || y >= H) { new_star(i, 255); continue; }
            char *p = SCREEN + y * W + x;
            char gray = 31 - z / 12;        // 10 (far away) .. 31 (white)
            *p = gray;
            wide[i] = z < 48;
            if (wide[i]) p[1] = gray;
            drawn[i] = p;
        }
    }
}
