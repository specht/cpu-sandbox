; MINI CPU 8 — PRISM GRADIENT
; A smooth 16-color diagonal spectrum, generated pixel by pixel.
; 16x16 pixels = 128 bytes at 0x80..0xFF, no graphics instructions.
; A = output pointer, D = hue, C = pairs left, B = packed pixels.
.display 0x80, 16, 16, indexed4, aurora_cycle_16

    LDI A, 0x80
    LDI D, 0             ; first color of the top row
row:
    LDI C, 8             ; eight bytes = sixteen pixels
pair:
    MOV B, D
    SHL B
    SHL B
    SHL B
    SHL B               ; first pixel in the upper nibble
    INC D               ; next hue for second pixel
    CMP D, 16
    JNZ second
    LDI D, 0             ; wrap through the spectrum
second:
    OR B, D             ; pack two colors into one byte
    STA [A], B
    INC A
    INC D
    CMP D, 16
    JNZ next
    LDI D, 0
next:
    DEC C
    JNZ pair
    CMP A, 0            ; 0xFF + 1 wraps: all rows complete
    JZ done
    INC D               ; shift the gradient each row
    CMP D, 16
    JNZ row
    LDI D, 0
    JMP row
done:
    HLT
