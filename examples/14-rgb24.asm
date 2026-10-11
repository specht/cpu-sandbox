; Each pixel uses three bytes (red, green, blue).
; This is a 4 x 4 display, 12 bytes per row = 48 bytes total.
.display 0xA0, 4, 4, rgb24
        LDI A, 0xA0
        LDI B, 0xFF    ; red channel
        LDI C, 16
loop:
        STA [A], B      ; R = 255
        INC A
        LDI D, 0
        STA [A], D      ; G = 0
        INC A
        STA [A], D      ; B = 0
        INC A
        DEC C
        JNZ loop
        HLT
