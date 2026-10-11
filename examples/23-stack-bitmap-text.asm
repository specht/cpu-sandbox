; MiniCPU 8S: three 5x7 letters, rendered by one reusable drawChar routine.
; Each glyph is seven row bytes, aligned to the high five bits of a byte.
; 24x8 monochrome pixels, three bytes per screen row, RAM 0xD0..0xE7.
.display 0xD0, 24, 8, mono, 1bit_monitor_glow

    LDI A, glyph_C
    LDI B, 0xD0
    CALL drawChar
    LDI A, glyph_P
    LDI B, 0xD1
    CALL drawChar
    LDI A, glyph_U
    LDI B, 0xD2
    CALL drawChar
    HLT

; Parameters A = address of 7-byte glyph, B = starting screen byte.
; Row stride = 3 bytes. The stack stores the caller's return address.
drawChar:
    LDI C, 7
row:
    LDA D, [A]
    STA [B], D
    INC A
    INC B
    INC B
    INC B
    DEC C
    JNZ row
    RET

glyph_C: .db 0x70,0x88,0x80,0x80,0x80,0x88,0x70
glyph_P: .db 0xF0,0x88,0x88,0xF0,0x80,0x80,0x80
glyph_U: .db 0x88,0x88,0x88,0x88,0x88,0x88,0x70
