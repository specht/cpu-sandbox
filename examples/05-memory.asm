; NUMBERS AND ADDRESSES
; Square brackets always mean "the memory at": LDI A, 0x60 loads the number
; 0x60 itself, LDA B, [0x60] reads the byte stored at address 0x60, and
; LDA C, [A] reads the byte at the address that A contains.
; .org and .db place data anywhere in RAM; look for the text at 0x60.

        LDI A, message          ; A = 0x60, the address of the text
        LDA B, [message]        ; B = 'H', the byte at address 0x60
        INC A
        LDA C, [A]              ; C = 'e', the byte at the address in A
        HLT

.org 0x60
message: .db "Hello, CPU!", 0
