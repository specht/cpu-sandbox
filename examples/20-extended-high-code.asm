; MiniCPU 8X: execute code above address 0x00FF.
; JMP remains an 8-bit absolute jump; JMP16 reaches high memory.
JMP16 start

.org 0x0200
start:
    LDI A, 0x2A
    CALL16 subroutine
    HLT

subroutine:
    INC A
    RET
