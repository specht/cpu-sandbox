; ADD TWO NUMBERS
; Step through the four instructions and watch A, B and the flags.
; In the left margin you can see the address and the bytes of each line.

        LDI A, 5
        LDI B, 3
        ADD A, B                ; A = 8
        HLT
