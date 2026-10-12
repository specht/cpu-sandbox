// ARPEGGIO ORGAN
//
// Click the screen and press a letter key: the organ plays its chord as an
// arpeggio, one note after the other, until you press the next key. The
// first key starts the beat. Every later key changes the chord at once,
// but the beat goes on: an arpeggio is half a bar of 8 sixteenths, and its
// first note always falls on the first beat, so the organ can play along
// with a band. Space stops, and the next key starts a new beat.
//
// Three rows of keys are three octaves of chords: Q, A and Y (Z on an
// English keyboard) are C, and every key to the right is a semitone higher,
// like the white and black keys of a piano: C C# D D# E F F# G G# A A# H
// (German H is B). The dark boxes on the screen are the black keys. Chords
// are major; hold Shift for minor.
//
// ↑ and ↓ change the tempo, which the number display shows in beats per
// minute (an arpeggio is 8 sixteenth notes, half a bar). ← and → choose one
// of five arpeggio patterns; the number display shows its number for a
// second and a half.
//
// Try "New Born" by Muse: Em H Em H Em C G H, one key per half bar. In the
// top row: Shift+T, +, Shift+T, +, Shift+T, Q, I, + (on an English keyboard
// the + key is ]).
//
// The keys-held device (port 0x05) reports where a key sits on the keyboard,
// not which letter it types, so the layout is the same everywhere. The
// speaker plays every note at the machine time of its OUT, and in(VSYNC)
// paces the program: notes fall on the 60 frames per second, like on old
// consoles. At 100, 150 or 180 BPM a sixteenth note is a whole number of
// frames, so the notes of an arpeggio are exactly even.

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
#define BOX_SHARP 10            // the box of a black key

char colors[33] = {
    12, 16, 26,     235, 232, 222,  30, 32, 40,     150, 210, 255,  40, 110, 170,
    255, 200, 60,   72, 88, 116,    225, 232, 245,  60, 190, 110,   90, 130, 255,
    28, 34, 48};

char white_index[12] = {0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6};
char is_black[12] = {0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0};
// Arpeggio patterns: semitones above the root, 8 sixteenths each. 4 is the
// major third (minor: 3), 7 the fifth, 12 the octave, 16 the third an octave up.
#define PATTERNS 5
char patterns[40] = {
    0, 7, 12, 16, 19, 16, 12, 7,        // 1 up and down
    0, 4, 7, 12, 16, 19, 24, 28,        // 2 rising
    28, 24, 19, 16, 12, 7, 4, 0,        // 3 falling
    0, 7, 4, 7, 0, 7, 4, 7,             // 4 Alberti bass: low, high, middle, high
    0, 12, 7, 12, 16, 12, 7, 12};       // 5 around the octave
char *pattern = patterns;
char key_color[NOTES];

// The letters C D E F G A H, 3 x 5 pixels, one row per byte.
char font[35] = {
    3, 4, 4, 4, 3,   6, 5, 5, 5, 6,   7, 4, 6, 4, 7,   7, 4, 6, 4, 4,
    3, 4, 5, 5, 3,   2, 5, 7, 5, 5,   5, 5, 7, 5, 5};
char sharp_sign[5] = {5, 15, 5, 15, 5};    // #, 4 pixels wide

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

// The box of a key with its note name: C, C#, D, … (sharps on dark boxes).
void box(char key, char color) {
    key = key & 127;
    char column = key & 15, sharp = is_black[column];
    if (color == BOX && sharp) color = BOX_SHARP;
    char ink = color == BOX || color == BOX_SHARP ? LETTER : BACK;
    int x = box_x(key), y = box_y(key);
    rect(x, y, 11, 10, color);
    letter(sharp ? x + 1 : x + 4, y + 2, white_index[column], ink);
    if (sharp) {
        char *p = SCREEN + (y + 2) * W + x + 6;
        for (char j = 0; j < 5; j++) {
            char bits = sharp_sign[j];
            if (bits & 8) p[0] = ink;
            if (bits & 4) p[1] = ink;
            if (bits & 2) p[2] = ink;
            if (bits & 1) p[3] = ink;
            p += W;
        }
    }
}

// The root note of the chord on a key, or 0 for keys without a chord:
// row 2 (Q) starts at C4, row 3 (A) at C3, row 4 (Y) at C2, a semitone per key.
char root_of(char key) {
    char row = (key >> 4) & 7, column = key & 15;
    if (row < 2 || row > 4 || column > 11) return 0;
    return LOWEST + 12 * (4 - row) + column;
}

char note_of(char key, char step) {
    char offset = pattern[step];
    if (offset % 12 == 4 && (key & KEY_SHIFT)) offset--;    // minor: the third is a semitone lower
    return root_of(key) + offset;
}

// Lights or clears the notes of a chord on the piano.
void show_chord(char key, char on) {
    for (char step = 0; step < 8; step++) {
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
    char choice = 0;            // the pattern, 0..PATTERNS − 1
    char shown = 0;             // frames left that the number display shows the pattern
    char stick_before = 0;
    char chord = 0;             // the key position of the chord, with the Shift bit
    char held = 0;              // the key held down in the last frame
    char step = 0;              // the sixteenth now, 0..7 in the arpeggio
    char playing = 0;           // the piano key that is lit
    int time = 0;               // since the sixteenth began: + 4 · bpm per frame, the next one at 3600
    out(NUMBER, bpm);
    out(NOTE_LENGTH, 900 / bpm + 3);

    char last = in(VSYNC);
    for (;;) {
        char now = in(VSYNC);   // 60 times per second: the timer value
        char passed = now - last;       // 1, or more if drawing took longer than a frame
        last = now;
        char key = in(KEYS);
        char before = chord;
        char tick = 0;
        if (chord) {                            // the beat goes on: the next sixteenth when its time has come
            time += (int)passed * 4 * bpm;
            if (time >= 3600) { time -= 3600; step = (step + 1) & 7; tick = 1; }
        }
        if (key != held && root_of(key)) {     // a key was just pressed (or Shift changed):
            if (!chord) { step = 0; time = 0; tick = 1; }       // the first key starts the beat
            chord = key;                        // its chord, now
        }
        held = key;
        char stick = in(JOYSTICK);
        // The arrows also come from W A S D, which are chord keys: only when no chord key is held.
        char pressed = key ? 0 : stick & ~stick_before;         // arrows that went down just now
        stick_before = stick;
        if (pressed & (JOY_LEFT | JOY_RIGHT)) {                 // ← →: the previous or next pattern
            if (chord) show_chord(chord, 0);
            choice = (choice + (pressed & JOY_RIGHT ? 1 : PATTERNS - 1)) % PATTERNS;
            pattern = patterns + 8 * choice;
            if (chord) show_chord(chord, 1);
            out(NUMBER, choice + 1);
            shown = 90;                                         // 1.5 seconds
        } else if (shown) {
            shown = shown > passed ? shown - passed : 0;
            if (!shown) out(NUMBER, bpm);
        }
        if (!key && (now & 3) == 0) {           // ↑ ↓: the tempo, while held
            char old = bpm;
            if (stick & JOY_UP && bpm < 240) bpm++;
            if (stick & JOY_DOWN && bpm > 40) bpm--;
            if (bpm != old) { out(NUMBER, bpm); out(NOTE_LENGTH, 900 / bpm + 3); shown = 0; }
        }
        if (stick & JOY_FIRE) chord = 0;       // Space: silence, until a key starts a new beat
        if (!tick && chord == before) continue;

        // The note first, so that drawing never delays it: on every sixteenth,
        // and at once for a new chord (the note of this sixteenth).
        char note = 0;
        if (chord) { note = note_of(chord, step); out(SPEAKER, note); }

        // … then the picture.
        if (playing) { piano_key(playing - 1, is_black[(playing - 1) % 12] ? CHORD_BLACK : CHORD_WHITE); playing = 0; }
        if (chord != before) {
            if (before) { show_chord(before, 0); box(before, BOX); }
            if (chord) { box(chord, chord & KEY_SHIFT ? MINOR : MAJOR); show_chord(chord, 1); }
        }
        if (note && note - LOWEST < NOTES) { playing = note - LOWEST + 1; piano_key(note - LOWEST, PLAYING); }
    }
}
