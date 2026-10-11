; INTEGER DIVISION BY REPEATED SUBTRACTION
; 13 / 4 = 3 remainder 1. Afterwards C holds the quotient, D the remainder.
; CMP D, B sets CF when D < B: then nothing more can be subtracted.

        LDI A, 13
        LDI B, 4
        LDI C, 0
        MOV D, A
loop:   CMP D, B
        JC done
        SUB D, B
        INC C
        JMP loop
done:   HLT
