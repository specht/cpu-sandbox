; COUNTDOWN
; DEC sets ZF when the result is zero; JNZ jumps back as long as it is not.

        LDI A, 5
loop:   DEC A
        JNZ loop
        HLT
