// ARPEGGIO ORGAN
//
// Click the screen and press a letter key: the organ plays its chord as an
// arpeggio, one note after the other, until you press the next key. The new
// chord starts with the next arpeggio, so you can press it early and stay in
// time. Three rows of keys are three octaves of chords: Q, A and Y (Z on an
// English keyboard) are C, and to the right follow D E F G A H, then C D E …
// one octave higher. Chords are major; hold Shift for minor. Space stops.
// ↑ and ↓ change the tempo, which the number display shows in beats per
// minute (an arpeggio is 8 sixteenth notes, half a bar).
//
// Try "New Born" by Muse: Em H Em H Em C G H (Shift+E, U, Shift+E, U,
// Shift+E, Q, T, U in the top row), one key per arpeggio.
//
// The keys-held device (port 0x05) reports where a key sits on the keyboard,
// not which letter it types, so the layout is the same everywhere. The
// speaker plays every note at the machine time of its OUT, and in(VSYNC)
// paces the program: notes fall on the 60 frames per second, like on old
// consoles. At 100, 150 or 180 BPM a sixteenth note is a whole number of
// frames, so every note is exactly on time.

#pragma cpu 8x
#pragma display 0x4000, 160, 64, indexed8

#define W 160
#define SCREEN ((char*)0x4000)
#define LOWEST 36               // the lowest note: C2 (MIDI note numbers, 60 = middle C)
#define NOTES 60                // five octaves on the piano

// Our own colors, set in the palette chip.
#define BACK 0
#define WHITE_KEY 1
#define BLACK_KEY 2
#define CHORD_WHITE 3           // chord notes on the piano
#define CHORD_BLACK 4
#define PLAYING 5               // the note sounding right now
#define BOX 6
#define LETTER 7
#define MAJOR 8
#define MINOR 9
#define NEXT 10                 // the chord that comes next

char colors[33] = {
    12, 16, 26,     235, 232, 222,  30, 32, 40,     150, 210, 255,  40, 110, 170,
    255, 200, 60,   44, 54, 74,     200, 210, 230,  60, 190, 110,   90, 130, 255,
    230, 170, 60};

char scale[7] = {0, 2, 4, 5, 7, 9, 11};         // C D E F G A H: the white keys
char white_index[12] = {0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6};
char is_black[12] = {0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0};
char pattern[8] = {0, 7, 12, 16, 19, 16, 12, 7}; // root, fifth, octave, tenth (minor: 15), …
char key_color[NOTES];

// The letters C D E F G A H, 3 x 5 pixels, one row per byte.
char font[35] = {
    3, 4, 4, 4, 3,   6, 5, 5, 5, 6,   7, 4, 6, 4, 7,   7, 4, 6, 4, 4,
    3, 4, 5, 5, 3,   2, 5, 7, 5, 5,   5, 5, 7, 5, 5};

void rect(int x, int y, int w, int h, char color) {
    char *row = SCREEN + y * W + x;
    for (int j = 0; j < h; j++) {
        for (int i = 0; i < w; i++) row[i] = color;
        row += W;
    }
}

void letter(int x, int y, char n, char color) {
    char *p = SCREEN + y * W + x;
    for (char j = 0; j < 5; j++) {
        char bits = font[5 * n + j];
        if (bits & 4) p[0] = color;
        if (bits & 2) p[1] = color;
        if (bits & 1) p[2] = color;
        p += W;
    }
}

// Piano key n (0 = LOWEST). White keys are 3 pixels wide with a gap, black
// keys sit on top of the gap, so a white key redraws its black neighbours.
void piano_key(char n, char color) {
    if (n >= NOTES) return;
    key_color[n] = color;
    char k = n % 12;
    int x = 10 + 4 * (7 * (n / 12) + white_index[k]);
    if (is_black[k]) { rect(x + 2, 2, 3, 13, color); return; }
    rect(x, 2, 3, 22, color);
    if (n > 0 && is_black[(n - 1) % 12]) piano_key(n - 1, key_color[n - 1]);
    if (n + 1 < NOTES && is_black[(n + 1) % 12]) piano_key(n + 1, key_color[n + 1]);
}

// A key position from port 0x05: row × 16 + column, rows 2 (Q) to 4 (Y).
int box_x(char key) { return 4 + 3 * ((key >> 4) - 2) + 12 * (key & 15); }
int box_y(char key) { return 30 + 11 * ((key >> 4) - 2); }

void box(char key, char color) {
    key = key & 127;
    rect(box_x(key), box_y(key), 11, 10, color);
    letter(box_x(key) + 4, box_y(key) + 2, (key & 15) % 7, color == BOX ? LETTER : BACK);
}

// The root note of the chord on a key, or 0 for keys without a chord.
char root_of(char key) {
    char row = (key >> 4) & 7, column = key & 15;
    if (row < 2 || row > 4 || column > 11) return 0;
    return LOWEST + 12 * (4 - row) + 12 * (column / 7) + scale[column % 7];
}

char note_of(char key, char step) {
    char offset = pattern[step];
    if (offset == 16 && (key & KEY_SHIFT)) offset = 15;    // minor: the third is a semitone lower
    return root_of(key) + offset;
}

// Lights or clears the notes of a chord on the piano.
void show_chord(char key, char on) {
    for (char step = 0; step < 5; step++) {
        char n = note_of(key, step) - LOWEST;
        if (n < NOTES) piano_key(n, on ? (is_black[n % 12] ? CHORD_BLACK : CHORD_WHITE) : (is_black[n % 12] ? BLACK_KEY : WHITE_KEY));
    }
}

void main() {
    out(PALETTE, 0);
    for (char i = 0; i < 33; i++) out(COLOR, colors[i]);
    for (char n = 0; n < NOTES; n++) piano_key(n, is_black[n % 12] ? BLACK_KEY : WHITE_KEY);
    for (char row = 2; row <= 4; row++)
        for (char column = 0; column < (row == 4 ? 10 : 12); column++) box(16 * row + column, BOX);

    char bpm = 100;
    char chord = 0, next = 0;   // key positions with the Shift bit
    char step = 0;              // 0..7 in the arpeggio
    char playing = 0;           // the piano key that is lit
    int time = 0;               // sixteenths: + 4 · bpm per frame, a sixteenth at 3600
    out(NUMBER, bpm);
    out(NOTE_LENGTH, 900 / bpm + 3);

    char last = in(VSYNC);
    for (;;) {
        char now = in(VSYNC);   // 60 times per second: the timer value
        char passed = now - last;       // 1, or more if drawing took longer than a frame
        last = now;
        char key = in(KEYS);
        if (root_of(key) && key != next) {
            if (next) box(next, BOX);
            next = key == chord ? 0 : key;
            if (next) box(next, NEXT);
        }
        char stick = in(JOYSTICK);
        if (!key && (now & 3) == 0) {           // ↑ ↓ (W and S are chord keys, so only when no chord key is held)
            char old = bpm;
            if (stick & JOY_UP && bpm < 240) bpm++;
            if (stick & JOY_DOWN && bpm > 40) bpm--;
            if (bpm != old) { out(NUMBER, bpm); out(NOTE_LENGTH, 900 / bpm + 3); }
        }
        if (stick & JOY_FIRE && chord) {        // Space: silence
            show_chord(chord, 0);
            box(chord, BOX);
            chord = 0;
            playing = 0;
        }
        if (!chord && next) { step = 0; time = 3600; }  // start at once when silent
        else time += (int)passed * 4 * bpm;
        if (time < 3600) continue;
        time -= 3600;

        // The note first, so that drawing never delays it …
        char before = chord;
        if (step == 0 && next) { chord = next; next = 0; }      // a new chord starts with an arpeggio
        char note = 0;
        if (chord) { note = note_of(chord, step); out(SPEAKER, note); }

        // … then the picture.
        if (playing) { piano_key(playing - 1, is_black[(playing - 1) % 12] ? CHORD_BLACK : CHORD_WHITE); playing = 0; }
        if (chord != before) {
            if (before) { show_chord(before, 0); box(before, BOX); }
            box(chord, chord & KEY_SHIFT ? MINOR : MAJOR);
            show_chord(chord, 1);
        }
        if (note && note - LOWEST < NOTES) { playing = note - LOWEST + 1; piano_key(note - LOWEST, PLAYING); }
        step = (step + 1) & 7;
    }
}
