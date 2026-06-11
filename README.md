# Iceface Onomatopian — Web (self-contained)

**▶ Play: https://iceface-microtonal.github.io/onomatopian/**

Phonosymbolic Topology Synthesizer の簡易 Web 版。このフォルダ単体で完結する
(iPad 版 v0.4 からの移植。音程変化なし / WARABE なし / COMPOSE なし)。

## 内容

- `iceface_onomatopian.html` — アプリ本体 (単一ファイル、依存ライブラリなし)
- `index.html` — ルート URL からのリダイレクト
- `Consonants/` — 音声サンプル 107 mp3 (cv_* / v_* / n_N、48kbps mono、計約 900KB)

## 動かし方

wav を fetch するため file:// 直開きは不可。HTTP で配信する:

```bash
cd "このフォルダ"
python3 -m http.server 8765
# → http://localhost:8765/ を開く
```

Web サーバ (静的ホスティング) にフォルダごとアップロードすればそのまま動く。
サンプル (約 900KB) はページを開いた直後から並列読込される。

## 使い方

- **描く** — キャンバスに 1 ストローク描くと 4 軸 (size/sharp/texture/bright) を抽出し、
  シニフィアンを生成・発声する。同じ描写は同じ語になる (決定的生成)。
- **TUNE** — スライダーで軸を直接いじって ▶ PLAY。
- **プリセット** — bouba/kiki/maluma/takete + 日本語オノマトペ 6 種。
  初回タップは正確な発音、2 回目以降はタップごとに違う変奏。
- **ROMAJI 直接入力** — 空白区切り (促音=Q, 撥音=N, 拗音=kya 等, ち=chi)。
- **LOG** — 行をタップするとそのシニフィアンそのものを再生。
