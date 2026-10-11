; MINI CPU 8X — NEON ORBIT
; Approximate radial shading with only 8-bit arithmetic.
; 64x48 pixels, 16 colors: 1536 bytes at 0x0800..0x0DFF.
; Each screen byte stores TWO computed pixels.
; CALL computes a color from x and y; the stack stays above RAM.
.display 0x0800, 64, 48, indexed4, aurora_cycle_16

    LDX 0x0800
    LDI A, 0
    STA ypos, A
row:
    LDI A, 0
    STA xpos, A
pair:
    LDA A, xpos
    CALL shade
    SHL A
    SHL A
    SHL A
    SHL A
    PUSH A               ; first pixel's color
    LDA A, xpos
    INC A
    CALL shade
    POP B
    OR B, A              ; pack two palette indices
    STA [X], B
    INCX
    LDA A, xpos
    INC A
    INC A
    STA xpos, A
    CMP A, 64
    JNZ pair
    LDA A, ypos
    INC A
    STA ypos, A
    CMP A, 48
    JNZ row
    HLT

; Shade one pixel: A = x coordinate, returns A = color (0..15).
; Euclidean distance is approximated using max(dx,dy) + min(dx,dy)/2.
shade:
    MOV B, A
    CMP B, 32
    JC left
    LDI C, 32
    SUB B, C
    JMP have_dx
left:
    LDI C, 32
    SUB C, B
    MOV B, C
have_dx:
    LDA C, ypos
    CMP C, 24
    JC above
    LDI D, 24
    SUB C, D
    JMP have_dy
above:
    LDI D, 24
    SUB D, C
    MOV C, D
have_dy:
    CMP B, C
    JC taller
    MOV A, C
    SHR A
    ADD A, B
    JMP finish
taller:
    MOV A, B
    SHR A
    ADD A, C
finish:
    LDI D, 15
    AND A, D             ; select one of 16 cyclic colors
    RET

xpos: .db 0
ypos: .db 0
