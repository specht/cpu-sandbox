; FIRE
;
; Every byte of the screen is the heat of one pixel (0 = black, 255 = white).
; Below the visible screen lies a row of embers that randomly flare up and
; die down. Starting at the bottom, every pixel becomes the average of the
; three pixels under it, minus a little cooling — so the heat rises and
; fades like flames.
;
; Code, variables and screen share the same 256 bytes of RAM.
; Try 100 kHz, then 1 MHz. Drag the screen down to see the code itself.

.display screen, 16, 9, indexed8, fire_256

screen  .equ 0x60               ; 9 visible rows of 16 pixels
embers  .equ 0xF0               ; the hidden row below the screen
COOLING .equ 16

frame:  LDA B, random           ; 1. flip about a quarter of the embers
        LDI A, embers
seed:   LDI C, 0xB8             ; 8-bit LFSR: shift right, and if a 1 fell
        SHR B                   ; out, flip the tap bits. B runs through all
        JNC keep                ; values 1..255 in a scrambled order.
        XOR B, C
keep:   CMP B, 64
        JNC next
        LDA C, [A]
        LDI D, 255
        XOR C, D                ; cold ↔ hot
        STA [A], C
next:   INC A
        JNZ seed                ; A wraps from 0xFF to 0x00 after the last one
        STA random, B

        LDI A, embers - 1       ; 2. let the heat rise, bottom row first
        LDI D, embers + 14      ; D = the pixel below A, one to the left
burn:   LDA C, [D]
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
        DEC D
        DEC D
        DEC D
        LDI C, COOLING
        SUB B, C                ; cool down,
        JNC warm
        LDI B, 0                ; but never below zero
warm:   STA [A], B
        DEC A
        CMP A, screen - 1
        JNZ burn
        JMP frame

random: .db 1
