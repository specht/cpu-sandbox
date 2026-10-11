; INFERNO
;
; The fire from MiniCPU 8, now with 4 KiB: 64 × 48 pixels, one byte of heat
; each. This is the algorithm from the 1993 game DOOM, which is even simpler
; than averaging: every pixel takes the heat of a pixel in the row below,
; picked at random a little to the left or right (that's the wind), and
; sometimes cools down a bit on the way up.
;
; X walks backwards over the screen, from the bottom right corner to the top
; left. Y points to the pixel to copy from, 63..66 bytes after X.
; IN reads the random number device at port 0x03. Try 4 MHz.

.cpu 8x
.display screen, 64, 48, indexed8, fire_256

screen  .equ 0x0300             ; 64 × 48 = 3072 bytes
embers  .equ screen + 64 * 48   ; a hidden row of 66 white-hot bytes
RANDOM  .equ 0x03
COOLING .equ 16

        LDI X, embers           ; light the embers
        LDI A, 255
light:  STA [X], A
        INC X
        CMP X, embers + 66
        JNZ light

frame:  LDI X, embers - 1       ; start at the bottom right pixel
pixel:  IN A, RANDOM
        MOV B, A
        AND B, 3                ; B = 0..3
        MOV Y, X
        ADD Y, 63
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
