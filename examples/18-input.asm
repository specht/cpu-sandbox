; INPUT AND OUTPUT
; Devices are not in RAM: they sit at numbered ports. IN reads a port,
; OUT writes one. This program polls three devices in a loop:
;   port 0x02  Timer      counts 60 times per second
;   port 0x00  Joystick   one bit per arrow key that is held down
;   port 0x01  Keyboard   the next typed character, 0 if none
; and writes the code of every typed key to the number display (0x11).
;
; Run it, then click the screen: the arrow keys move the dot, other keys
; show up on the number display. Esc gives the keyboard back.

.display 0x80, 16, 8, gray8

JOYSTICK .equ 0x00
KEYBOARD .equ 0x01
TIMER    .equ 0x02
NUMBER   .equ 0x11

        LDI C, 0x80 + 16 * 4 + 8    ; C = address of the dot
        LDI B, 255
        STA [C], B

loop:   IN A, KEYBOARD          ; a typed key?
        CMP A, 0
        JZ wait
        OUT NUMBER, A           ; show its character code

wait:   IN A, TIMER             ; wait for the next tick: 10 moves per second
        LDA B, tick
        SUB A, B
        CMP A, 6
        JC loop
        IN A, TIMER
        STA tick, A

        IN A, JOYSTICK          ; bits: 1 = ←, 2 = →, 4 = ↑, 8 = ↓
        CMP A, 0
        JZ loop
        LDI B, 0                ; erase the dot
        STA [C], B
        MOV B, A
        LDI D, 1
        AND B, D
        JZ no_left
        DEC C
no_left:
        MOV B, A
        LDI D, 2
        AND B, D
        JZ no_right
        INC C
no_right:
        MOV B, A
        LDI D, 4
        AND B, D
        JZ no_up
        LDI D, 16
        SUB C, D
no_up:
        MOV B, A
        LDI D, 8
        AND B, D
        JZ no_down
        LDI D, 16
        ADD C, D
no_down:
        LDI D, 0x80             ; keep the dot on the screen (0x80..0xFF)
        OR C, D
        LDI B, 255              ; draw the dot
        STA [C], B
        JMP loop

tick:   .db 0
