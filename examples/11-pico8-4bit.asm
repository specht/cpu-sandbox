; 16 x 8 pixels with 16-color palette; two pixels per byte.
; Byte 0x1E becomes indices 1 and 14 (PICO-8 colors).
.display 0xA0, 16, 8, indexed4, pico_8
        LDI A, 0xA0
        LDI B, 0x1E
        LDI C, 64
loop:
        STA [A], B
        INC A
        DEC C
        JNZ loop
        HLT
