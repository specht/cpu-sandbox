; SELF-MODIFYING CODE: replace an instruction's operand in RAM.
; The immediate operand is at 'target + 2': LDI uses 3 bytes.
; After the write, the same machine code runs with a different value.
; Step through and inspect the changed byte in Machine code / RAM.
        LDI A, 42
        STA target + 2, A
        JMP target

target:
        LDI B, 0         ; This 0 is overwritten with 42 at runtime!
        HLT
