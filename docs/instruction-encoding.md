# MiniCPU instruction encoding

All addresses are hexadecimal. Opcode bytes are organized by instruction family. Registers A, B, C, D are encoded as 0, 1, 2, 3. `rr` operands use a single byte `(destination << 4) | source`. 16-bit addresses and immediates are little-endian (`low`, then `high`).

| Opcode | Operation | Model | Operand bytes |
|---|---|---|---|
| `00` | `NOP` | cpu8 | — |
| `01` | `HLT` | cpu8 | — |
| `02` | `CLF` | cpu8 | — |
| `10` | `LDI` | cpu8 | r, imm8 |
| `11` | `LDA_DIRECT` | cpu8 | r, addr8 |
| `12` | `LDA_INDIRECT` | cpu8 | rr |
| `13` | `STA_DIRECT` | cpu8 | addr8, r |
| `14` | `STA_INDIRECT` | cpu8 | rr |
| `15` | `MOV` | cpu8 | rr |
| `16` | `LDA_X` | cpu8x | r |
| `17` | `STA_X` | cpu8x | r |
| `18` | `LDX` | cpu8x | addr16 |
| `19` | `INCX` | cpu8x | — |
| `1A` | `DECX` | cpu8x | — |
| `20` | `ADD` | cpu8 | rr |
| `21` | `SUB` | cpu8 | rr |
| `22` | `INC` | cpu8 | r |
| `23` | `DEC` | cpu8 | r |
| `24` | `SHL` | cpu8 | r |
| `25` | `SHR` | cpu8 | r |
| `30` | `AND` | cpu8 | rr |
| `31` | `OR` | cpu8 | rr |
| `32` | `XOR` | cpu8 | rr |
| `40` | `CMP_IMM` | cpu8 | r, imm8 |
| `41` | `CMP_REG` | cpu8 | rr |
| `50` | `PUSH` | cpu8s | r |
| `51` | `POP` | cpu8s | r |
| `52` | `CALL` | cpu8s | addr8 |
| `53` | `RET` | cpu8s | — |
| `54` | `CALL16` | cpu8x | addr16 |
| `60` | `JMP` | cpu8 | addr8 |
| `61` | `JZ` | cpu8 | addr8 |
| `62` | `JNZ` | cpu8 | addr8 |
| `63` | `JC` | cpu8 | addr8 |
| `64` | `JNC` | cpu8 | addr8 |
| `68` | `JMP16` | cpu8x | addr16 |
| `69` | `JZ16` | cpu8x | addr16 |
| `6A` | `JNZ16` | cpu8x | addr16 |
| `6B` | `JC16` | cpu8x | addr16 |
| `6C` | `JNC16` | cpu8x | addr16 |

## Examples

```asm
LDI A, 5       ; 10 00 05
LDI B, 3       ; 10 01 03
ADD A, B       ; 20 01
HLT            ; 01
```

```asm
LDX 0x0800     ; 18 00 08, 8X only
STA [X], A     ; 17 00, 8X only
INCX           ; 19, 8X only
```

These are intentionally not the numeric opcodes of the earlier Ruby MiniCPU. All bundled `.asm` sources are assembled at runtime under the selected architecture.
