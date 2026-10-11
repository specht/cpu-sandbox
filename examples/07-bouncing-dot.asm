.display 0xF0, 16, 1, gray8
; BOUNCING DOT, WITH A TWO-PIXEL TRAIL
; Bottom framebuffer row is 0xF0..0xFF (16 pixels).
PIXEL   .equ 0xEE
LEFT    .equ 0xF0
RIGHT   .equ 0xFF
DIR     .equ 0x70
LAST1   .equ 0x71
LAST2   .equ 0x72
        LDI A, LEFT
        LDI B, PIXEL
        LDI D, 0
        STA DIR, D
        STA LAST1, A
        STA LAST2, A
main:
        LDA D, LAST1
        LDA C, LAST2
        CMP C, D
        JZ skip_erase
        LDI B, 0
        STA [C], B
skip_erase:
        LDA B, DIR
        CMP B, 0
        JZ go_right
go_left:
        CMP A, LEFT
        JZ flip_to_right
        DEC A
        JMP moved
go_right:
        CMP A, RIGHT
        JZ flip_to_left
        INC A
        JMP moved
flip_to_right:
        LDI B, 0
        STA DIR, B
        INC A
        JMP moved
flip_to_left:
        LDI B, 1
        STA DIR, B
        DEC A
moved:
        LDI B, PIXEL
        STA [A], B
        MOV C, D
        STA [C], B
        STA LAST2, D
        STA LAST1, A
        JMP main
