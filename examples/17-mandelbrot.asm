; MANDELBROT SET
;
; For every pixel c = cr + ci·i the CPU iterates  z = z² + c  and colors the
; pixel by how quickly |z| grows beyond 2. Black pixels never escape.
;
; There is no multiplication instruction, so squares come from a table:
;   x² = squares[x]       and       2·zr·zi = ((zr+zi)² − (zr−zi)²) / 2
; Numbers are signed bytes with 5 fraction bits (32 = 1.0, −64 = −2.0).
;
; X points into the table (XH = page, XL = the number to square),
; Y walks through the screen, two 4-bit pixels per byte.
; Run it at 1 MHz and watch the picture appear line by line.

.cpu 8x
.display screen, 80, 60, indexed4, twilight_16

squares .equ 0x0300             ; 256-byte table, one page
screen  .equ 0x0400             ; 80 × 60 pixels, 2400 bytes

; ---- 1. squares[n] = n²/32 for n = 0..128, rounded, at most 255 -----------
        LDI B, 0                ; C:B = n² as a 16-bit number
        LDI C, 0
        LDI D, 1                ; D = 2n + 1, the next odd number
        LDI X, squares
fill:   PUSH B
        PUSH C
        ADD B, 16               ; + 16 rounds the division by 32;
        ADC C, 0                ; ADC adds the carry to the high byte
        LDI A, 255
        CMP C, 32               ; n² ≥ 8192 would need more than 8 bits
        JNC store
        SHL C                   ; A = C:B >> 5 = C << 3 | B >> 5
        SHL C
        SHL C
        SHR B
        SHR B
        SHR B
        SHR B
        SHR B
        MOV A, B
        OR A, C
store:  POP C
        POP B
        STA [X], A
        INC X
        ADD B, D                ; (n+1)² = n² + 2n + 1
        ADC C, 0
        INC D
        INC D
        CMP X, squares + 129
        JNZ fill

; ---- 2. (−n)² = n²: copy entries 1..127 backwards to 255..129 -------------
        LDI X, squares + 1
        LDI Y, squares + 255
mirror: LDA A, [X]
        STA [Y], A
        INC X
        DEC Y
        CMP X, squares + 128
        JNZ mirror

; ---- 3. draw: two pixels per screen byte ----------------------------------
        LDI X, squares
        LDI Y, screen
        LDI A, 0
        STA [py], A
row:    LDA A, [py]
        SUB A, 30               ; ci = (py − 30) / 32
        STA [ci], A
        LDI A, 0
        STA [px], A
pair:   CALL pixel              ; left pixel → high nibble
        SHL A
        SHL A
        SHL A
        SHL A
        PUSH A
        CALL pixel              ; right pixel → low nibble
        POP B
        OR A, B
        STA [Y], A
        INC Y
        LDA A, [px]
        CMP A, 80
        JNZ pair
        LDA A, [py]
        INC A
        STA [py], A
        CMP A, 60
        JNZ row
        HLT

; ---- A = color of pixel (px, py), then px = px + 1 ------------------------
pixel:  LDA A, [px]
        SUB A, 62               ; cr = (px − 62) / 32
        STA [cr], A
        LDA A, [px]
        INC A
        STA [px], A
        LDI A, 0
        STA [zr], A
        STA [zi], A
        STA [count], A
iterate:
        LDA A, [zr]             ; B = zr²
        MOV XL, A
        LDA B, [X]
        LDA A, [zi]             ; C = zi²
        MOV XL, A
        LDA C, [X]
        MOV D, B                ; escaped if zr² + zi² ≥ 4
        ADD D, C
        JC escaped
        CMP D, 128
        JNC escaped
        SUB B, C                ; B = new zr = zr² − zi² + cr
        LDA D, [cr]
        ADD B, D
        LDA A, [zr]             ; C = (zr − zi)²
        LDA D, [zi]
        SUB A, D
        MOV XL, A
        LDA C, [X]
        LDA A, [zr]             ; A = (zr + zi)²
        ADD A, D
        MOV XL, A
        LDA A, [X]
        SUB A, C                ; 2·zr·zi = ((zr+zi)² − (zr−zi)²) / 2
        JC negative             ; the difference is 9 bits wide: CF is its sign
        SHR A
        JMP halved
negative:
        SHR A
        OR A, 0x80              ; shift the sign bit back in
halved: LDA D, [ci]             ; zi = 2·zr·zi + ci
        ADD A, D
        STA [zi], A
        STA [zr], B
        LDA A, [count]
        INC A
        STA [count], A
        CMP A, 15
        JNZ iterate
        LDI A, 0                ; never escaped: black
        RET
escaped:
        LDA A, [count]          ; escaped after count steps: colors 1..15
        INC A
        RET

px:     .db 0
py:     .db 0
cr:     .db 0
ci:     .db 0
zr:     .db 0
zi:     .db 0
count:  .db 0
