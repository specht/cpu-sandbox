; BREAKOUT
; Clear the wall of colored bricks with the ball. ← → move the paddle,
; Space (or ↑) launches the ball. Run the program, then click the screen
; so that the keys go to the joystick. The score appears on the number
; display, the lives in the top right corner.
;
; The game polls its devices: the timer paces the game at 30 steps per
; second, the joystick moves the paddle, the speaker beeps. Every pixel is
; one byte (an index into the VGA palette), so pixel (x, y) is at
; screen + 32·y + x, built in X byte by byte. The ball finds bricks simply
; by reading the pixel it is about to move to.
;
; Try 1 MHz, then 10 kHz: the timer keeps the game at the same speed as
; long as the CPU keeps up. One second of play needs about 20,000 cycles.

.cpu 8x
.display screen, 32, 24, indexed8, vga

screen   .equ 0x0800            ; 32 × 24 pixels, one byte each
JOYSTICK .equ 0x00
TIMER    .equ 0x02
RANDOM   .equ 0x03
SPEAKER  .equ 0x10
NUMBER   .equ 0x11
LEFT     .equ 1                 ; joystick bits
RIGHT    .equ 2
LAUNCH   .equ 4 | 16            ; ↑ or Space
PADDLE   .equ 11                ; colors (VGA palette indices)
BALL     .equ 15
HEART    .equ 12
PADDLE_Y .equ 22
WIDTH    .equ 6                 ; paddle width

; ---- new game -------------------------------------------------------------
start:  LDX screen              ; clear the screen
        LDI A, 0
clear:  STA [X], A
        INCX
        MOV B, XH
        CMP B, (screen + 32 * 24) >> 8
        JNZ clear
        STA score, A
        OUT NUMBER, A
        LDI A, 3
        STA lives, A
        CALL draw_lives
        CALL draw_bricks
        LDI A, 13
        STA paddle, A
        CALL draw_paddle
        CALL serve

; ---- the game loop: one step every 2 timer ticks --------------------------
loop:   IN A, TIMER
        LDA B, tick
        SUB A, B
        CMP A, 2
        JC loop
        IN A, TIMER
        STA tick, A

        CALL move_paddle
        LDA A, serving
        CMP A, 0
        JZ playing
        CALL follow_paddle      ; the ball waits on the paddle …
        IN A, JOYSTICK
        LDI B, LAUNCH
        AND A, B
        JZ loop
        LDI A, 0                ; … until it is launched
        STA serving, A
        JMP loop

playing:
        CALL move_ball
        LDA A, bricks
        CMP A, 0
        JNZ alive
        CALL draw_bricks        ; wall cleared: a new one
        CALL serve
alive:  LDA A, lives
        CMP A, 0
        JNZ loop

game_over:                      ; wait until Space is released and pressed
        IN A, JOYSTICK
        CMP A, 0
        JNZ game_over
press:  IN A, JOYSTICK
        LDI B, LAUNCH
        AND A, B
        JZ press
        JMP start

; ---- the paddle -----------------------------------------------------------
move_paddle:
        IN A, JOYSTICK
        STA keys, A
        LDI B, LEFT
        AND A, B
        JZ try_right
        LDA A, paddle
        CMP A, 0
        JZ try_right
        DEC A
        STA paddle, A
        CALL draw_paddle
try_right:
        LDA A, keys
        LDI B, RIGHT
        AND A, B
        JZ paddle_done
        LDA A, paddle
        CMP A, 32 - WIDTH
        JNC paddle_done
        INC A
        STA paddle, A
        CALL draw_paddle
paddle_done:
        RET

draw_paddle:
        LDI A, 0                ; clear the whole row, then draw the paddle
        LDI B, 0
        LDI C, PADDLE_Y
        LDI D, 32
        CALL hline
        LDI A, PADDLE
        LDA B, paddle
        LDI D, WIDTH
        CALL hline
        RET

; ---- the ball -------------------------------------------------------------
serve:  LDI A, 1
        STA serving, A
        IN A, RANDOM            ; start to the left or to the right
        LDI B, 1
        AND A, B
        JNZ serve_right
        LDI A, 255              ; −1
serve_right:
        STA dx, A
        LDI A, 255              ; upwards
        STA dy, A
        LDI A, 21
        STA bally, A
        ; fall through: put the ball onto the paddle

follow_paddle:
        CALL erase_ball
        LDA A, paddle
        INC A
        INC A
        STA ballx, A
        CALL draw_ball
        RET

; Moves the ball one step. A bounce takes the step instead of the move.
move_ball:
        LDA B, ballx            ; B = next x
        LDA A, dx
        ADD B, A
        CMP B, 32
        JC x_inside
        CALL flip_dx            ; left or right wall
        LDI A, 76
        OUT SPEAKER, A
        RET
x_inside:
        LDA C, bally            ; C = next y
        LDA A, dy
        ADD C, A
        CMP C, 0
        JNZ below_top
        CALL flip_dy            ; top wall (row 0 shows the lives)
        LDI A, 76
        OUT SPEAKER, A
        RET
below_top:
        CMP C, PADDLE_Y + 1
        JZ lost
        CALL peek               ; what is at the new position?
        CMP A, 0
        JZ move
        CMP A, PADDLE
        JZ hit_paddle

        LDI A, 0xFC             ; a brick: remove all 3 pixels of it
        AND B, A
        LDI A, 0
        LDI D, 3
        CALL hline
        CALL flip_dy
        LDA A, score
        INC A
        STA score, A
        OUT NUMBER, A
        LDA A, bricks
        DEC A
        STA bricks, A
        LDI A, 96               ; higher rows sound higher
        SUB A, C
        OUT SPEAKER, A
        RET

hit_paddle:
        LDI A, 255              ; always up again …
        STA dy, A
        LDA A, paddle           ; … and to the side the paddle was hit on
        SUB B, A                ; B = 0..5
        CMP B, 2
        JNC not_left_edge
        LDI A, 255
        STA dx, A
not_left_edge:
        CMP B, 4
        JC paddle_sound
        LDI A, 1
        STA dx, A
paddle_sound:
        LDI A, 60
        OUT SPEAKER, A
        RET

move:   PUSH B
        PUSH C
        CALL erase_ball
        POP C
        POP B
        STA ballx, B
        STA bally, C
        CALL draw_ball
        RET

lost:   CALL erase_ball
        LDA A, lives
        DEC A
        STA lives, A
        CALL draw_lives
        LDI A, 40
        OUT SPEAKER, A
        CALL serve
        RET

flip_dx:
        LDA A, dx               ; dx = 0 − dx
        LDI B, 0
        SUB B, A
        STA dx, B
        RET

flip_dy:
        LDA A, dy
        LDI B, 0
        SUB B, A
        STA dy, B
        RET

erase_ball:
        LDI A, 0
        JMP ball_pixel
draw_ball:
        LDI A, BALL
ball_pixel:
        LDA B, ballx
        LDA C, bally
        CALL plot
        RET

; ---- bricks and lives -----------------------------------------------------
; 6 rows of 8 bricks; a brick is 3 pixels wide with a 1-pixel gap.
draw_bricks:
        LDI A, 48
        STA bricks, A
        LDI C, 3                ; y of the first row
        LDY colors
brick_row:
        LDA A, [Y]              ; color of this row
        LDI B, 0                ; x of the first brick
brick:  LDI D, 3
        CALL hline
        INC B
        INC B
        INC B
        INC B
        CMP B, 32
        JNZ brick
        INCY
        INC C
        INC C
        CMP C, 15
        JNZ brick_row
        RET

draw_lives:                     ; up to 3 hearts in the top right corner
        LDI A, 0
        LDI B, 29
        LDI C, 0
        LDI D, 3
        CALL hline
        LDA D, lives
        CMP D, 0
        JZ lives_done
        LDI A, HEART
        LDI B, 31
heart:  CALL plot
        DEC B
        DEC B
        DEC D
        JNZ heart
lives_done:
        RET

; ---- pixels ---------------------------------------------------------------
; X = address of pixel (B, C) = screen + 32·C + B. Keeps A, B, C.
xy:     PUSH A
        MOV D, C                ; high byte: screen / 256 + C / 8
        SHR D
        SHR D
        SHR D
        LDI A, screen >> 8
        ADD D, A
        MOV XH, D
        MOV D, C                ; low byte: (C mod 8) · 32 + B
        SHL D
        SHL D
        SHL D
        SHL D
        SHL D
        OR D, B
        MOV XL, D
        POP A
        RET

plot:   PUSH D                  ; pixel (B, C) = A
        CALL xy
        STA [X], A
        POP D
        RET

peek:   CALL xy                 ; A = pixel (B, C)
        LDA A, [X]
        RET

hline:  PUSH D                  ; D pixels of color A from (B, C) to the right
        CALL xy
        POP D
        PUSH D
hline_next:
        STA [X], A
        INCX
        DEC D
        JNZ hline_next
        POP D
        RET

; ---- data -----------------------------------------------------------------
colors:  .db 40, 42, 44, 48, 52, 33     ; red, orange, yellow, green, cyan, blue
paddle:  .db 0
ballx:   .db 0
bally:   .db 0
dx:      .db 0
dy:      .db 0
serving: .db 0
score:   .db 0
lives:   .db 0
bricks:  .db 0
keys:    .db 0
tick:    .db 0
