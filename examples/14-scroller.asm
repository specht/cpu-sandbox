; SCROLLING TEXT
;
; A 32 × 8 LED sign: one bit per pixel, so a screen row is only 4 bytes.
; Every frame shifts all rows one pixel to the left and feeds in the next
; column of the current letter at the right edge.
;
; Two subroutines do the work. CALL pushes the return address onto the
; stack at the top of RAM and RET pops it again — watch SP and the bytes
; at 0xFE..0xFF while you step through a frame.
; The message is a list of glyph addresses (__ is a space); each glyph is
; 5 column bytes, bit 0 = top row. Try 10 kHz, then 50 kHz.

.cpu 8s
.display screen, 32, 8, mono, 1bit_monitor_glow

screen  .equ 0xC0               ; 8 rows × 4 bytes

frame:  CALL next_column        ; C = the new column, bit 0 = top row
        STA column, C
        LDI A, screen + 31      ; start with the last byte of the bottom row
row:    LDA C, column
        SHL C                   ; take the bit for this row (bottom row first)
        STA column, C
        LDI B, 0
        JNC dark
        LDI B, 1
dark:   CALL shift_byte         ; four bytes per row, right to left
        CALL shift_byte
        CALL shift_byte
        CALL shift_byte
        CMP A, screen - 1
        JNZ row
        JMP frame

; [A] = [A] << 1 with B (0 or 1) as the new rightmost pixel.
; Returns the pixel that was pushed out on the left in B, and A = A − 1.
shift_byte:
        LDA D, [A]
        SHL D                   ; CF = the pixel that falls out
        LDI C, 0                ; LDI does not change the flags
        JNC keep
        LDI C, 1
keep:   OR D, B
        STA [A], D
        MOV B, C
        DEC A
        RET

; C = next column of the message: five glyph columns, then one empty column.
next_column:
        LDA A, column_index
        CMP A, 5
        JZ gap
        INC A
        STA column_index, A
        DEC A
        LDA B, letter           ; B = address of the current letter's pointer
        LDA B, [B]              ; B = address of the glyph
        ADD B, A
        LDA C, [B]
        RET
gap:    LDI A, 0
        STA column_index, A
        LDA B, letter
        INC B                   ; next letter …
        LDA C, [B]
        CMP C, 0
        JNZ same_text
        LDI B, message          ; … or start over at the end of the message
same_text:
        STA letter, B
        LDI C, 0
        RET

column:       .db 0
column_index: .db 0
letter:       .db message
message:      .db _M, _I, _N, _I, _C, _P, _U, __, _8, _S, __, __, 0

_M:      .db 0x7F, 0x02, 0x0C, 0x02, 0x7F
_I:      .db 0x00, 0x41, 0x7F, 0x41, 0x00
_N:      .db 0x7F, 0x02, 0x04, 0x08, 0x7F
_C:      .db 0x3E, 0x41, 0x41, 0x41, 0x22
_P:      .db 0x7F, 0x09, 0x09, 0x09, 0x06
_U:      .db 0x3F, 0x40, 0x40, 0x40, 0x3F
_8:      .db 0x36, 0x49, 0x49, 0x49, 0x36
_S:      .db 0x46, 0x49, 0x49, 0x49, 0x31
__:     .db 0, 0, 0, 0, 0
