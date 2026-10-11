; FILL A RECTANGLE
; The screen is 16 × 8 bytes at 0x80, one gray value per pixel, so pixel
; (x, y) lives at address 0x80 + 16·y + x. Change the constants!
.display 0x80, 16, 8, gray8

x0      .equ 3
y0      .equ 2
w       .equ 8
h       .equ 4
gray    .equ 0xCC

        LDI A, 0x80 + 16 * y0 + x0      ; top left corner
        LDI B, gray
        LDI C, h
row:    LDI D, w
column: STA [A], B
        INC A
        DEC D
        JNZ column
        LDI D, 16 - w                   ; skip to the start of the next row
        ADD A, D
        DEC C
        JNZ row
        HLT
