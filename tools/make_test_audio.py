"""Generate two original 5-second commissioning tones; no third-party recordings."""
import math
from pathlib import Path
import struct
import sys
import wave

out = Path(sys.argv[1] if len(sys.argv) > 1 else "audio")
out.mkdir(parents=True, exist_ok=True)
rate = 22050
for track, frequency in [(1, 220), (2, 330)]:
    target = out / f"sound{track}.wav"
    if target.exists():
        raise SystemExit(f"Refusing to overwrite {target}")
    with wave.open(str(target), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        samples = bytearray()
        for i in range(rate * 5):
            t = i / rate
            envelope = min(1.0, t / .03, (5 - t) / .03)
            sample = round(3500 * envelope * math.sin(2 * math.pi * frequency * t))
            samples.extend(struct.pack("<h", sample))
        wav.writeframes(samples)
    print(target)
