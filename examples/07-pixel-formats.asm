; ONE BYTE, MANY PIXELS
; Fills RAM 0x80..0xFF with an even ramp 0, 2, 4, …, 254.
; Afterwards, change the pixel format above the screen: the same bytes become
; gray levels, RGB 3-3-2 colors, two 4-bit palette indices or eight
; black-and-white pixels. Only the interpretation changes, never the RAM.
.display 0x80, 16, 8, gray8

        LDI A, 0x80
loop:   MOV B, A
        ADD B, A                ; B = 2·A, which wraps to 0, 2, 4, …
        STA [A], B
        INC A
        JNZ loop                ; until A wraps from 0xFF to 0
        HLT
