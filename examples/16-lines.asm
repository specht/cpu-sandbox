; DRAWING LINES
; A wireframe cube from twelve lines, drawn with Bresenham's algorithm:
; step along the longer axis and keep an error sum that says when to also
; step along the shorter one. Only additions and comparisons are needed.
;
; Y walks through the table of edges. plot builds the 16-bit address of a
; pixel in X byte by byte with MOV XH / MOV XL.

.cpu 8x
.display screen, 64, 48, mono, 1bit_monitor_glow

screen  .equ 0x0800             ; 64 × 48 pixels, 8 bytes per row

        LDY edges
edge:   LDA A, [Y]              ; x0, y0, x1, y1 — or 255 at the end
        CMP A, 255
        JZ done
        STA x0, A
        INCY
        LDA A, [Y]
        STA y0, A
        INCY
        LDA A, [Y]
        STA x1, A
        INCY
        LDA A, [Y]
        STA y1, A
        INCY
        CALL line
        JMP edge
done:   HLT

; ---- line from (x0, y0) to (x1, y1) ---------------------------------------
line:   LDA A, x1               ; dx = |x1 − x0|, sx = ±1
        LDA B, x0
        LDI C, 1
        SUB A, B
        JNC x_positive
        LDI C, 0                ; negate A: 0 − A
        SUB C, A
        MOV A, C
        LDI C, 255              ; 255 is −1 in 8 bits
x_positive:
        STA dx, A
        STA sx, C
        LDA A, y1               ; dy = |y1 − y0|, sy = ±1
        LDA B, y0
        LDI C, 1
        SUB A, B
        JNC y_positive
        LDI C, 0
        SUB C, A
        MOV A, C
        LDI C, 255
y_positive:
        STA dy, A
        STA sy, C
        LDI A, 0
        STA error, A
        LDA A, dx
        LDA B, dy
        CMP A, B
        JC steep

flat:   CALL plot               ; |slope| ≤ 1: one pixel per x
        LDA A, x0
        LDA B, x1
        CMP A, B
        JZ line_done
        LDA B, sx
        ADD A, B
        STA x0, A
        LDA A, error
        LDA B, dy
        ADD A, B
        LDA B, dx
        CMP A, B
        JC flat_keep
        SUB A, B                ; the error passed dx: one step in y
        STA error, A
        LDA A, y0
        LDA B, sy
        ADD A, B
        STA y0, A
        JMP flat
flat_keep:
        STA error, A
        JMP flat

steep:  CALL plot               ; |slope| > 1: one pixel per y
        LDA A, y0
        LDA B, y1
        CMP A, B
        JZ line_done
        LDA B, sy
        ADD A, B
        STA y0, A
        LDA A, error
        LDA B, dx
        ADD A, B
        LDA B, dy
        CMP A, B
        JC steep_keep
        SUB A, B                ; the error passed dy: one step in x
        STA error, A
        LDA A, x0
        LDA B, sx
        ADD A, B
        STA x0, A
        JMP steep
steep_keep:
        STA error, A
        JMP steep
line_done:
        RET

; ---- set pixel (x0, y0) ---------------------------------------------------
; address = screen + 8·y0 + x0/8   and   bit = 0x80 >> (x0 mod 8)
plot:   LDA A, y0
        MOV B, A
        SHR B                   ; 8·y0 can exceed 255: its high byte is
        SHR B                   ; y0 / 32 …
        SHR B
        SHR B
        SHR B
        LDI C, screen >> 8
        ADD B, C
        MOV XH, B
        LDI C, 31               ; … and its low byte (y0 mod 32) · 8
        AND A, C
        SHL A
        SHL A
        SHL A
        LDA B, x0
        SHR B
        SHR B
        SHR B
        ADD A, B
        MOV XL, A
        LDA A, x0
        LDI B, 7
        AND A, B
        LDI B, 0x80
shift:  CMP A, 0
        JZ set
        SHR B
        DEC A
        JMP shift
set:    LDA A, [X]
        OR A, B
        STA [X], A
        RET

x0:     .db 0
y0:     .db 0
x1:     .db 0
y1:     .db 0
dx:     .db 0
dy:     .db 0
sx:     .db 0
sy:     .db 0
error:  .db 0

edges:  .db 32, 4, 10, 16,   10, 16, 32, 28,   32, 28, 54, 16,   54, 16, 32, 4
        .db 32, 24, 10, 36,  10, 36, 32, 47,   32, 47, 54, 36,   54, 36, 32, 24
        .db 32, 4, 32, 24,   10, 16, 10, 36,   32, 28, 32, 47,   54, 16, 54, 36
        .db 255
