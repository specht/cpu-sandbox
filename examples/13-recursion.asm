; RECURSION WITH ARGUMENTS AND LOCAL VARIABLES
; fib(n) = fib(n−1) + fib(n−2), computed by a function that calls itself.
; The calling convention: the caller PUSHes the argument, CALLs, and frees
; it again with ADD SP, 1. The result comes back in A. The function makes
; room for its local variable with SUB SP, 1 and reads and writes the stack
; with [SP+n], without popping:
;
;     [SP+0]  local variable      (SUB SP, 1)
;     [SP+1]  return address      (pushed by CALL)
;     [SP+2]  argument n          (pushed by the caller)
;
; Every call has its own copy of n and of the local, so the calls do not
; disturb each other. The table fib(0..13) ends up at 0x80 — step into a few
; calls and watch the stack grow down from 0xFF.

.cpu 8s
.display 0x80, 14, 1, gray8

        LDI C, 0                ; n = 0, 1, 2, …, 13
next:   PUSH C                  ; argument
        CALL fib
        ADD SP, 1               ; free the argument
        LDI B, 0x80             ; table[n] = fib(n)
        ADD B, C
        STA [B], A
        INC C
        CMP C, 14
        JNZ next
        HLT

fib:    SUB SP, 1               ; room for the local variable
        LDA A, [SP+2]           ; A = n
        CMP A, 2
        JC done                 ; fib(0) = 0 and fib(1) = 1: return n
        DEC A
        PUSH A
        CALL fib                ; A = fib(n − 1)
        ADD SP, 1
        STA [SP+0], A           ; local = fib(n − 1)
        LDA A, [SP+2]
        DEC A
        DEC A
        PUSH A
        CALL fib                ; A = fib(n − 2)
        ADD SP, 1
        LDA B, [SP+0]
        ADD A, B                ; A = fib(n − 1) + fib(n − 2)
done:   ADD SP, 1               ; free the local variable
        RET
