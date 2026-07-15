// kou_properties.mjs — コウさんフィードバックの性質テスト (2026-07-12)
//
// 仕様の正本: Onomatoi/docs/FEEDBACK_2026-07-12_kou_phonetics_spec.md §4
// fixture:    Onomatoi/research/feedback/kou_2026-07-12.json (stroke 付き・決定的再生)
//
// 方式: iceface_onomatoi.html の <script> から純粋なエンジン宣言 (function/const/let で
// DOM/audio/storage に触れないもの) を自動抽出して vm で評価し、pointerup と同じ
// パイプライン (densified → extractAxes → handCorrection(0.5) → bucketedAxes(0.25) →
// strokeComplexity → drawK(0.125格子) → mannerProfile → sustained → segmentStroke →
// generateFromUnits / K整合ゲート×3) で fixture の描線を再生する。
//
// 判定は「語の完全一致」ではなく**性質** (破裂音を含む/歯茎硬口蓋を含まない等):
// 調整のたびに語が変わっても、コウさんの理由が満たされていれば green。
//
// 2層構造:
//   regression (👍) = 今も満たすべき性質。破れたら exit 1。
//   target     (👎) = 処方 P1〜P7 実装後に満たすべき性質。現状 FAIL は既知として報告のみ。
//                     STRICT=1 で enforce (全 green 達成後に昇格させる)。
//
// 実行: node test/kou_properties.mjs [fixture.json]
//
// 注意: 描線は正規化座標で保存されているため、再生キャンバスは 360×360 固定とする。
// 元端末のキャンバスが非正方の場合は縦横比が僅かに変わるが、性質判定には十分。

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(__dirname, "../iceface_onomatoi.html");
const DEFAULT_FIXTURE = path.resolve(
  __dirname, "../../Onomatoi/research/feedback/kou_2026-07-12.json");

// ─── 1. エンジン抽出 ───────────────────────────────────────────
// <script> 内のトップレベル宣言を、文字列/テンプレート/コメントを認識しながら
// ブロック単位で切り出す。DOM/audio/storage に触れる宣言は除外。

const IMPURE = /\b(document|localStorage|sessionStorage|window|navigator|AudioContext|audioCtx|fetch\(|canvas|cctx|location|alert\(|requestAnimationFrame|history)\b/;

function extractEngine(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (scripts.length === 0) throw new Error("no <script> found");
  const src = scripts.sort((a, b) => b.length - a.length)[0];

  const blocks = [];
  const lines = src.split("\n");
  // 行頭 (column 0) の宣言開始を探し、括弧バランスで終端まで読む
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
          if (inLC) break;                       // 行コメントは行末まで
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
          // 関数本体の閉じ } まで読み終えた (開始行だけの depth 0 は除外)
          if (/\}/.test(lines.slice(i, j + 1).join("\n"))) { end = j; break; }
        }
        if (isFunc && depth === 0 && j === i && /\{[\s\S]*\}\s*$/.test(line)) { end = j; break; }
      }
      if (end < 0) end = i;   // 変則行は1行だけ拾って先へ (安全側)
      const block = lines.slice(start, end + 1).join("\n");
      blocks.push(block);
      i = end + 1;
      continue;
    }
    i++;
  }

  const pure = blocks.filter(b => !IMPURE.test(b));
  return pure.join("\n\n");
}

const engineSrc = extractEngine(fs.readFileSync(HTML_PATH, "utf8"));
const EXPORTS = ["extractAxes", "applyHandCorrection", "bucketedAxes", "densified",
  "splineDensified", "strokeComplexity", "drawK", "mannerProfile", "segmentStroke",
  "unitEligible", "generateFromUnits", "generate", "axesSeed", "mulberry32",
  "wordK", "romajiOf"];
const ctx = vm.createContext({ console });
vm.runInNewContext(
  engineSrc + `\n;globalThis.__api = { ${EXPORTS.join(", ")} };`,
  ctx, { filename: "engine(extracted)" });
const api = ctx.__api;
for (const name of EXPORTS) {
  if (typeof api[name] !== "function") throw new Error(`engine 抽出失敗: ${name} が見つからない`);
}

// ─── 2. fixture 再生 ───────────────────────────────────────────
//
// 主判定 = recorded モード: 当時のパイプラインが計算して fixture に保存した導出値
// (axes / k / cor / cs / lp) を生成段への入力にする。子音・母音・語形の選択段
// (処方 P2/P3/P4/P6/P7 の対象) を、幾何の再導出誤差なしで検証できる。
// ※元端末のキャンバス寸法は fbVersion 4 に未記録のため、stroke からの完全再導出は
//   スケール依存段 (角検出・densify) が 1 バケット程度ずれる — こちらは参考表示のみ
//   (P1/P5 = 幾何段の処方の検証には canvas 寸法の記録 (fbVersion 5) が必要)。

const W = 360, H = 360, HAND_CORR = 0.5;

/// 生成段 (pointerup 後半 = generateAndPlay の K 整合ゲート込み) の共通再現。
function runGeneration(ax, kDraw, cor, cs, loops, moraCount, sustained) {
  const mDraw = api.mannerProfile(ax.sharp, cor, cs, ax.tex, loops);
  const opts = { moraCountOverride: moraCount, kiki: kDraw, manner: mDraw,
                 sustained, lengthHint: moraCount };
  let best = null, bestD = Infinity;
  for (let a = 0; a < 3; a++) {
    const rand = api.mulberry32(api.axesSeed(ax, a));
    const ev = api.generate(ax, rand, 0.4, opts);
    const d = Math.abs(api.wordK(ev.moras) - opts.kiki);
    if (d < bestD) { best = ev; bestD = d; }
    if (d <= 0.35) break;
  }
  return best;
}

/// pointerup と同じ sustained 判定 (moraCount 以外は fixture に記録済み)。
function sustainedOf(rec, moraCount) {
  return rec.lp <= 1 && rec.cor <= 2 && rec.cs < 0.35
    && rec.axes.t < 0.3 && moraCount >= 2;
}

/// recorded モード: fixture の導出値を生成段へ。
/// cx.moraCount だけは fbVersion 4 に未記録 → **rec.word をチェックサムに 1..16 を
/// 探索して復元** (キャリブレーション)。エンジンが記録時から不変なら必ず一致する。
/// 一致が見つからない場合 = 記録後にエンジンが変わった (または fixture が別エンジン) —
/// rec.mora を近似に使い calibrated=false で報告する。
function replayRecorded(rec) {
  const a = rec.axes;
  const ax = { size: a.s, sharp: a.sh, tex: a.t, bright: a.b, round: a.r, open: a.o };
  // mc 注記 (fbVersion5 `mc` の前倒し・curator 永続化) があれば探索不要でそのまま使う。
  // これによりエンジンが記録時から変わっても「コウさん端末由来の正確な入力」で
  // 新エンジンを judged できる (キャンバス寸法差のある stroke 再導出より強い判定)。
  if (typeof rec.mc === "number") {
    const ev = runGeneration(ax, rec.k, rec.cor, rec.cs, rec.lp, rec.mc,
                             sustainedOf(rec, rec.mc));
    return { event: ev, ax, mc: rec.mc, calibrated: true, pinned: true };
  }
  for (let mc = 1; mc <= 16; mc++) {
    const ev = runGeneration(ax, rec.k, rec.cor, rec.cs, rec.lp, mc, sustainedOf(rec, mc));
    if (api.romajiOf(ev) === rec.word) return { event: ev, ax, mc, calibrated: true };
  }
  const mc = rec.mora;
  const event = runGeneration(ax, rec.k, rec.cor, rec.cs, rec.lp, mc, sustainedOf(rec, mc));
  return { event, ax, mc, calibrated: false };
}

/// stroke モード (参考): 描線から全段再導出。キャンバス寸法差で1バケットずれ得る。
function replayFromStroke(rec) {
  const beads = rec.stroke.map(([x, y]) => ({ x: x * W, y: y * H }));
  const inkPts = beads.length >= 2 ? api.densified(beads, 6) : beads;
  if (inkPts.length < 2) throw new Error("stroke too short");
  const raw = api.extractAxes(inkPts, W, H);
  let ax = api.applyHandCorrection(raw, HAND_CORR, false);   // coarse: dampenTexture=false
  ax = api.bucketedAxes(ax, 0.25);
  // P1: 角検出だけスプライン再構成幾何 (pointerup と同じ分岐)
  const geomPts = beads.length >= 3 ? api.splineDensified(beads, 6) : inkPts;
  const cx = api.strokeComplexity(geomPts, W, H, 16);
  let kDraw = api.drawK(ax.sharp, cx.corners, cx.cornerSharpness);
  kDraw = Math.round(kDraw / 0.125) * 0.125;
  const seg = api.segmentStroke(inkPts);
  let event;
  if (api.unitEligible(seg)) {
    const mDraw = api.mannerProfile(ax.sharp, cx.corners, cx.cornerSharpness, ax.tex, cx.loops);
    event = api.generateFromUnits(seg.units, W, H, ax, kDraw, 0.4, mDraw);
  } else {
    const sustained = cx.loops <= 1 && cx.corners <= 2 && cx.cornerSharpness < 0.35
      && ax.tex < 0.3 && cx.moraCount >= 2;
    event = runGeneration(ax, kDraw, cx.corners, cx.cornerSharpness, cx.loops,
                          cx.moraCount, sustained);
  }
  return { event, ax, cx, kDraw };
}

// ─── 3. 性質の登録 (spec §4) ─────────────────────────────────────

const PLOSIVE = new Set(["p", "t", "k", "b", "d", "g"]);           // ky/gy は拗音として別扱い
const ALVEOLO_PALATAL = new Set(["sh", "j", "ch"]);                // 歯茎硬口蓋
const PALATALIZED = new Set(["ky", "gy", "ny"]);                   // 拗音 (Cy)
const VOICELESS_FRIC = new Set(["s", "sh", "f", "h"]);             // 清音の摩擦
const onsets = ev => ev.moras.map(m => m.onset).filter(c => c !== null);
const nuclei = ev => ev.moras.filter(m => !m.isN).map(m => m.nucleus);
const hasOnset = (ev, set) => onsets(ev).some(c => set.has(c));
const endsWithN = ev => ev.moras.length > 0 && ev.moras[ev.moras.length - 1].isN;

// tier は fixture の vote から自動 (+1=regression / -1=target)。
const PROPERTIES = {
  "mrfxxez7-3": {  // 丸 → aaaa 👍
    desc: "onset なし母音 run のまま (全モーラ onset=null)",
    check: ev => ev.moras.every(m => m.onset === null),
  },
  "mrgv5r43-1": {  // 丸 → joooo 👎
    desc: "onset に歯茎硬口蓋 (sh/j/ch) を含まない",
    check: ev => !hasOnset(ev, ALVEOLO_PALATAL),
  },
  "mrgv8z6l-3": {  // 縦線 → fun 👍
    desc: "先頭母音 u + 語末ん を保つ",
    check: ev => nuclei(ev)[0] === "u" && endsWithN(ev),
  },
  "mrgv9lk7-5": {  // 双こぶ山 → gyagigyogo 👎
    desc: "拗音 (ky/gy) と歯茎硬口蓋を使わない (軟口蓋 plain・母音は可)",
    check: ev => !hasOnset(ev, PALATALIZED) && !hasOnset(ev, ALVEOLO_PALATAL),
  },
  "mrgvewbq-1": {  // 緩い波 → nyoo 👍
    desc: "拗音鼻音 ny を保ち破裂音なし",
    check: ev => onsets(ev)[0] === "ny" && !hasOnset(ev, PLOSIVE),
  },
  "mrgvfeao-4": {  // 3こぶ波 → iiiii 👎
    desc: "onset を持つモーラが過半 (母音裸列にしない)",
    check: ev => ev.moras.filter(m => m.onset !== null).length > ev.moras.length / 2,
  },
  "mri8a7zz-2": {  // 長方形 → jon 👎
    desc: "破裂音 (p/t/k/b/d/g) を1つ以上含む",
    check: ev => hasOnset(ev, PLOSIVE),
  },
  "mriaoc95-1": {  // ドーム弧 → mii 👎
    desc: "両唇鼻音 m を保持 + 広母音 a 主体 + 語末ん",
    check: ev => hasOnset(ev, new Set(["m"]))
      && nuclei(ev).filter(v => v === "a").length >= nuclei(ev).length / 2
      && endsWithN(ev),
  },
  "mrib3e1u-1": {  // 流れるS字 → dunburi 👎
    desc: "破裂音を含まず、清音摩擦 (s/sh/f/h) で始まる",
    check: ev => !hasOnset(ev, PLOSIVE) && VOICELESS_FRIC.has(onsets(ev)[0]),
  },
  // ─── 第2ラウンド (2026-07-14・P1配備後): 幾何は正常化・残るは選択層 ───
  "mrkopj63-1": {  // 大きな四角 → bun 👎 (破裂音は出た・母音が課題)
    desc: "破裂音を維持しつつ、開放の大四角は母音 a 主体 (P9 母音の意味論: あ=開放・拡張)",
    check: ev => hasOnset(ev, PLOSIVE)
      && nuclei(ev).filter(v => v === "a").length >= nuclei(ev).length / 2,
  },
  "mrkoxd9n-1": {  // 鋭いジグザグ → gyapeen 👍
    desc: "鋭形に破裂音を含む (P1+manner の成功動作を回帰固定)",
    check: ev => hasOnset(ev, PLOSIVE),
  },
  "mrkoztb2-1": {  // 3連アーチ → gyuuuu 👎 (拗音+う には到達・濁音が違反)
    desc: "濁阻害音 (g/gy/z/j/d/b) を onset に使わない (P4: 第1回#6「濁音でない拗音+う」)",
    check: ev => !hasOnset(ev, new Set(["g", "gy", "z", "j", "d", "b"])),
  },
  "mrkp33vp-4": {  // 閉じた丸 → noooo 👍 (「最後は n でも良いかも」は任意メモ)
    desc: "破裂音・歯茎硬口蓋なし + 共鳴音 onset (丸の成功動作を回帰固定)",
    check: ev => !hasOnset(ev, PLOSIVE) && !hasOnset(ev, ALVEOLO_PALATAL)
      && ["n", "ny", "m", "w", "y", "r"].includes(onsets(ev)[0]),
  },
  // ─── 第3ラウンド (2026-07-15): i の統語論 (位置文法) ───
  "mrlacsw0-1": {  // 鋭ジグザグ → dizidozo 👎 (全文受領で立法完成・提案語 digaziba)
    // P10 言いやすさの制約: 「続くと言いづらい言葉は、定着しにくい」。
    // di→zi (歯茎→歯茎×同母音i) が違反、digaziba (d歯茎→g軟口蓋→z歯茎→b唇 ×
    // i-a-i-a 交替) が模範。gibiin (gi軟口蓋→bi唇) が 👍 だった謎もこれで解ける。
    // 音韻論の OCP (必異原理) と同型 = [普遍] の裏付けを持つ [慣習] 立法。
    desc: "P10 言いやすさ v1.1: 隣接 CV が 阻害音同士×異調音方法×同位置×同母音 を"
      + "繰り返さない (di→zi 禁止・ここ/ただ/さざ/まわ は許容)",
    check: ev => {
      const PLACE = { p: "lab", b: "lab", m: "lab", f: "lab", w: "lab", my: "lab",
                      t: "alv", d: "alv", s: "alv", z: "alv", n: "alv", r: "alv", ts: "alv",
                      sh: "pal", j: "pal", ch: "pal", y: "pal", ny: "pal",
                      k: "vel", g: "vel", ky: "palvel", gy: "palvel", h: "glo" };
      const MANNER = { k: "p", g: "p", t: "p", d: "p", p: "p", b: "p", ky: "p", gy: "p",
                       ts: "a", ch: "a", j: "a", s: "f", sh: "f", z: "f", h: "f", f: "f" };
      const SONORANT = new Set(["m", "n", "ny", "r", "w", "y", "my"]);
      for (let i = 1; i < ev.moras.length; i++) {
        const a = ev.moras[i - 1], b = ev.moras[i];
        if (a.onset && b.onset && a.onset !== b.onset && !a.isN && !b.isN
            && !SONORANT.has(a.onset) && !SONORANT.has(b.onset)
            && MANNER[a.onset] !== MANNER[b.onset]
            && a.nucleus === b.nucleus && PLACE[a.onset] === PLACE[b.onset]) return false;
      }
      return true;
    },
  },
  "mrlb56vr-1": {  // ジグザグ+終端カーブ → gibiin 👍「最後の曲線に いいん は非常に良い」
    desc: "鋭形+終端カーブ: 語末は 伸ばした i + ん の着地を保つ (P9 実地承認の回帰固定)",
    check: ev => endsWithN(ev)
      && ev.moras.some(m => m.onset === null && !m.isN && m.nucleus === "i"),
  },
  "mrlbrr6f-1": {  // 3連アーチ → bigibogo 👎「丸始まりに語頭 i は不適・a/u/o で始めよ」
    desc: "丸みから始まる描線: 先頭モーラの母音は a/u/o (語中の i 焦点化は可)",
    check: ev => ["a", "u", "o"].includes(nuclei(ev)[0]),
  },
};

// ─── 4. P1 幾何サニティ (角検出の判別力・regression 扱いで enforce) ─────
// spec P1 の契約: 偽の角 (滑らかな反転・波のこぶ) が corners に入らないこと +
// 真の角 (多角形の頂点) が失われないこと。fixture ストローク + 合成図形で固定。

const fixturePath = process.argv[2] ?? DEFAULT_FIXTURE;
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const strict = process.env.STRICT === "1";
const byId = Object.fromEntries(fixture.records.map(r => [r.id, r]));

function cxOfBeads(beads) {
  const pts = beads.map(([x, y]) => ({ x: x * W, y: y * H }));
  const geomPts = pts.length >= 3 ? api.splineDensified(pts, 6) : pts;
  return api.strokeComplexity(geomPts, W, H, 16);
}
function cxOfPts(pts) {
  return api.strokeComplexity(api.splineDensified(pts, 6), W, H, 16);
}
const zigzagPts = [];
for (let i = 0; i <= 6; i++) zigzagPts.push({ x: 40 + i * 45, y: i % 2 === 0 ? 250 : 120 });
const sinePts = [];
for (let i = 0; i <= 30; i++) {
  const t = i / 30;
  sinePts.push({ x: 30 + t * 300, y: 200 + Math.sin(t * Math.PI * 3) * 70 });
}
const GEOM_CHECKS = [
  ["長方形 #7: 真の角 3 個以上", () => cxOfBeads(byId["mri8a7zz-2"].stroke).corners >= 3],
  ["長方形 #7: cornerSharpness ≥ 0.1", () => cxOfBeads(byId["mri8a7zz-2"].stroke).cornerSharpness >= 0.1],
  ["S字 #9: 偽の角 ≤ 1", () => cxOfBeads(byId["mrib3e1u-1"].stroke).corners <= 1],
  ["3こぶ波 #6: 角 0", () => cxOfBeads(byId["mrgvfeao-4"].stroke).corners === 0],
  ["双こぶ #4: 谷だけ = 角 1", () => cxOfBeads(byId["mrgv9lk7-5"].stroke).corners === 1],
  ["丸 #1: 角 0", () => cxOfBeads(byId["mrfxxez7-3"].stroke).corners === 0],
  ["合成ジグザグ: 角ちょうど 5・cs ≥ 0.3", () => {
    const cx = cxOfPts(zigzagPts); return cx.corners === 5 && cx.cornerSharpness >= 0.3; }],
  ["合成正弦波: 角 0", () => cxOfPts(sinePts).corners === 0],
];
let geomFail = 0;
console.log("\nP1 幾何サニティ (角検出の判別力):");
for (const [label, fn] of GEOM_CHECKS) {
  let ok = false;
  try { ok = fn(); } catch { ok = false; }
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok) geomFail++;
}

// ─── 5. fixture 性質テストの実行・レポート ─────────────────────────

let regressFail = 0, targetFail = 0, targetPass = 0, errors = 0;
const rows = [];
for (const rec of fixture.records) {
  const prop = PROPERTIES[rec.id];
  const tier = rec.vote === 1 ? "regression" : "target";
  if (!prop) { rows.push([rec.id, tier, rec.word, "-", "⚠ 性質が未登録"]); continue; }
  let word = "?", strokeWord = "-", ok = false, note = "", match = "";
  try {
    const rr = replayRecorded(rec);
    let event = rr.event;
    let stroke = null;
    try { stroke = replayFromStroke(rec); strokeWord = api.romajiOf(stroke.event); } catch { }
    if (rr.pinned) {
      match = ` (mc=${rr.mc} 固定・recorded判定)`;
    } else if (rr.calibrated) {
      match = ` (mc=${rr.mc} で当時と一致)`;
    } else if (stroke) {
      // recorded モードで復元不能 = 単位語経路 (generateFromUnits) か記録後のエンジン変化。
      // stroke 再導出 (キャンバス寸法差あり) を判定に使う。
      event = stroke.event;
      match = " (⚠未較正→stroke再導出で判定: 単位語経路 or エンジン変化)";
    } else {
      match = ` (⚠未較正: mc=${rr.mc} 近似)`;
    }
    word = api.romajiOf(event);
    ok = prop.check(event);
  } catch (e) {
    note = `💥 ${e.message}`; errors++;
  }
  if (!note) {
    if (tier === "regression") {
      note = ok ? "✅ PASS" : "❌ FAIL (回帰!)";
      if (!ok) regressFail++;
    } else {
      note = ok ? "🎉 PASS (先行達成)" : "🔴 FAIL (既知・処方待ち)";
      ok ? targetPass++ : targetFail++;
    }
  }
  rows.push([rec.id, tier,
    `${rec.word} → ${word}${match}  [stroke再導出: ${strokeWord}]`, prop.desc, note]);
}

console.log(`\nコウさん性質テスト  (fixture: ${path.basename(fixturePath)}, engine: 再現パイプライン ${W}×${H})\n`);
for (const [id, tier, words, desc, note] of rows) {
  console.log(`  ${note.padEnd(18)} [${tier.padEnd(10)}] ${id}`);
  console.log(`      当時→今日: ${words}`);
  console.log(`      性質: ${desc}\n`);
}
console.log(`  幾何サニティ破れ: ${geomFail} / regression 破れ: ${regressFail} / target 既知FAIL: ${targetFail} / target 先行達成: ${targetPass} / エラー: ${errors}\n`);

if (geomFail > 0 || regressFail > 0 || errors > 0 || (strict && targetFail > 0)) process.exit(1);
console.log(strict ? "STRICT: all green ✅" : "幾何+regression green ✅ (target は処方 P2〜P7 の進捗指標)");
