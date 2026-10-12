; INFERNO
;
; The fire from MiniCPU 8, now with 64 KiB: 128 × 96 pixels, one byte of
; heat each. This is the algorithm from the 1993 game DOOM, which is even
; simpler than averaging: every pixel takes the heat of a pixel in the row
; below, picked at random a little to the left or right (that's the wind),
; and sometimes cools down a bit on the way up.
;
; X walks backwards over the screen, from the bottom right corner to the top
; left. Y points to the pixel to copy from, 127..130 bytes after X.
; IN reads the random number device at port 0x03.
; About 37 cycles per pixel: try 16 MHz, then 32 MHz.

.cpu 8x
.display screen, 128, 96, indexed8, fire_256

WIDTH   .equ 128
HEIGHT  .equ 96
screen  .equ 0x1000             ; 128 × 96 = 12,288 bytes
embers  .equ screen + WIDTH * HEIGHT    ; a hidden row of white-hot bytes
RANDOM  .equ 0x03
COOLING .equ 6

        LDI X, embers           ; light the embers
        LDI A, 255
light:  STA [X], A
        INC X
        CMP X, embers + WIDTH + 2
        JNZ light

frame:  LDI X, embers - 1       ; start at the bottom right pixel
pixel:  IN A, RANDOM
        MOV B, A
        AND B, 3                ; B = 0..3
        MOV Y, X
        ADD Y, WIDTH - 1
        ADD Y, B                ; Y = the pixel below, shifted by −1..+2
        LDA C, [Y]
        AND A, 4                ; in half of the cases …
        JZ keep
        SUB C, COOLING          ; … cool down, but never below zero
        JNC keep
        LDI C, 0
keep:   STA [X], C
        DEC X
        CMP X, screen - 1
        JNZ pixel
        JMP frame
