; MiniCPU 8S (or 8X): CALL/RET and register saving.
; Stack lives in ordinary RAM, growing down from the top.
; Watch SP and memory addresses 0xFC..0xFF while stepping.
.display 0xE0, 16, 1, gray8

LDI A, 0xE0         ; framebuffer cursor
LDI B, 0xFF         ; white pixel
CALL draw_two
HLT

draw_two:
    PUSH A         ; preserve the caller's cursor
    CALL pixel
    INC A
    CALL pixel
    POP A          ; restore register A
    RET

pixel:
    STA [A], B
    RET
