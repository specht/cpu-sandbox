; Each byte is one pixel: RRR GGG BB.
; Try changing the interpretation to 8-bit grayscale.
.display 0x80, 16, 8, rgb332
        LDI A, 0x80
        LDI B, 0xE3    ; red = 7, green = 0, blue = 3
        LDI C, 128
loop:
        STA [A], B
        INC A
        DEC C
        JNZ loop
        HLT
