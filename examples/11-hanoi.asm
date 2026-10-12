; TOWERS OF HANOI
;
; Move the tower from the left peg to the right one, one disk at a time, and
; never put a bigger disk on a smaller one. The recursive idea: to move n
; disks from one peg to another, move n − 1 of them out of the way onto the
; third peg, move the biggest disk, then move the n − 1 disks back on top.
;
; hanoi(n, from, to, via) is a function that calls itself twice. The caller
; pushes the four arguments (n first) and frees them again with ADD SP, 4.
; There is no frame pointer, so [SP+n] counts from the top of the stack:
;
;     [SP+0]  return address        (pushed by CALL)
;     [SP+1]  via    [SP+2]  to    [SP+3]  from    [SP+4]  n
;
; Every PUSH moves these offsets by one. Each call has its own copy of the
; arguments, so the calls do not disturb each other: step into them and
; watch the stack grow down from 0xFF. The number display counts the moves,
; 2⁴ − 1 = 15. Run it at 1 kHz to watch the disks travel.
;
; The screen has one bit per pixel, so one byte is a whole disk: 8 pixels,
; one byte per peg and three bytes per row.

.cpu 8s
.display screen, 24, 4, mono, 1bit_monitor_glow

screen  .equ 0xC0               ; 24 × 4 pixels = 12 bytes
NUMBER  .equ 0x11

        LDI A, 4                ; the tower: disks 4, 3, 2, 1 on peg 0
tower:  LDI B, 0
        CALL put
        DEC A
        JNZ tower
        OUT NUMBER, A           ; 0 moves
        LDI A, 4                ; hanoi(4, 0, 2, 1)
        PUSH A
        LDI A, 0
        PUSH A
        LDI A, 2
        PUSH A
        LDI A, 1
        PUSH A
        CALL hanoi
        ADD SP, 4
        HLT

; hanoi(n, from, to, via)
hanoi:  LDA A, [SP+4]           ; n = 0: nothing to do
        CMP A, 0
        JZ done
        DEC A                   ; hanoi(n − 1, from, via, to)
        PUSH A
        LDA A, [SP+4]           ; from (each PUSH adds 1 to the offsets)
        PUSH A
        LDA A, [SP+3]           ; via
        PUSH A
        LDA A, [SP+5]           ; to
        PUSH A
        CALL hanoi
        ADD SP, 4
        LDA B, [SP+3]           ; move disk n from "from" to "to"
        CALL take
        LDA A, [SP+4]
        LDA B, [SP+2]
        CALL put
        LDA A, [moves]
        INC A
        STA [moves], A
        OUT NUMBER, A
        LDA A, [SP+4]           ; hanoi(n − 1, via, to, from)
        DEC A
        PUSH A
        LDA A, [SP+2]           ; via
        PUSH A
        LDA A, [SP+4]           ; to
        PUSH A
        LDA A, [SP+6]           ; from
        PUSH A
        CALL hanoi
        ADD SP, 4
done:   RET

; put(A = disk, B = peg): disk A goes on top of peg B
put:    ADD B, top              ; B = the address of top[peg]
        LDA D, [B]
        SUB D, 3                ; one row up
        STA [B], D
        MOV C, A
        ADD C, disks - 1
        LDA C, [C]              ; the 8 pixels of disk A
        STA [D], C
        RET

; take(B = peg): the top disk leaves peg B
take:   ADD B, top
        LDA D, [B]
        LDI C, 0
        STA [D], C
        ADD D, 3                ; one row down
        STA [B], D
        RET

; The address of the top disk on each peg; one row below the screen when
; the peg is empty. Then the pixels of disks 1 to 4, 2 to 8 pixels wide.
top:    .db screen + 12, screen + 13, screen + 14
disks:  .db 0x18, 0x3C, 0x7E, 0xFF
moves:  .db 0
