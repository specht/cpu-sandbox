; INTEGER SQUARE ROOT
; Floor(sqrt(24)) = 4, result in D.
; Subtract consecutive odd numbers: 1, 3, 5, ...
        LDI A, 24
        LDI C, 1
        LDI D, 0
loop:   SUB A, C
        JC done
        INC C
        INC C
        INC D
        JMP loop
done:   HLT
