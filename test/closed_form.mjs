// closed_form.mjs — Step1 閉形の正準化の性質テスト (2026-07-17)
//
// 方針 (Icefaceさん 2026-07-17): ブーバ/キキは「見えた、完成された形」の印象 —
// 軌跡は正確に測るが、最終的な重みは出来上がった形。Step1 = 閉じたストロークを
// 輪郭として正準化 (終端スナップ + 最直線位置への回転) し、描き始めの頂点も
// 他の角と同じ規則で数える。始点・描く向きに不変。
//
// 発端 fixture: 三角レポート mrnqm2sk-32 (research/feedback/iceface_2026-07-16_triangle.json)
// — 頂点で描き切った三角が角2 (頂点欠損) で rodorada になっていた。
//
// 実行: node test/closed_form.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(__dirname, "../iceface_onomatoi.html");
const IMPURE = /\b(document|localStorage|sessionStorage|window|navigator|AudioContext|audioCtx|fetch\(|canvas|cctx|location|alert\(|requestAnimationFrame|history)\b/;

function extractEngine(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const src = scripts.sort((a, b) => b.length - a.length)[0];
  const blocks = [];
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^(function\s+\w|const\s+\w|let\s+\w)/.test(line)) {
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
      blocks.push(lines.slice(start_or(i), end + 1).join("\n"));
      i = end + 1;
      continue;
    }
    i++;
  }
  function start_or(x) { return x; }
  return blocks.filter(b => !IMPURE.test(b)).join("\n\n");
}

const engineSrc = extractEngine(fs.readFileSync(HTML_PATH, "utf8"));
const EXPORTS = ["strokeComplexity", "splineDensified", "densified", "extractAxes",
  "applyHandCorrection", "bucketedAxes", "circleVocabSignal"];
const ctx = vm.createContext({ console });
vm.runInNewContext(engineSrc + `\n;globalThis.__api = { ${EXPORTS.join(", ")} };`, ctx,
  { filename: "engine(extracted)" });
const api = ctx.__api;
for (const name of EXPORTS) {
  if (api[name] === undefined) throw new Error(`engine 抽出失敗: ${name}`);
}

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

const W = 360, H = 360;
function cxOf(beads) {
  return api.strokeComplexity(api.splineDensified(beads, 6), W, H, 16);
}
function jittered(pts, amp = 1.5) {
  let s = 0x12345678;
  const rnd = () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  return pts.map(p => ({ x: p.x + (rnd() * 2 - 1) * amp, y: p.y + (rnd() * 2 - 1) * amp }));
}

// ─── 実レポートの三角 (mrnqm2sk-32・頂点から描き切り) ───
const TRI = [[0.456,0.151],[0.431,0.171],[0.397,0.245],[0.371,0.294],[0.344,0.346],[0.317,0.397],[0.295,0.442],[0.276,0.483],[0.252,0.533],[0.295,0.55],[0.34,0.55],[0.393,0.55],[0.446,0.55],[0.498,0.55],[0.543,0.55],[0.583,0.55],[0.617,0.55],[0.655,0.546],[0.647,0.494],[0.629,0.455],[0.607,0.4],[0.582,0.346],[0.556,0.294],[0.529,0.249],[0.504,0.209],[0.479,0.174],[0.457,0.147]]
  .map(([x, y]) => ({ x: x * W, y: y * H }));

console.log("── 三角レポート (実描線): 頂点=形の角 ──");
{
  const cx = cxOf(TRI);
  check("角 3 (頂点が数えられる)", cx.corners === 3,
        JSON.stringify({ cor: cx.corners, cs: +cx.cornerSharpness.toFixed(2) }));
  check("閉形・回転 ≈1", cx.isClosed && Math.abs(cx.rotationFraction - 1) < 0.25,
        JSON.stringify({ rot: +cx.rotationFraction.toFixed(2) }));
  check("5 モーラ (角3+ループ1+サイズ)", cx.moraCount === 5, `mc=${cx.moraCount}`);
  check("確定○の座標が 3 点返る", (cx.cornerPoints || []).length === 3);
}

console.log("── 不変性: どこから・どちら回りに描いても同じ形は同じ測定 ──");
{
  const base = cxOf(TRI);
  // 始点を底辺左角へ回した同じ輪郭 (末尾の閉じ足しを除いて回転)
  const ring = TRI.slice(0, TRI.length - 1);
  for (const shift of [5, 8, 14, 20]) {
    const rot = ring.slice(shift).concat(ring.slice(0, shift));
    rot.push({ ...rot[0] });   // 閉じ足し (実描画と同じく始点近くで終わる)
    const cx = cxOf(rot);
    check(`始点シフト+${shift}: 角 ${base.corners} / mc ${base.moraCount} を保持`,
          cx.corners === base.corners && cx.moraCount === base.moraCount,
          JSON.stringify({ cor: cx.corners, mc: cx.moraCount }));
  }
  const rev = [...TRI].reverse();
  const cxR = cxOf(rev);
  check("逆回り: 角/モーラ数を保持",
        cxR.corners === base.corners && cxR.moraCount === base.moraCount,
        JSON.stringify({ cor: cxR.corners, mc: cxR.moraCount }));
}

console.log("── 合成形 (jitter 込み・実描画条件) ──");
{
  // 閉じた四角 (一周・角4)
  const sq = [];
  const cs = [[100,100],[260,100],[260,260],[100,260]];
  for (let e = 0; e < 4; e++) {
    const [ax, ay] = cs[e], [bx, by] = cs[(e + 1) % 4];
    for (let t = 0; t < 10; t++) sq.push({ x: ax + (bx - ax) * t / 10, y: ay + (by - ay) * t / 10 });
  }
  sq.push({ x: 101, y: 102 });   // 始点近くで描き終える
  const cx1 = cxOf(sq), cx2 = cxOf(jittered(sq));
  check("閉じた四角 → 角 4", cx1.corners === 4, `cor=${cx1.corners}`);
  check("閉じた四角 (jitter) → 角 4", cx2.corners === 4, `cor=${cx2.corners}`);
  // 円: 角 0 のまま・aaan ゲートも維持
  const circle = [];
  for (let i = 0; i <= 72; i++) {
    const t = i / 72 * 2 * Math.PI;
    circle.push({ x: 180 + 120 * Math.cos(t), y: 180 + 120 * Math.sin(t) });
  }
  for (const [label, ptsC] of [["円", circle], ["円 (jitter)", jittered(circle)]]) {
    const cx = cxOf(ptsC);
    const ax = api.bucketedAxes(api.applyHandCorrection(
      api.extractAxes(api.densified(ptsC, 6), W, H), 0.0, false), 0.25);
    check(`${label} → 角 0・aaan ゲート維持`, cx.corners === 0 && api.circleVocabSignal(cx, ax),
          JSON.stringify({ cor: cx.corners, rot: +cx.rotationFraction.toFixed(2) }));
  }
  // 開いた線は従来どおり (正準化は閉形のみ): ジグザグ 5 角
  const zig = [];
  for (let i = 0; i <= 5; i++) {
    zig.push({ x: 60 + i * 48, y: i % 2 === 0 ? 120 : 260 });
  }
  const zigDense = [];
  for (let i = 0; i < zig.length - 1; i++) {
    for (let t = 0; t < 12; t++) {
      zigDense.push({ x: zig[i].x + (zig[i+1].x - zig[i].x) * t / 12,
                      y: zig[i].y + (zig[i+1].y - zig[i].y) * t / 12 });
    }
  }
  zigDense.push(zig[zig.length - 1]);
  const cxZ = cxOf(zigDense);
  check("開いたジグザグ → 角 4 以上 (開いた線の規則は不変)", cxZ.corners >= 4 && !cxZ.isClosed,
        JSON.stringify({ cor: cxZ.corners, closed: cxZ.isClosed }));
}

console.log("── Step2: 転回集中度 → 形の K (formK・P3 の形式化) ──");
{
  const f = beads => cxOf(beads).formK;
  const triK = f(TRI), triKj = f(jittered(TRI));
  check("三角 (実レポート) formK ≥ +0.3 (破裂圏)", triK !== null && triK >= 0.3,
        `formK=${triK?.toFixed(2)}`);
  check("三角 jitter でも安定 (±0.15)", triKj !== null && Math.abs(triKj - triK) < 0.15,
        `formK=${triKj?.toFixed(2)}`);
  const sq = [];
  const cs4 = [[100, 100], [260, 100], [260, 260], [100, 260]];
  for (let e = 0; e < 4; e++) {
    const [ax, ay] = cs4[e], [bx, by] = cs4[(e + 1) % 4];
    for (let t = 0; t < 10; t++) sq.push({ x: ax + (bx - ax) * t / 10, y: ay + (by - ay) * t / 10 });
  }
  sq.push({ x: 101, y: 102 });
  const sqK = f(sq);
  check("四角 formK ≥ +0.3", sqK !== null && sqK >= 0.3, `formK=${sqK?.toFixed(2)}`);
  const circle = [];
  for (let i = 0; i <= 72; i++) {
    const t = i / 72 * 2 * Math.PI;
    circle.push({ x: 180 + 120 * Math.cos(t), y: 180 + 120 * Math.sin(t) });
  }
  const cK = f(circle), cKj = f(jittered(circle));
  check("円 formK ≤ −0.7 (ブーバ)", cK !== null && cK <= -0.7, `formK=${cK?.toFixed(2)}`);
  check("円 jitter でも ≤ −0.7", cKj !== null && cKj <= -0.7, `formK=${cKj?.toFixed(2)}`);
  const blob = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80 * 2 * Math.PI;
    const r = 110 + 14 * Math.sin(3 * t);
    blob.push({ x: 180 + r * Math.cos(t), y: 180 + 0.8 * r * Math.sin(t) });
  }
  const bK = f(blob);
  check("丸みブロブ formK ≤ −0.6", bK !== null && bK <= -0.6, `formK=${bK?.toFixed(2)}`);
  // 渦 = 単純な輪郭ではない → formK null (軌跡層の担当。巻きパッドの接続跳びで
  // 偽の角 +0.5 級が出る事故を紙面効率ゲート <3.2 で防ぐ — 実測で踏んだ)
  const spiral = [];
  for (let i = 0; i <= 160; i++) {
    const t = i / 160 * 2.2 * 2 * Math.PI;
    const r = 120 - 25 * (t / (2 * Math.PI));
    spiral.push({ x: 180 + r * Math.cos(t), y: 180 + r * Math.sin(t) });
  }
  check("渦 (非単純形) は formK null = 正準化対象外", cxOf(spiral).formK === null);
  // 開いた線も null (従来の軌跡 K)
  const line = [];
  for (let i = 0; i <= 30; i++) line.push({ x: 60 + i * 8, y: 120 + i * 3 });
  check("開いた線は formK null", cxOf(line).formK === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
