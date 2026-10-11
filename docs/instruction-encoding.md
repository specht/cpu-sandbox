# MiniCPU instruction encoding

All addresses are hexadecimal. `JMP`, `JZ`, `JNZ`, `JC`, `JNC`, and `CALL` use 8-bit absolute targets on MiniCPU 8/8S. On 8X the assembler automatically chooses a two-byte signed PC-relative encoding for targets from −128 to +127 relative to the next PC, or a three-byte 16-bit absolute encoding when needed. No suffixes are used in source. Opcode bytes are organized by instruction family. Registers A, B, C, D are encoded as 0, 1, 2, 3. `rr` operands use a single byte `(destination << 4) | source`. 16-bit addresses and immediates are little-endian (`low`, then `high`).

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
| `18` | `LDX` | cpu8x | imm16 |
| `19` | `INCX` | cpu8x | — |
| `1A` | `DECX` | cpu8x | — |
| `1B` | `LDA_Y` | cpu8x | r |
| `1C` | `STA_Y` | cpu8x | r |
| `1D` | `LDY` | cpu8x | imm16 |
| `1E` | `INCY` | cpu8x | — |
| `1F` | `DECY` | cpu8x | — |
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
| `52` | `CALL` | cpu8s | addr8 (absolute) |
| `53` | `RET` | cpu8s | — |
| `54` | `CALL_REL` | cpu8x | signed rel8 |
| `55` | `CALL_LONG` | cpu8x | addr16 (absolute) |
| `60` | `JMP` | cpu8 | addr8 (absolute) |
| `61` | `JZ` | cpu8 | addr8 (absolute) |
| `62` | `JNZ` | cpu8 | addr8 (absolute) |
| `63` | `JC` | cpu8 | addr8 (absolute) |
| `64` | `JNC` | cpu8 | addr8 (absolute) |
| `65` | `JMP_LONG` | cpu8x | addr16 (absolute) |
| `66` | `JZ_LONG` | cpu8x | addr16 (absolute) |
| `67` | `JNZ_LONG` | cpu8x | addr16 (absolute) |
| `68` | `JC_LONG` | cpu8x | addr16 (absolute) |
| `69` | `JNC_LONG` | cpu8x | addr16 (absolute) |
| `6A` | `JMP_REL` | cpu8x | signed rel8 |
| `6B` | `JZ_REL` | cpu8x | signed rel8 |
| `6C` | `JNZ_REL` | cpu8x | signed rel8 |
| `6D` | `JC_REL` | cpu8x | signed rel8 |
| `6E` | `JNC_REL` | cpu8x | signed rel8 |

## Examples

```asm
LDI A, 5       ; 10 00 05
LDI B, 3       ; 10 01 03
ADD A, B       ; 20 01
HLT            ; 01
```

```asm
LDX 0x0400     ; 18 00 04, 8X only
LDY 0x0800     ; 1D 00 08, 8X only
LDA A, [X]     ; 16 00, 8X only
STA [Y], A     ; 1C 00, 8X only
INCX           ; 19, 8X only
INCY           ; 1E, 8X only
```

```asm
LDX 0x0800     ; 18 00 08, 8X only
STA [X], A     ; 17 00, 8X only
INCX           ; 19, 8X only
```

These are intentionally not the numeric opcodes of the earlier Ruby MiniCPU. All bundled `.asm` sources are assembled at runtime under the selected architecture.

## Short and long jump encoding on MiniCPU 8X

A source instruction such as `JMP drawLine` has exactly one spelling.
The assembler initially lays out all jumps as short signed offsets, then
iteratively widens those that cannot reach their targets (including forward
labels, conditional branches, and calls). It repeats until all symbol
addresses are stable; this ensures the machine-code listing and execution
agree. Short targets are relative to the PC **after the instruction**.

`X` and `Y` are symmetric 16-bit index registers; the instruction set has
no 16-bit arithmetic in A–D and no hidden graphics operations.
