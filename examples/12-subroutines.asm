; SUBROUTINES AND THE STACK
; CALL pushes the return address and jumps; RET pops it and jumps back.
; PUSH and POP use the same stack to save a register. The stack starts at
; the very end of RAM and grows downwards: watch SP and 0xFC..0xFF.

.cpu 8s
.display 0xE0, 16, 1, gray8

        LDI A, 0xE0             ; screen cursor
        LDI B, 0xFF             ; white
        CALL draw_two
        LDI A, 0xE8
        CALL draw_two
        HLT

draw_two:                       ; two pixels at A and A + 1, A unchanged
        PUSH A
        CALL pixel              ; a call inside a call: two return addresses
        INC A
        CALL pixel
        POP A
        RET

pixel:  STA [A], B
        RET
