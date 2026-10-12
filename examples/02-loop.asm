; LOOPS
; Adds 5 + 4 + 3 + 2 + 1. A counts down, B collects the sum: 15.
; DEC sets ZF when the result is zero; JNZ jumps back as long as it is not.
; Step through it and watch PC jump back, A shrink, B grow and ZF change.

        LDI A, 5
        LDI B, 0
loop:   ADD B, A
        DEC A
        JNZ loop
        HLT
