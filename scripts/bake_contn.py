#!/usr/bin/env python3
# bake_contn.py — 継続撥音 (v_<v>_nn) の web 用 mp3 ベイク (正本手順)
#
# ネイティブ OnomatoiCore ConsonantSampleBank.prepareContN (v6) の忠実移植で
# wav マスターを整形してから mp3 化する。web は mp3 をオフセット 0 から再生する
# ため、**このベイクを通さないと頭の母音残留 (140-320ms) がそのまま鳴り、
# 「nun が nuun に聴こえる」母音ダブりになる** (2026-07-14 の教訓。
# 旧手順「末尾トリム→mp3」だけでは不足)。
#
# 手順: 鼻音 onset 検出 (スペクトル vowelness / 閉母音 i,u は RMS58% フォールバック)
#   → 頭切り onset−10ms → 尻尾切断 (ん定常−15dB+20ms) → 時変ゲイン正規化
#   (-19dBFS→-17.5dBFS ランプ) → 22.05kHz mono 48kbps mp3
#
# 実行: python3 scripts/bake_contn.py
#   (要 lame。マスター = ../Onomatoi/Resources/Consonants/v_<v>_nn.wav)

# ネイティブ ConsonantSampleBank.prepareContN (v6) の忠実移植
import wave, struct, math

def load_wav16(path):
    w = wave.open(path, "rb")
    sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
    d = struct.unpack(f"<{n*ch}h", w.readframes(n))
    w.close()
    if ch > 1: d = d[::ch]
    return [x / 32768.0 for x in d], sr

def trim_trailing_silence(a, th=0.004, keep_sec=0.01, sr=48000):
    end = len(a)
    while end > 1 and abs(a[end-1]) < th: end -= 1
    return a[:min(len(a), end + int(sr * keep_sec))]

def band_power(windowed, lo_k, hi_k, win):
    total = 0.0
    for k in range(lo_k, hi_k + 1):
        w = 2 * math.pi * k / win
        coeff = 2 * math.cos(w)
        s1 = s2 = 0.0
        for x in windowed:
            s0 = x + coeff * s1 - s2
            s2 = s1; s1 = s0
        total += s1*s1 + s2*s2 - coeff*s1*s2
    return total

def spectral_nasal_onset_idx(samples, sr, env_peak_idx, threshold_db=-15.0):
    hop = max(1, int(sr * 0.010)); win = max(4, int(sr * 0.030))
    if len(samples) <= win + hop: return None
    bin_hz = sr / win
    lo = (math.ceil(100.0/bin_hz), math.floor(400.0/bin_hz))
    hi = (math.ceil(800.0/bin_hz), math.floor(4000.0/bin_hz))
    if lo[0] > lo[1] or hi[0] > hi[1] or hi[1] >= win/2: return None
    hann = [0.5 - 0.5*math.cos(2*math.pi*j/(win-1)) for j in range(win)]
    vowelness = []
    i0 = 0
    while i0 + win <= len(samples):
        wd = [samples[i0+j]*hann[j] for j in range(win)]
        lo_p = max(1e-20, band_power(wd, lo[0], lo[1], win))
        hi_p = max(1e-20, band_power(wd, hi[0], hi[1], win))
        vowelness.append(10*math.log10(hi_p/lo_p))
        i0 += hop
    sustain = 5
    if len(vowelness) < sustain: return None
    pk = min(max(0, env_peak_idx), len(vowelness)-1)
    if vowelness[pk] < threshold_db + 5.0: return None
    for i in range(pk, len(vowelness)-sustain+1):
        if all(v < threshold_db for v in vowelness[i:i+sustain]): return i
    return None

def prepare_contn(raw, sr, head_db=-19.0, tail_db=-17.5, return_meta=False):
    trimmed = trim_trailing_silence(raw, sr=sr)
    if len(trimmed) <= int(sr*0.05): return (trimmed, {}) if return_meta else trimmed
    win = max(1, int(sr*0.010))
    env = []
    i0 = 0
    while i0 < len(trimmed):
        hi = min(len(trimmed), i0+win)
        env.append(math.sqrt(sum(v*v for v in trimmed[i0:hi]) / (hi-i0)))
        i0 = hi
    peak = max(env) if env else 0
    nasal_onset_sec, nasal_onset_idx, method = 0.10, min(len(env)-1, 10), "default"
    if peak > 0 and len(env) > 8:
        peak_idx = env.index(peak)
        s_idx = spectral_nasal_onset_idx(trimmed, sr, peak_idx)
        if s_idx is not None:
            nasal_onset_sec, nasal_onset_idx, method = s_idx*0.01, s_idx, "spectral"
        else:
            scan = max(1, peak_idx)
            if scan < len(env)-4:
                for i in range(scan, len(env)-4):
                    if all(e <= 0.58*peak for e in env[i:min(i+5, len(env))]):
                        nasal_onset_sec, nasal_onset_idx, method = i*0.01, i, "rms58"
                        break
        steady_end = min(len(env), nasal_onset_idx+12)
        if steady_end > nasal_onset_idx:
            steady = sum(env[nasal_onset_idx:steady_end]) / (steady_end-nasal_onset_idx)
            floor = steady * 0.178
            last_good = len(env)-1
            i = len(env)-1
            while i > nasal_onset_idx:
                if env[i] >= floor: last_good = i; break
                i -= 1
            cut = min(len(trimmed), (last_good+3)*win)
            if cut < len(trimmed): trimmed = trimmed[:cut]
    start_sec = max(0, nasal_onset_sec - 0.01)
    start_idx = min(len(trimmed)-1, int(start_sec*sr))
    arr = trimmed[start_idx:]
    # 時変ゲイン正規化: 包絡→ dBランプ (頭-19 → 尾-17.5)
    if len(arr) >= win*3:
        env2 = []
        i0 = 0
        while i0 < len(arr):
            hi = min(len(arr), i0+win)
            env2.append(max(1e-6, math.sqrt(sum(v*v for v in arr[i0:hi])/(hi-i0))))
            i0 = hi
        smooth = env2[:]
        for k in range(1, len(env2)-1): smooth[k] = (env2[k-1]+env2[k]+env2[k+1])/3
        n = len(arr)
        out = []
        for idx in range(n):
            t = idx/(n-1)
            target = 10 ** ((head_db + (tail_db-head_db)*t)/20)
            fpos = idx/win
            k0 = min(len(smooth)-1, int(fpos)); k1 = min(len(smooth)-1, k0+1)
            frac = fpos-k0
            e = smooth[k0]*(1-frac)+smooth[k1]*frac
            gain = min(10**(30/20), target/e)
            out.append(arr[idx]*gain)
        arr = out
    meta = {"onset_sec": nasal_onset_sec, "start_sec": start_sec, "method": method}
    return (arr, meta) if return_meta else arr

def save_wav16(path, a, sr):
    w = wave.open(path, "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(struct.pack(f"<{len(a)}h", *[max(-32768, min(32767, int(x*32767))) for x in a]))
    w.close()

if __name__ == "__main__":
    import subprocess, os, tempfile
    HERE = os.path.dirname(os.path.abspath(__file__))
    MASTERS = os.path.join(HERE, "../../Onomatoi/Resources/Consonants")
    OUT = os.path.join(HERE, "../ConsonantsOnomatoi")
    for v in "aiueo":
        src = os.path.join(MASTERS, f"v_{v}_nn.wav")
        with tempfile.TemporaryDirectory() as td:
            s16 = os.path.join(td, "s16.wav")
            # RX 出力等の WAVE_FORMAT_EXTENSIBLE も読めるよう ffmpeg で s16 化
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src,
                            "-ac", "1", "-sample_fmt", "s16", s16], check=True)
            a, sr = load_wav16(s16)
            prepared, meta = prepare_contn(a, sr, return_meta=True)
            # web 配信用の末尾フェード (60ms cos²): native は再生側の包絡がテイク終端を
            # 覆うが、web は正規化ランプ (-17.5dBFS まで持ち上げ) の終端がそのまま
            # ぶつ切りになる (短い i テイクで「リバース状に持ち上がって切れる」報告
            # 2026-07-14)。ベイクで終端を無音へ着地させる。
            import math as _math
            fade_n = min(len(prepared), int(sr * 0.060))
            for j in range(fade_n):
                t = (j + 1) / fade_n                      # 0→1 (終端で1)
                g = _math.cos(t * _math.pi / 2) ** 2      # 1→0
                prepared[len(prepared) - fade_n + j] *= g
            baked = os.path.join(td, "baked.wav")
            save_wav16(baked, prepared, sr)
            dst = os.path.join(OUT, f"v_{v}_nn.mp3")
            subprocess.run(["lame", "--quiet", "-m", "m", "--resample", "22.05",
                            "-b", "48", baked, dst], check=True)
            print(f"v_{v}_nn: onset={meta['onset_sec']*1000:.0f}ms ({meta['method']}) "
                  f"→ 整形後 {len(prepared)/sr:.2f}s → {os.path.basename(dst)}")
