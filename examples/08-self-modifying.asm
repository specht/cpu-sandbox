; SELF-MODIFYING CODE
; Instructions are just bytes in RAM, so a program can overwrite them.
; LDI B, 0 is three bytes: opcode, register, value. STA replaces the value
; byte (address target + 2) before the LDI runs. Watch the margin.

        LDI A, 42
        STA target + 2, A
target: LDI B, 0                ; B ends up as 42, not 0
        HLT
