; COUNTDOWN: 5, 4, 3, 2, 1, 0
; Watch A and ZF as the loop executes.
LDI A, 5
loop:
    DEC A
    JNZ loop
HLT
