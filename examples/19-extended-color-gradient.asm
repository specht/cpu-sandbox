; MiniCPU 8X: 32x32 pixels, 16 colors, 512 framebuffer bytes.
; This does NOT fit inside MiniCPU 8's entire 256-byte address space.
; All pixel computation uses A-D, shifts, bitwise AND/OR and loops.
; X addresses any byte in the 4 KiB RAM; SP saves temporary values.
.display 0x0800, 32, 32, indexed4, sweetie_16

    LDX 0x0800       ; first screen byte
    LDI D, 32        ; rows
    LDI A, 0         ; starting color index for each row
row:
    PUSH A          ; preserve starting color
    LDI C, 16        ; two 4-bit pixels in each byte
pair:
    MOV B, A
    SHL B
    SHL B
    SHL B
    SHL B           ; high nibble = first pixel
    INC A           ; next color
    PUSH D          ; temporarily borrow D for a mask
    LDI D, 0x0F
    AND A, D
    OR B, A         ; low nibble = second pixel
    POP D
    STA [X], B      ; pixel data at address X
    INCX
    INC A
    LDI B, 0x0F
    AND A, B        ; wrap color index at 16
    DEC C
    JNZ pair
    POP A           ; next row begins one color later
    INC A
    LDI B, 0x0F
    AND A, B
    DEC D
    JNZ row
    HLT
