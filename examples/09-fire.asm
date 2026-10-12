; FIRE
;
; Every byte of the screen is the heat of one pixel (0 = black, 255 = white).
; Below the visible screen lies a row of embers that randomly flare up and
; die down. Starting at the bottom, every pixel becomes the average of the
; three pixels under it, minus a random amount of cooling — so the heat
; rises, flickers and fades like flames.
;
; The random numbers come from a device: IN reads port 0x03 (see Devices
; in the documentation). Code and screen share the same 256 bytes of RAM.
; Try 100 kHz, then 1 MHz. Drag the screen down to see the code itself.

.display screen, 16, 10, indexed8, fire_256

screen  .equ 0x50               ; 10 visible rows of 16 pixels
embers  .equ 0xF0               ; the hidden row below the screen
RANDOM  .equ 0x03

frame:  LDI A, embers           ; 1. flip about a quarter of the embers
flip:   IN B, RANDOM
        CMP B, 64
        JNC next
        LDA C, [A]
        XOR C, 255              ; cold ↔ hot
        STA [A], C
next:   INC A
        JNZ flip                ; A wraps from 0xFF to 0x00 after the last one

        LDI A, embers - 1       ; 2. let the heat rise, bottom row first
burn:   MOV D, A
        ADD D, 15               ; D = the pixel below A, one to the left
        LDA C, [D]
        SHR C
        SHR C
        MOV B, C                ; B = below left / 4
        INC D
        LDA C, [D]
        SHR C
        ADD B, C                ;   + below / 2
        INC D
        LDA C, [D]
        SHR C
        SHR C
        ADD B, C                ;   + below right / 4
        IN C, RANDOM            ; cool down by a random 0..31,
        AND C, 31
        SUB B, C
        JNC warm
        LDI B, 0                ; but never below zero
warm:   STA [A], B
        DEC A
        CMP A, screen - 1
        JNZ burn
        JMP frame
