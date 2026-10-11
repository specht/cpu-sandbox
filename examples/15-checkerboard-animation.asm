; Animated 32 x 16 MONOCHROME checkerboard: 512 pixels in 64 bytes.
; Each row occupies four bytes; adjacent rows have opposite patterns.
; After every frame, the black and white squares exchange places.
.display 0xC0, 32, 16, mono, 1bit_monitor_glow

        LDI B, 0xAA        ; pattern of alternating bits
frame:
        LDI A, 0xC0        ; display starts at 0xC0
        LDI C, 16          ; sixteen rows
row:
        LDI D, 4           ; four bytes per row = 32 pixels
column:
        STA [A], B
        INC A
        DEC D
        JNZ column
        LDI D, 0xFF        ; XOR flips all eight bits
        XOR B, D          ; invert next row's checkerboard
        DEC C
        JNZ row
        LDI D, 0xFF
        XOR B, D          ; invert the entire next frame
        JMP frame         ; pause the CPU to inspect the pattern
