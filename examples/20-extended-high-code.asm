; MiniCPU 8X: execute code above address 0x00FF.
; JMP auto-selects a long absolute target when the label is too far away.
JMP start

.org 0x0200
start:
    LDI A, 0x2A
    CALL subroutine
    HLT

subroutine:
    INC A
    RET
