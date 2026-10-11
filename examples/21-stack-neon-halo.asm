; MINI CPU 8S — NEON HALO
; 16x12 color image, shaded as concentric diamond-shaped rings.
; The 96-byte framebuffer lives at 0x90..0xEF; stack uses 0xF0..0xFF.
; The main loop CALLs a pixel-pair subroutine with PUSH/POP.
.display 0x90, 16, 12, indexed4, aurora_cycle_16

    LDI A, 0x90
next_pair:
    CALL shade_pair
    INC A
    CMP A, 0xF0
    JNZ next_pair
    HLT

; Convert destination address in A into (x,y), then a color.
; Color = distance from center, approximated by |x-8| + |y-6|.
; Two nearby palette entries make a softly shaded pixel pair.
shade_pair:
    PUSH A
    MOV B, A
    LDI D, 7
    AND B, D            ; byte column 0..7
    SHL B               ; x is even: 0, 2, ..., 14
    CMP B, 8
    JC left
    LDI D, 8
    SUB B, D
    JMP xdone
left:
    LDI D, 8
    SUB D, B
    MOV B, D
xdone:                      ; B = |x - 8|
    MOV C, A
    LDI D, 0x90
    SUB C, D
    SHR C
    SHR C
    SHR C               ; y = (address - 0x90) / 8
    CMP C, 6
    JC above
    LDI D, 6
    SUB C, D
    JMP ydone
above:
    LDI D, 6
    SUB D, C
    MOV C, D
ydone:                      ; C = |y - 6|
    ADD B, C
    SHL B               ; emphasize concentric bands
    LDI D, 15
    AND B, D
    MOV C, B
    INC C
    AND C, D
    SHL B
    SHL B
    SHL B
    SHL B
    OR B, C             ; two 4-bit pixels in one byte
    POP A
    STA [A], B
    RET
