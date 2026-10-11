; THREE WAYS TO NAME A VALUE
; LDI loads a constant, LDA with an address reads a fixed RAM cell,
; LDA with [register] reads the cell whose address is in the register.
; .org and .db place data anywhere in RAM; look for the text at 0x60.

        LDI A, message          ; A = 0x60, the address of the text
        LDA B, message          ; B = 'H', read from the fixed address 0x60
        INC A
        LDA C, [A]              ; C = 'e', read from the address in A
        HLT

.org 0x60
message: .db "Hello, CPU!", 0
