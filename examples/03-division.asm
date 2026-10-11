; INTEGER DIVISION USING REPEATED SUBTRACTION
; 13 / 4 = 3 remainder 1
; C = quotient; D = remainder
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
