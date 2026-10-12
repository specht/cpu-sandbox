// FIRST STEPS IN C
//
// The same CPU, programmed in C. The compiler turns every line into the
// assembly you already know: the margin shows the address and the bytes of
// each C line, and the Assembly tab above the editor shows the generated
// code, with each C line as a comment above its instructions.
//
// Step through it and compare: a local variable lives on the stack
// ([SP+n]), a call pushes the argument and the return address, and the
// result comes back in A. The sum of the first five squares appears on the
// number display.

#pragma cpu 8s
#pragma display 0xA0, 16, 4, gray8

char *screen = (char*)0xA0;     // 16 x 4 pixels, one byte each

char square(char n) {
    return n * n;
}

void main() {
    for (char i = 0; i < 64; i++)
        screen[i] = i * 4;      // a gray ramp
    char sum = 0;
    for (char n = 1; n <= 5; n++)
        sum = sum + square(n);
    out(NUMBER, sum);
}
