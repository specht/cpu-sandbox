; RAINBOW INTERFERENCE — animated 16-color pixel art
; 16 × 16 = 256 pixels in 128 bytes of shared RAM (0x80..0xFF).
; CPU instructions occupy only low addresses; the framebuffer is NOT
; separate hardware. Move the display start or bit depth to reinterpret RAM.
.display 0x80, 16, 16, indexed4, sweetie_16

        LDI D, 0          ; phase / animation frame
frame:
        LDI A, 0x80       ; first packed pair of pixels
pixel_pair:
        MOV B, A         ; use address bits to make two-dimensional waves
        SHR B
        SHR B
        MOV C, A
        SHL C
        XOR B, C         ; two intertwined diagonal patterns
        ADD B, D         ; phase shifts the colors each frame
        STA [A], B       ; B contains two 4-bit color indexes
        INC A
        JNZ pixel_pair   ; address wraps after 0xFF
        INC D
        JMP frame        ; loop forever (Pause to inspect RAM)
