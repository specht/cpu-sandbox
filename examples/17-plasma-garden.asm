; PLASMA GARDEN — a static interference pattern made from three waves.
; 16 x 16 pixels, 16 colors, two pixels per byte (128 bytes at 0x80).
; Machine code, a single scratch byte and the wave table fit below 0x80.
; Nothing is drawn by the browser: every pixel is computed by the CPU.
.display 0x80, 16, 16, indexed4, aurora_cycle_16

        LDI A, 0x80          ; output pointer, 128 pixel pairs
pair:
        ; Phase of the diagonal wave: (2*x + y) modulo 16.
        MOV B, A
        LDI C, 7
        AND B, C             ; x = byte position within row
        SHL B                ; two pixels per byte
        MOV C, A
        SHR C
        SHR C
        SHR C                ; y = (A >> 3) - 16
        ADD B, C
        LDI D, 15
        AND B, D             ; drop the extra 16 in C
        LDI D, wave
        ADD B, D
        LDA B, [B]           ; diagonal wave
        STA diagonal, B      ; preserve while looking up x and y

        ; Add the horizontal and vertical waves.
        MOV B, A
        LDI D, 7
        AND B, D
        SHL B
        LDI D, wave
        ADD B, D
        LDA B, [B]           ; horizontal wave
        MOV C, A
        SHR C
        SHR C
        SHR C
        LDI D, wave - 16
        ADD C, D
        LDA C, [C]           ; vertical wave
        ADD B, C
        LDA C, diagonal
        ADD B, C

        ; Two four-bit palette indices form one byte.
        LDI D, 15
        AND B, D
        MOV C, B
        INC C
        AND C, D            ; neighboring pixel is next palette color
        SHL B
        SHL B
        SHL B
        SHL B
        OR B, C
        STA [A], B
        INC A
        JNZ pair             ; stop after the pointer wraps at 0x100
        HLT

.org 0x6F
diagonal: .db 0
wave:   .db 8, 11, 13, 15, 15, 13, 11, 8
        .db 5, 3, 1, 0, 0, 1, 3, 5
