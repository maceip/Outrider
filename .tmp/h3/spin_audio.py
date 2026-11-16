import numpy as np, wave, os, sys
sys.argv = ['x']
exec(open('.tmp/h3/render3d_spin.py').read().split('if __name__')[0])

SR = 48000
N = int(SR * DUR)
t = np.arange(N) / SR

# ---- whoosh: bandpassed noise whose level follows the real spin speed ----
rng = np.random.default_rng(3)
noise = rng.normal(0, 1, N)
F = np.fft.rfft(noise); f = np.fft.rfftfreq(N, 1.0 / SR)
band = (f > 260) & (f < 3400)
bp = np.fft.irfft(F * band, N)
bp /= max(np.abs(bp).max(), 1e-9)

speed = vel_norm(t)
speed = speed / max(speed.max(), 1e-9)
env = speed ** 1.35
whoosh = bp * env * 0.30

# ---- warm bell at the exact moment the emblem stops (t = T_STOP) ----
f0 = 587.33  # D5
partials = [(1.00, 1.00, 1.9), (2.00, 0.46, 1.15), (3.01, 0.26, 0.80),
            (4.18, 0.17, 0.52), (5.43, 0.10, 0.34), (6.79, 0.06, 0.22)]
tb = np.arange(0, 2.4, 1.0 / SR)
bell = np.zeros_like(tb)
for ratio, amp, decay in partials:
    bell += amp * np.exp(-decay * tb) * np.sin(2 * np.pi * f0 * ratio * tb)
bell /= max(np.abs(bell).max(), 1e-9)
bell *= 0.34

out = whoosh.copy()
i0 = int(T_STOP * SR)
out[i0:i0 + len(bell)] += bell[:len(out) - i0]

# ---- soothing low pad, swelling with the ascent ----
swell = np.clip(speed * 1.6, 0, 1) ** 0.6
pad_env = np.convolve(swell, np.hanning(int(SR * 1.6)) / np.hanning(int(SR * 1.6)).sum(), mode="same")
pad = (0.055 * np.sin(2 * np.pi * 110.0 * t)
       + 0.040 * np.sin(2 * np.pi * 164.81 * t + 0.4)
       + 0.026 * np.sin(2 * np.pi * 220.0 * t + 0.9)
       + 0.018 * np.sin(2 * np.pi * 329.63 * t + 1.7))
out += pad * (0.25 + 0.75 * pad_env)

# ---- master: fades, gentle soft-knee ----
out *= np.minimum(1.0, np.clip(t / 0.25, 0, 1))
out *= np.minimum(1.0, np.clip((DUR - t) / 0.7, 0, 1))
out = np.tanh(out * 1.25) / 1.25
peak = np.abs(out).max()
out = out / max(peak, 1e-9) * 0.89
stereo = np.stack([out, out], axis=1)

os.makedirs(".tmp/spin", exist_ok=True)
pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
with wave.open(".tmp/spin/audio.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("audio written: %d frames, peak %.3f" % (N, peak))
print("bell at t=%.2fs, spin %.2f->%.2f rev/s" % (T_STOP, REVOLUTIONS / INTEG, 0))
