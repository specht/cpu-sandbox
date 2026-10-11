; PRIMES BY TRIAL DIVISION, 2..127
; Pixel n of the screen (RAM 0x80 + n) turns white if n is prime.
; Deliberately simple and slow: note the cycle count, then make it faster.
.display 0x80, 16, 8, gray8

BASE    .equ 0x80
PIXEL   .equ 0xFF
        LDI A, BASE
        LDI C, 128
        LDI D, 0x00
clear_loop:
        STA [A], D
        INC A
        DEC C
        JNZ clear_loop
        LDI B, 2
outer_loop:
        CMP B, 0x80
        JZ done_all
        LDI D, 0x00
        LDI C, 0x02
inner_loop:
        MOV A, B
        SUB A, C
        JZ check_prime_done
        JC check_prime_done
        MOV A, B
mod_loop:
        SUB A, C
        JZ composite
        JC no_div_for_d
        JMP mod_loop
composite:
        LDI D, 0x01
        JMP check_prime_done
no_div_for_d:
        INC C
        JMP inner_loop
check_prime_done:
        CMP D, 0x00
        JNZ not_prime
        MOV A, B
        ADD A, BASE
        LDI C, PIXEL
        STA [A], C
not_prime:
        INC B
        JMP outer_loop
done_all:
        HLT
