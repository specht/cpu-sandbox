.display 0x80, 16, 8, gray8
; FILL RECTANGLE: 16 x 8 framebuffer, RAM 0x80..0xFF
; Address = 0x80 + y * 16 + x. All constants can be changed.
x0      .equ 3
y0      .equ 2
w       .equ 8
h       .equ 4
pixel   .equ 0xCC

        LDI A, 0x80
        LDI D, y0
        SHL D
        SHL D
        SHL D
        SHL D
        ADD A, D
        LDI D, x0
        ADD A, D
        LDI B, pixel
        LDI C, h
row_loop:
        LDI D, w
col_loop:
        STA [A], B
        INC A
        DEC D
        CMP D, 0
        JNZ col_loop
        DEC C
        CMP C, 0
        JZ done
        LDI D, (16 - w)
        ADD A, D
        JMP row_loop
done:   HLT
