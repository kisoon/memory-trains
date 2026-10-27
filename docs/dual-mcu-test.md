# Crazy Train: dual-MCU bench test (2026-10-27)

**Status: untested prototype wiring / firmware.** Existing train_controller firmware is unchanged. Two boards exchange commands, not audio streams.

## Board allocation

| LILYGO T-Display S3 non-touch | GPIO | Peripheral |
|---|---|---|
| TMC2226 STEP / DIR / EN | 1 / 2 / 16 | 15 mm 2-phase, 4-wire linear stepper |
| DRV8871 IN1 / IN2 | 10 / 11 | Main brushed DC motor |
| AMT103-V A / B | 12 / 13 | Quadrature encoder; level shifting if 5 V |
| Photo interrupters OUT 1 / 2 | 4 / 14 | Trigger inputs; check battery divider / button circuitry |
| LED driver DIM or MOSFET gate | 17 | Single channel; driver depends on LED type |
| UART TX / RX | 43 / 44 | XIAO D7 RX / D6 TX |
| BOOT | 0 | reserved |

GPIO3 deliberately unused (strap). GPIO4 battery measurement network and GPIO14 onboard button need electrical verification; GPIO43/44 share default UART0, so use native USB CDC for logs. Avoid LCD-assigned pins and GPIO19/20 USB. Keep outputs disabled on boot; add motor driver input pull-downs and evaluate EN polarity.

| XIAO ESP32-S3 standard | GPIO | Peripheral |
|---|---|---|
| D0 / D1 / D4 | 1 / 2 / 5 | MAX98357A BCLK / LRC / DIN |
| D3 | 4 | SD CS |
| D8 / D9 / D10 | 7 / 8 / 9 | SD SPI SCK / MISO / MOSI |
| D6 / D7 | 43 / 44 | UART TX / RX |
| D2 / D5 | 3 / 6 | unused (GPIO3 strap avoided) |

MAX98357A VIN powered with suitable 5 V supply, GND common; speaker only between SPK+ and SPK-. Adafruit SPI/SDIO breakout uses SPI mode at 3.3 V logic; supply only per *exact breakout* silkscreen and specification. Both UART devices use 3.3 V logic and share GND; TX crosses to RX. Independently power each board correctly; never connect 24 V to GPIO, SD, or audio amp.

## UART smoke-test protocol
115200 8N1 ASCII, LF-delimited (CR ignored), <=95 bytes/frame.
LILYGO -> XIAO: PING, PLAY, STOP, STATUS.
XIAO -> LILYGO: READY,SD_OK / READY,SD_FAIL, PONG, ACK,PLAY, ACK,STOP, STATUS,PLAYING / STATUS,IDLE, DONE, ERR,WAV, ERR,CMD.
At boot XIAO announces SD result. PLAY opens /test.wav, STOP flushes to silence. No sequence IDs, retries or time synchronization in this bench test; implement them before exhibition deployment.

## Upload / bench procedure
1. Install Arduino-ESP32 **2.x** core for the XIAO sketch: it uses legacy driver/i2s.h. The LILYGO UART sketch is compatible with 2.x/3.x. Choose each board correctly and enable USB CDC On Boot for USB logs.
2. Prepare FAT32 microSD with `/test.wav`: mono, signed PCM 16-bit, **22050 Hz**, standard 44-byte RIFF/WAVE header (no metadata chunks). This minimal parser does not support arbitrary WAV chunks or other formats.
3. Connect cross UART plus GND; separately power MAX98357A. Do not attach motors for first communications test. Load `hardware/dual_mcu_test/lilygo_link_test/lilygo_link_test.ino` and `hardware/dual_mcu_test/xiao_audio_test/xiao_audio_test.ino`.
4. Open USB serial monitor at 115200. Observe LILYGO `PING` every 2 s and `PONG`, plus XIAO `READY,SD_OK`. Type PLAY, STATUS, STOP on LILYGO USB serial.
5. Verify 5 repeated playback cycles, card missing, amp silent at stop, resets/reconnect and power stability.

## Limits and safety
No main DC motor, stepper, LED, encoder, triggers, PID, or LCD functionality is activated in the smoke-test sketches. This intentionally tests UART/SD/I2S only. Before power-on with motors: check motor voltage/current including stall, DRV8871 continuous thermal limits; check tiny stepper coil current against TMC2226 programmable current floor, and include homing/limit protection. LED driver remains conditional on actual LED electrical specification. UART loss must not ever cause unintended motion.
