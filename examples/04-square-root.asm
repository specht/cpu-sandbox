; INTEGER SQUARE ROOT
; 1 + 3 + 5 + … + (2k − 1) = k². Subtract odd numbers until it no longer
; works; the number of subtractions is ⌊√24⌋ = 4, in D.

        LDI A, 24
        LDI C, 1        ; the next odd number
        LDI D, 0
loop:   SUB A, C
        JC done         ; borrow: C did not fit any more
        INC C
        INC C
        INC D
        JMP loop
done:   HLT
