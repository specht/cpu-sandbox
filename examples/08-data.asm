; SOURCE BYTES AND MEMORY-INDIRECT LOADS
; Put a string at 0x60, then read its first character into B.
.org 0x00
        LDI A, message
        LDA B, [A]
        HLT
.org 0x60
message: .db "Hello, CPU!", 0
