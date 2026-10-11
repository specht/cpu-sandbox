; 32 x 8 MONOCHROME: 256 pixels stored in 32 bytes.
; Each RAM byte holds 8 pixels, highest bit at the left.
; Change the controller's palette to reinterpret the SAME bits.
.display 0xA0, 32, 8, mono, 1bit_monitor_glow

        LDI A, 0xA0    ; RAM address of the first pixel byte
        LDI B, 0xAA    ; 10101010: black/white alternating
        LDI C, 16      ; 16 pairs of bytes
        LDI D, 0x55    ; 01010101
next:
        STA [A], B
        INC A
        STA [A], D
        INC A
        DEC C
        JNZ next
        HLT
