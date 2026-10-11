; MiniCPU 8X: cube drawn with Bresenham's integer line algorithm.
; 64x48 1-bit framebuffer at 0x0800: 384 bytes, 8 bytes/row.
; plot calculates a 16-bit screen address by patching the immediate
; operand of LDX. This is intentional self-modifying code: useful for
; discussing the limits of an index register that only has INCX/DECX.
.display 0x0800, 64, 48, mono, 1bit_monitor_glow

; An isometric projection of eight cube vertices and twelve edges.
; Coordinates are projected beforehand to keep the rasterizer in focus.
    LDI A, 32
    LDI B, 4
    LDI C, 10
    LDI D, 16
    CALL drawLine
    LDI A, 10
    LDI B, 16
    LDI C, 32
    LDI D, 28
    CALL drawLine
    LDI A, 32
    LDI B, 28
    LDI C, 54
    LDI D, 16
    CALL drawLine
    LDI A, 54
    LDI B, 16
    LDI C, 32
    LDI D, 4
    CALL drawLine
    LDI A, 32
    LDI B, 24
    LDI C, 10
    LDI D, 36
    CALL drawLine
    LDI A, 10
    LDI B, 36
    LDI C, 32
    LDI D, 47
    CALL drawLine
    LDI A, 32
    LDI B, 47
    LDI C, 54
    LDI D, 36
    CALL drawLine
    LDI A, 54
    LDI B, 36
    LDI C, 32
    LDI D, 24
    CALL drawLine
    LDI A, 32
    LDI B, 4
    LDI C, 32
    LDI D, 24
    CALL drawLine
    LDI A, 10
    LDI B, 16
    LDI C, 10
    LDI D, 36
    CALL drawLine
    LDI A, 32
    LDI B, 28
    LDI C, 32
    LDI D, 47
    CALL drawLine
    LDI A, 54
    LDI B, 16
    LDI C, 54
    LDI D, 36
    CALL drawLine
    HLT

; Zero-page data and executable address-loader, deliberately placed below
; 0x0100 because direct LDA/STA use 8-bit addresses even on 8X.
x0:  .db 0
y0:  .db 0
x1:  .db 0
y1:  .db 0
dx:  .db 0
dy:  .db 0
sx:  .db 0
sy:  .db 0
err: .db 0

; The low/high operand bytes here are writable with ordinary STA.
load_x:
    LDX 0x0800
    RET
screen_low  .equ load_x + 1
screen_high .equ load_x + 2

; The line rasterizer is placed in higher instruction memory.
.org 0x0200

; Input: A=x0, B=y0, C=x1, D=y1 (0..63 / 0..47).
; Signed steps are 1 or 255 (-1 modulo 256).
; Major-axis Bresenham: accumulation uses only 8-bit unsigned math.
drawLine:
    STA x0, A
    STA y0, B
    STA x1, C
    STA y1, D
    LDI A, 0
    STA err, A

    ; dx = |x1 - x0| and sx = sign(x1 - x0)
    LDA A, x1
    LDA B, x0
    CMP A, B
    JC negative_x
    SUB A, B
    LDI B, 1
    JMP done_x
negative_x:
    SUB B, A
    MOV A, B
    LDI B, 255
done_x:
    STA dx, A
    STA sx, B

    ; dy = |y1 - y0| and sy = sign(y1 - y0)
    LDA A, y1
    LDA B, y0
    CMP A, B
    JC negative_y
    SUB A, B
    LDI B, 1
    JMP done_y
negative_y:
    SUB B, A
    MOV A, B
    LDI B, 255
done_y:
    STA dy, A
    STA sy, B
    LDA A, dx
    LDA B, dy
    CMP A, B
    JC steep

shallow:
    CALL plot
    LDA A, x0
    LDA B, x1
    CMP A, B
    JZ line_done
    LDA B, sx
    ADD A, B
    STA x0, A
    LDA A, err
    LDA B, dy
    ADD A, B
    LDA B, dx
    CMP A, B
    JC shallow_skip_y
    SUB A, B
    STA err, A
    LDA A, y0
    LDA B, sy
    ADD A, B
    STA y0, A
    JMP shallow
shallow_skip_y:
    STA err, A
    JMP shallow

steep:
    CALL plot
    LDA A, y0
    LDA B, y1
    CMP A, B
    JZ line_done
    LDA B, sy
    ADD A, B
    STA y0, A
    LDA A, err
    LDA B, dx
    ADD A, B
    LDA B, dy
    CMP A, B
    JC steep_skip_x
    SUB A, B
    STA err, A
    LDA A, x0
    LDA B, sx
    ADD A, B
    STA x0, A
    JMP steep
steep_skip_x:
    STA err, A
    JMP steep
line_done:
    RET

; Set bit at (x0, y0) using shared RAM. Pixel address:
; 0x0800 + (y0 >> 5)*256 + ((y0 & 31)*8) + (x0 >> 3).
; X cannot accept a computed value directly in this simple ISA, so we
; deliberately update LDX's two operand bytes in executable memory.
plot:
    PUSH A
    PUSH B
    PUSH C
    PUSH D

    LDA A, y0
    MOV B, A
    SHR B
    SHR B
    SHR B
    SHR B
    SHR B
    LDI C, 8
    ADD B, C
    STA screen_high, B

    LDI C, 31
    AND A, C
    SHL A
    SHL A
    SHL A
    LDA B, x0
    SHR B
    SHR B
    SHR B
    ADD A, B
    STA screen_low, A

    LDA A, x0
    LDI B, 7
    AND A, B
    LDI B, 0x80
mask_shift:
    CMP A, 0
    JZ mask_ready
    SHR B
    DEC A
    JMP mask_shift
mask_ready:
    CALL load_x
    LDA A, [X]
    OR A, B
    STA [X], A

    POP D
    POP C
    POP B
    POP A
    RET
