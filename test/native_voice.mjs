// native_voice.mjs — v13 native 音声レンダラ (FormantSynth 移植) の性質テスト (2026-07-16)
//
// 方式: kou_properties.mjs と同じ「<script> から純粋宣言を抽出して vm 評価」。
// 音声は合成波形 (サイン波の疑似テイク) で駆動し、以下を固定する:
//   1. 振り分け: 母音根の拡張 run (aauu 等) が長尺録音 cvDiph 経路に乗る (core v8 同等)
//      単独ペア (ai) は生 diph のまま / 子音根 (saai) は従来どおり
//   2. nvPrepareCvDiph: 整形後のレベル (頭 -12dBFS 付近) と第2母音の復元
//   3. nvRenderEvent: aauu / an / ai の語中に無音級の谷 (テイク境界の途切れ) が無い
//   4. 促音 isQ の音価 (60ms) が量子化で保存される
//
// 実行: node test/native_voice.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(__dirname, "../iceface_onomatoi.html");

// ─── エンジン抽出 (kou_properties.mjs と同一のミニ抽出器) ───
const IMPURE = /\b(document|localStorage|sessionStorage|window|navigator|AudioContext|audioCtx|fetch\(|canvas|cctx|location|alert\(|requestAnimationFrame|history)\b/;

function extractEngine(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (scripts.length === 0) throw new Error("no <script> found");
  const src = scripts.sort((a, b) => b.length - a.length)[0];
  const blocks = [];
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^(function\s+\w|const\s+\w|let\s+\w)/.test(line)) {
      const start = i;
      const isFunc = line.startsWith("function");
      let depth = 0, inS = null, inLC = false, inBC = false, tplBrace = [];
      let end = -1;
      outer:
      for (let j = i; j < lines.length; j++) {
        const l = lines[j];
        for (let k = 0; k < l.length; k++) {
          const c = l[k], p = k > 0 ? l[k - 1] : "";
          if (inLC) break;
          if (inBC) { if (p === "*" && c === "/") inBC = false; continue; }
          if (inS) {
            if (c === "\\") { k++; continue; }
            if (inS === "`" && c === "$" && l[k + 1] === "{") { tplBrace.push(depth); inS = null; k++; depth++; continue; }
            if (c === inS) inS = null;
            continue;
          }
          if (c === "/" && l[k + 1] === "/") { inLC = true; continue; }
          if (c === "/" && l[k + 1] === "*") { inBC = true; k++; continue; }
          if (c === '"' || c === "'" || c === "`") { inS = c; continue; }
          if (c === "{" || c === "(" || c === "[") { depth++; continue; }
          if (c === "}" || c === ")" || c === "]") {
            depth--;
            if (tplBrace.length && depth === tplBrace[tplBrace.length - 1]) { tplBrace.pop(); inS = "`"; }
            continue;
          }
          if (!isFunc && c === ";" && depth === 0) { end = j; break outer; }
        }
        inLC = false;
        if (isFunc && depth === 0 && j > i) {
          if (/\}/.test(lines.slice(i, j + 1).join("\n"))) { end = j; break; }
        }
        if (isFunc && depth === 0 && j === i && /\{[\s\S]*\}\s*$/.test(line)) { end = j; break; }
      }
      if (end < 0) end = i;
      blocks.push(lines.slice(start, end + 1).join("\n"));
      i = end + 1;
      continue;
    }
    i++;
  }
  return blocks.filter(b => !IMPURE.test(b)).join("\n\n");
}

const engineSrc = extractEngine(fs.readFileSync(HTML_PATH, "utf8"));
const EXPORTS = ["segmentWord", "nvQuantizeMoras", "nvVowelRunRootHasOnset",
  "nvExtendedVRunTakesCvDiph", "nvVvDiphPart1Takes", "nvCvDiphPrev", "nvDiphContext",
  "nvLongVowelExtension", "nvNextUsesCVtoVDiph", "nvPrepareCvDiph",
  "nvTrimTrailingSilence", "nvSustainWrap", "nvRenderEvent", "nvInterp"];
const ctx = vm.createContext({ console });
vm.runInNewContext(engineSrc + `\n;globalThis.__api = { ${EXPORTS.join(", ")} };`,
  ctx, { filename: "engine(extracted)" });
const api = ctx.__api;
for (const name of EXPORTS) {
  if (api[name] === undefined) throw new Error(`engine 抽出失敗: ${name} が見つからない`);
}

// ─── テストハーネス ───
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}
const db = x => 20 * Math.log10(Math.max(1e-9, x));

// ─── 合成テイク ───
const SR = 48000;
function sine(durSec, freq, amp, attackMs = 10) {
  const n = Math.round(durSec * SR);
  const arr = new Float32Array(n);
  const atk = Math.round(attackMs / 1000 * SR);
  for (let i = 0; i < n; i++) {
    const a = i < atk ? i / atk : 1;
    arr[i] = Math.sin(2 * Math.PI * freq * i / SR) * amp * a;
  }
  return arr;
}
// 長尺 diph 録音の模擬: V1 定常 → グライド → V2 定常 (小さい) → 減衰
function synthLongDiphRaw() {
  const seg1 = sine(0.30, 220, 0.10);          // V1 (-20dBFS)
  const seg2 = sine(0.10, 275, 0.06);          // 移行
  const seg3 = sine(0.45, 330, 0.02, 1);       // V2 (-34dBFS: 第2母音は小さく録れている)
  const tail = new Float32Array(Math.round(0.15 * SR));
  for (let i = 0; i < tail.length; i++) {
    const u = 1 - i / tail.length;
    tail[i] = Math.sin(2 * Math.PI * 330 * i / SR) * 0.02 * u * u;
  }
  const out = new Float32Array(seg1.length + seg2.length + seg3.length + tail.length);
  out.set(seg1, 0);
  out.set(seg2, seg1.length);
  out.set(seg3, seg1.length + seg2.length);
  out.set(tail, seg1.length + seg2.length + seg3.length);
  return out;
}

function makeBank() {
  const bank = { sr: SR, cv: new Map(), v: new Map(), nN: null, contN: new Map(),
                 diph: new Map(), cvDiph: new Map(), longDiph: new Set() };
  bank.v.set("a", sine(1.0, 200, 0.15));
  bank.v.set("u", sine(1.0, 300, 0.15));
  bank.v.set("i", sine(1.0, 320, 0.15));
  bank.cv.set("s|a", sine(0.5, 210, 0.15));
  bank.nN = sine(0.6, 150, 0.10);
  bank.contN.set("a", sine(0.6, 160, 0.10, 1));   // ベイク済み相当 (頭から鼻音定常)
  for (const p of ["ai", "au", "ei", "oi", "ou"]) {
    bank.diph.set(p, sine(0.6, 250, 0.12));
    const prepared = api.nvPrepareCvDiph(synthLongDiphRaw(), SR);
    bank.cvDiph.set(p, prepared);
    bank.longDiph.add(p);
  }
  return bank;
}

function rmsWindows(data, sr, winSec = 0.02) {
  const win = Math.round(winSec * sr);
  const out = [];
  for (let i = 0; i + win <= data.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += data[j] * data[j];
    out.push({ tMs: i / sr * 1000, db: db(Math.sqrt(s / win)) });
  }
  return out;
}

const MORA_MS = 250;
const q = w => api.nvQuantizeMoras(api.segmentWord(w), MORA_MS);

console.log("── 1. 振り分け (core v8 同等) ──");
{
  const bank = makeBank();
  for (const w of ["aauu", "aaii", "oouu", "eeii", "ooii"]) {
    const ms = q(w);
    check(`${w}: 4モーラ`, ms.length === 4, `got ${ms.length}`);
    check(`${w}: 境界を生 diph が取らない`,
          !api.nvVvDiphPart1Takes(1, ms, bank));
    const c2 = api.nvCvDiphPrev(2, ms, bank);
    const c3 = api.nvCvDiphPrev(3, ms, bank);
    check(`${w}: モーラ3/4 が cvDiph 経路`, !!c2 && !!c3,
          JSON.stringify({ c2: !!c2, c3: !!c3 }));
    check(`${w}: 先行オーバーラップ発火`, api.nvNextUsesCVtoVDiph(1, ms, bank));
  }
  const ai = q("ai");
  check("ai (単独ペア): 生 diph のまま", api.nvVvDiphPart1Takes(0, ai, bank));
  check("ai (単独ペア): cvDiph に取られない", api.nvCvDiphPrev(1, ai, bank) === null);
  const saai = q("saai");
  check("saai (子音根): cvDiph 経路は従来どおり",
        api.nvCvDiphPrev(saai.length - 1, saai, bank) !== null);
}

console.log("── 2. nvPrepareCvDiph (整形) ──");
{
  const prepared = api.nvPrepareCvDiph(synthLongDiphRaw(), SR);
  check("整形後も十分な長さ", prepared.length > 0.5 * SR, `${prepared.length / SR}s`);
  const w = rmsWindows(prepared, SR);
  const head = w.slice(0, 5).reduce((a, b) => a + b.db, 0) / 5;
  check("頭が -12dBFS 付近 (±4dB)", Math.abs(head - (-12 - 3)) < 7, `head=${head.toFixed(1)}dB`);
  const late = w.filter(x => x.tMs > (prepared.length / SR * 1000) * 0.55 &&
                             x.tMs < (prepared.length / SR * 1000) * 0.85);
  const lateMean = late.reduce((a, b) => a + b.db, 0) / late.length;
  check("第2母音が復元されている (-24dB 以上)", lateMean > -24, `late=${lateMean.toFixed(1)}dB`);
  let peak = 0;
  for (const v of prepared) peak = Math.max(peak, Math.abs(v));
  check("クリップしない", peak <= 1.0, `peak=${peak.toFixed(2)}`);
}

console.log("── 3. 実レンダ: 語中に無音級の谷が無い ──");
{
  const bank = makeBank();
  for (const [w, holeFrom, holeTo] of [["aauu", 40, 750], ["ai", 40, 400], ["an", 40, 420]]) {
    const ms = api.segmentWord(w);
    const res = api.nvRenderEvent(ms, bank, SR, MORA_MS);
    check(`${w}: レンダ成功`, !!res && res.data.length > 0);
    if (!res) continue;
    const wins = rmsWindows(res.data, SR);
    const core = wins.filter(x => x.tMs >= holeFrom && x.tMs <= holeTo);
    const minDb = Math.min(...core.map(x => x.db));
    check(`${w}: ${holeFrom}〜${holeTo}ms に -45dB 未満の谷なし`, minDb > -45,
          `min=${minDb.toFixed(1)}dB`);
    let peak = 0;
    for (const v of res.data) peak = Math.max(peak, Math.abs(v));
    check(`${w}: クリップしない`, peak <= 1.0, `peak=${peak.toFixed(2)}`);
  }
}

console.log("── 4. 促音の音価 (量子化) ──");
{
  const pa = api.segmentWord("paQ");
  const qm = api.nvQuantizeMoras(pa, MORA_MS);
  const last = qm[qm.length - 1];
  check("語末っ (isQ) が存在", !!last.isQ, JSON.stringify(pa.map(m => m.isQ)));
  if (last.isQ) {
    check("isQ は原寸 (60ms) のまま", last.durationMs === 60, `got ${last.durationMs}`);
  }
  const kutta = api.segmentWord("kutta");
  const qk = api.nvQuantizeMoras(kutta, MORA_MS);
  const gapped = qk.find(m => m.gapMs > 0);
  check("語中促音の gap は 1 拍へ量子化", !!gapped && gapped.gapMs === MORA_MS,
        JSON.stringify(qk.map(m => m.gapMs)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
