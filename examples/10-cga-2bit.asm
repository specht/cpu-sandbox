; 16 x 8 CGA-style pixels, four pixels per byte.
; 0x1B = 00 01 10 11: four consecutive palette indices.
; Change 2 bpp to monochrome/4 bpp to see raw bytes reinterpreted.
.display 0xA0, 16, 8, indexed2, cga_palette_1_high
        LDI A, 0xA0
        LDI B, 0x1B
        LDI C, 32
loop:
        STA [A], B
        INC A
        DEC C
        JNZ loop
        HLT
