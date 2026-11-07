#!/usr/bin/env node
/* tools/test-geometry.mjs — 几何核单元/回归测试（Node，无浏览器）
 *
 *   node tools/test-geometry.mjs
 *
 * 基准来自参考件实测：
 *   方箱延长（ALPA猪嘴 130mm延长.step）：总长 130 = 3 + 124 + 3，外 88.5 / 内 76，M65 贯通 3 mm
 *   锥形延长（M42lens to ALPA.step）：M42×1，L=21.4，总高 24.4
 *   标准板（ALPA_STANDARD_BOARD_0.step，⌀35，去沉台）体积 18143.04 mm³
 *   锥面板（ALPA_STANDARD_BOARD_M65 hf.3mf，凸台 2 mm，M65）体积 13195.75 mm³
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
for (const f of ['src/app/00-core.js', 'src/app/10-geometry.js', 'src/app/20-export.js']) {
  vm.runInThisContext(readFileSync(join(ROOT, f), 'utf8'), { filename: f });
}

const FSG = globalThis.FSG;
const G = FSG.Geometry;
const E = FSG.Export;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, info) {
  if (cond) { pass++; console.log('  OK   ' + name + (info !== undefined ? '  [' + info + ']' : '')); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (info !== undefined ? '  [' + info + ']' : '')); }
}
function near(a, b, tol, name) { return ok(name, Math.abs(a - b) <= tol, a + ' vs ' + b + ' ±' + tol); }
function build(patch) { return G.build(Object.assign(FSG.defaults(), patch || {})); }
const BOARD = { mode: 'board' };
const CONE = { mode: 'cone' };

console.log('\n=== 01 方箱延长（130 mm，与参考件一致）===');
{
  const r = build({ mode: 'box', board: 'A', boxLen: 130, boxWall: 6.25,
    holeMode: 'thread', threadKey: 'M65x1', frontChamfer: 0, meshN: 720 });
  const d = r.derived;
  ok('构建成功', r.ok, r.error);
  ok('水密', r.audit.watertight, 'boundary=' + r.audit.boundaryEdges);
  near(d.H, 130, 1e-9, '总长 130');
  near(d.boardT, 3, 1e-9, '底板 3 mm');
  near(d.topT, 3, 1e-9, '顶板 3 mm');
  near(d.boxTubeLen, 124, 1e-9, '方桶 124 mm');
  near(d.boxInner, 76, 1e-9, '内腔 76 方');
  near(d.boxWall, 6.25, 1e-9, '壁厚 6.25');
  near(d.turns, 3, 1e-9, '顶面螺纹 3 mm → 3 圈');
  near(r.audit.volume, 201949.9, 3000, '体积对齐 3MF 参考 201949.9 ±1.5%');
  near(r.audit.bboxMax[2], 130, 1e-6, '网格总高 130');
  near(r.audit.bboxMax[0], 44.25, 1e-4, '外形 88.5/2');
  near(r.audit.bboxMax[1], 44.25, 1e-4, '外形 88.5/2（另一轴）');
}

console.log('\n=== 01b 默认延长高度 = 20 mm ===');
{
  const dBox = FSG.derive(FSG.defaults());
  near(dBox.boxLen, 20, 1e-9, '默认方箱总长 20（桶 14）');
  near(dBox.boxTubeLen, 14, 1e-9, '默认方桶 14');
  const dCone = FSG.derive(Object.assign(FSG.defaults(), { mode: 'cone' }));
  near(dCone.extLen, 20, 1e-9, '默认锥形延长 20（总高 23）');
  near(dCone.H, 23, 1e-9, '默认锥形总高 23');
}

console.log('\n=== 02 方箱：壁厚 / 长度自适应 ===');
{
  const d = FSG.derive(Object.assign(FSG.defaults(), { mode: 'box', boxWall: 3 }));
  ok('壁厚 3 合法', d.ok === true, d.errors[0]);
  near(d.boxInner, 82.5, 1e-9, '壁厚 3 → 内腔 82.5');

  const r = build({ mode: 'box', boxLen: 80 });
  near(r.derived.boxTubeLen, 74, 1e-9, '总长 80 → 方桶 74');
  near(r.audit.bboxMax[2], 80, 1e-6, '总高 80');

  const p = build({ mode: 'box', boxLen: 130, holeMode: 'plain', holeD: 35 });
  near(p.derived.H, 130, 1e-9, '圆孔版仍是 130');
  ok('圆孔版水密', p.audit.watertight === true);

  const bad = FSG.derive(Object.assign(FSG.defaults(), { mode: 'box', boxLen: 5 }));
  ok('总长过短被拦截', bad.ok === false, bad.errors[0]);
  const bad2 = FSG.derive(Object.assign(FSG.defaults(), { mode: 'box', boxWall: 1 }));
  ok('壁厚过小被拦截', bad2.ok === false, bad2.errors[0]);
  const big80 = FSG.derive(Object.assign(FSG.defaults(), { mode: 'box', holeMode: 'plain', holeD: 80 }));
  ok('顶面 ⌀80 圆孔合法（按 88.5 顶板算）', big80.ok === true, big80.errors[0]);
  const bad3 = FSG.derive(Object.assign(FSG.defaults(), { mode: 'box', holeMode: 'plain', holeD: 85 }));
  ok('顶面孔 > ⌀82.5 被拦截', bad3.ok === false, bad3.errors[0]);

  /* 底板开口不随壁厚变化 */
  const dThin = FSG.derive(Object.assign(FSG.defaults(), { mode: 'box', boxWall: 4 }));
  const dNorm = FSG.derive(Object.assign(FSG.defaults(), { mode: 'box', boxWall: 6.25 }));
  const pThin = G.buildProfile(dThin), pNorm = G.buildProfile(dNorm);
  near(G.radiusAt(pThin.inner[0].shape, 0, 0), G.radiusAt(pNorm.inner[0].shape, 0, 0), 1e-9,
    '底板开口不随壁厚变化');
  near(G.radiusAt(pThin.inner[0].shape, 0, 0), 38.5, 1e-9, '底板开口恒为 76 + 0.5');
  ok('桶身内腔仍随壁厚变化',
    G.radiusAt(pThin.inner[2].shape, 0, 0) > G.radiusAt(pNorm.inner[2].shape, 0, 0) + 1,
    G.radiusAt(pThin.inner[2].shape, 0, 0).toFixed(2));
}

console.log('\n=== 02b 方箱：内壁光陷阱凹槽 ===');
{
  const d = FSG.derive(Object.assign(FSG.defaults(), { mode: 'box' }));
  const prof = G.buildProfile(d);
  const cavFull = prof.inner.filter((n) => n.shape.kind === 'poly')[2].shape;
  ok('内腔使用凹槽形状', cavFull.kind === 'poly', cavFull.kind);
  near(G.radiusAt(cavFull, 0.0, 0), 39.25, 1e-9, '0° 方向凹槽底 = 38 + 1.25');
  near(G.radiusAt(cavFull, 0.25, 0), 39.25, 1e-9, '90° 方向凹槽底 = 39.25');
  near(G.radiusAt(cavFull, 0.5, 0), 39.25, 1e-9, '180° 方向凹台也是 39.25');
  ok('凹台外仍为 38 方墙', Math.abs(G.radiusAt(cavFull, 40 / 360, 0) - 38 / Math.cos(40 * Math.PI / 180)) < 0.6, G.radiusAt(cavFull, 40 / 360, 0).toFixed(2));
  const V = (39.25 * 39.25 - 38 * 38) * 0;
  ok('凹槽宽 12.36', FSG.BOX_GROOVE_W === 12.36);
}

console.log('\n=== 03 方箱：外观阶梯切角轮廓 ===');
{
  const d = FSG.derive(Object.assign(FSG.defaults(), { mode: 'box' }));
  const prof = G.buildProfile(d);
  ok('外轮廓 8 个层级', prof.outer.length === 8, prof.outer.length);
  const kinds = prof.outer.map((n) => n.shape.kind).join(',');
  ok('底板是圆角方、桶身是阶梯切角', /^rr,rr,rr,rr,rr,rr,step,step$/.test(kinds), kinds);
  const top = prof.outer[prof.outer.length - 1].shape;
  near(G.radiusAt(top, 0.0, 0), 44.25, 1e-9, '0° 方向半径 88.5/2');
  near(G.radiusAt(top, 0.25, 0), 44.25, 1e-9, '90° 方向半径 88.5/2');
  near(G.radiusAt(prof.outer[0].shape, 0.0, 0), 39, 1e-9, '底板 0° 方向半径 78/2');
  const rDiag = G.radiusAt(top, 0.125, 0);
  ok('45° 方向被切角（< 44.25√2）', rDiag < 44.25 * Math.SQRT2 - 1, rDiag.toFixed(3));

  /* 底板外形 = ALPA 圆角方，桶身 = 阶梯切角 */
  const tCorner = Math.atan2(26, 44.25) / (2 * Math.PI);
  near(G.radiusAt(prof.outer[4].shape, 0.125, 0), 44.25 * Math.SQRT2 - 8 * (Math.SQRT2 - 1), 0.01, '底板 88.5 R8 对角线半径');
  ok('桶身角部是阶梯（小于 R8 圆角）', G.radiusAt(prof.outer[6].shape, 0.125, 0) < G.radiusAt(prof.outer[4].shape, 0.125, 0) - 2, G.radiusAt(prof.outer[6].shape, 0.125, 0).toFixed(2));
  ok('45° 方向 > 36√2（R6 弧凸出）', rDiag > 36 * Math.SQRT2, rDiag.toFixed(3));
}

console.log('\n=== 04 锥形延长（M42×1 · 21.4 mm）===');
{
  const r = build({ mode: 'cone', board: 'A', extLen: 21.4, extThreadKey: 'M42x1', extDepth: 5, frontChamfer: 0, meshN: 720 });
  const d = r.derived;
  ok('构建成功', r.ok, r.error);
  ok('水密', r.audit.watertight, 'boundary=' + r.audit.boundaryEdges);
  near(d.H, 24.4, 1e-9, '总高 24.4 = 3 + 21.4');
  near(d.extRootD, 80, 1e-9, '外锥根部 ⌀80');
  near(d.extTipD, 52, 1e-9, '外锥尖端 = 42 + 10 = ⌀52');
  near(d.extInnerRootD, 66.60, 0.02, '等壁厚 → 内锥根部 ⌀66.6');
  near(d.extWall, 8.66, 0.02, '等壁厚 8.66');
  near(d.extCrestD, 41.22, 0.02, '内锥小端 = 牙顶 ⌀41.2');
  near(d.extTurns, 5, 1e-9, '螺纹 5 mm → 5 圈');
  near(r.audit.volume, 43368.5, 900, '体积 43368.5 ±2%');
  near(r.audit.bboxMax[2], 24.4, 1e-6, '网格总高 24.4');
}

console.log('\n=== 05 锥形：外锥根部 / 螺纹自适应 ===');
{
  const wide = FSG.derive(Object.assign(FSG.defaults(), { mode: 'cone', extLen: 21.4, extOuterD: 86 }));
  ok('外锥根部 86 合法', wide.ok === true, wide.errors[0]);
  near(wide.extInnerRootD, 72.04, 0.03, '根部 86 → 内锥根部 ⌀72.0');
  near(wide.extWall, 9.36, 0.03, '壁厚 9.36');

  const m65 = FSG.derive(Object.assign(FSG.defaults(), { mode: 'cone', extLen: 21.4, extThreadKey: 'M65x1', extOuterD: 86 }));
  ok('M65 + 根部 86 合法', m65.ok === true, m65.errors[0]);
  near(m65.extTipD, 75, 1e-9, 'M65 尖端 ⌀75');

  const tooBig = FSG.derive(Object.assign(FSG.defaults(), {
    mode: 'cone', extThreadKey: 'custom', extThreadD: 72, extThreadP: 1 }));
  ok('M72 被拦截（尖端超过 ⌀80）', tooBig.ok === false, tooBig.errors[0]);

  const deep = FSG.derive(Object.assign(FSG.defaults(), { mode: 'cone', extLen: 10, extDepth: 9 }));
  ok('螺纹过深被拦截', deep.ok === false, deep.errors[0]);
}

console.log('\n=== 06 单板：标准板 ⌀35 · 平底 3 mm ===');
{
  const r = build(Object.assign({ board: 'A', bossH: 0, holeMode: 'plain', holeD: 35, frontChamfer: 0, meshN: 720 }, BOARD));
  ok('构建成功', r.ok, r.error);
  ok('水密', r.audit.watertight, 'boundary=' + r.audit.boundaryEdges);
  near(r.audit.volume, 18143.04, 90, '体积 18143.04 ±0.5%');
  near(r.audit.bboxMax[2], 3, 0.001, '总高 3');
}

console.log('\n=== 07 单板：锥面板 / 标准板 层级 ===');
{
  const dA = FSG.derive(Object.assign(FSG.defaults(), BOARD, { board: 'A', bossH: 0 }));
  const pA = G.buildProfile(dA);
  const zA = pA.outer.map((n) => n.z);
  const rA = pA.outer.map((n) => G.radiusAt(n.shape, 0, n.z));
  ok('标准板 z 台阶 0 / 1.0 / 1.6 / 3.0', [0, 1, 1.6, 3].every((z) => zA.some((v) => Math.abs(v - z) < 1e-9)), zA.join(','));
  ok('标准板外径 39 / 41.25 / 44.25', [39, 41.25, 44.25].every((v) => rA.some((x) => Math.abs(x - v) < 1e-6)), rA.join(','));

  const dB = FSG.derive(Object.assign(FSG.defaults(), BOARD, { board: 'B', bossH: 2 }));
  const pB = G.buildProfile(dB);
  const rB = pB.outer.map((n) => G.radiusAt(n.shape, 0, n.z));
  near(rB[0], 35.5, 1e-6, '锥面板尖端 = 螺纹 65 + 6 → ⌀71/2');
  near(rB[1], 37.54, 1e-6, '锥面根部 ⌀75.08/2');
  near(rB[rB.length - 1], 44.25, 1e-9, '镜头侧 88.5/2');
}

console.log('\n=== 08 单板：自适应凸台 ===');
{
  const m = FSG.derive(Object.assign(FSG.defaults(), BOARD, { board: 'B', bossH: 2, holeMode: 'thread', threadKey: 'M65x1' }));
  near(m.bossTipD, 71, 1e-6, 'M65 → 尖端 ⌀71');
  near(m.bossAngle, Math.atan2(2.04, 2) * 180 / Math.PI, 1e-6, 'h=2 时 ≈45.6°');

  const p35 = FSG.derive(Object.assign(FSG.defaults(), BOARD, { board: 'A', bossH: 5, holeMode: 'plain', holeD: 35 }));
  ok('⌀35 + 5 mm 凸台合法', p35.ok === true, p35.errors[0]);
  near(p35.bossTipD, 41, 1e-6, '⌀35 → 尖端 ⌀41');

  const a0 = build(Object.assign({ board: 'A', bossH: 0 }, BOARD));
  const a5 = build(Object.assign({ board: 'A', bossH: 5 }, BOARD));
  ok('单板凸台 0 / 5 均水密', a0.audit.watertight && a5.audit.watertight);
  near(a5.audit.bboxMax[2], 8, 1e-6, '5 mm 凸台 → 总高 8');
}

console.log('\n=== 09 螺纹牙型 / 深度 ===');
{
  const d = FSG.derive(Object.assign(FSG.defaults(), BOARD, { holeMode: 'thread', threadKey: 'M65x1', gap: 0, bossH: 2, frontChamfer: 0 }));
  const th = d.thread;
  near(th.D1, 63.91747, 0.001, 'M65×1 小径 63.917');
  near(d.threadLen, 5, 1e-9, '螺纹长度 = 板体 3 + 凸台 2');
  const shape = G.threadShape(th, 0, 0);
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < 720; i++) {
    const r = G._threadRadius(shape, i / 720, 2.5);
    if (r < mn) mn = r; if (r > mx) mx = r;
  }
  near(mn, th.D1 / 2, 1e-6, '牙顶半径 = 小径/2');
  near(mx, th.D / 2, 1e-6, '牙根半径 = 大径/2');
  const hits = [];
  for (let k = 0; k < 4000; k++) {
    const z = 1.0 + 2.0 * k / 3999;
    if (G._threadRadius(shape, 0, z) > th.D / 2 - 1e-9) hits.push(z);
  }
  const groups = [];
  let prevZ = -1e9;
  for (const z of hits) { if (z - prevZ > 0.01) groups.push(z); prevZ = z; }
  const period = groups.length > 1 ? groups[1] - groups[0] : 0;
  near(period, 1.0, 0.002, '牙距 1.0');
}

console.log('\n=== 10 参数校验 ===');
{
  const bad = [
    ['方箱总长 3', { mode: 'box', boxLen: 3 }],
    ['方箱壁厚 1', { mode: 'box', boxWall: 1 }],
    ['锥形长度 3', { mode: 'cone', extLen: 3 }],
    ['锥形螺纹深度 0', { mode: 'cone', extDepth: 0 }],
    ['凸台高度 6', { mode: 'board', bossH: 6 }],
    ['圆孔太大（平底）', { mode: 'board', board: 'A', bossH: 0, holeMode: 'plain', holeD: 80 }],
    ['牙距非法', { mode: 'board', threadKey: 'custom', threadD: 65, threadP: 9 }],
    ['倒角大于孔半径', { mode: 'board', holeMode: 'plain', holeD: 10, frontChamfer: 6, board: 'A', bossH: 0 }],
    ['凸台 + 特大孔', { mode: 'board', bossH: 2, holeMode: 'plain', holeD: 74 }]
  ];
  for (const [name, patch] of bad) {
    const d = FSG.derive(Object.assign(FSG.defaults(), patch));
    ok('拦截：' + name, d.ok === false && d.errors.length > 0, d.errors[0]);
  }
  ok('默认参数合法（方箱 130）', FSG.derive(FSG.defaults()).ok === true);
  for (const preset of FSG.PRESETS) {
    const d = FSG.derive(Object.assign(FSG.defaults(), preset.params));
    ok('预设合法：' + preset.label, d.ok === true, d.errors[0]);
  }
}

console.log('\n=== 11 剖面封盖 ===');
{
  const r = build({ mode: 'box', boxLen: 130, frontChamfer: 0 });
  const sec = G.sectionMesh(r.derived);
  ok('剖面网格非空', sec.indices.length > 0, sec.indices.length / 3 + ' 面');
  let maxX = 0, maxZ = 0;
  for (let i = 0; i < sec.positions.length; i += 3) {
    maxX = Math.max(maxX, Math.abs(sec.positions[i]));
    maxZ = Math.max(maxZ, sec.positions[i + 2]);
  }
  near(maxZ, 130, 0.001, '剖面到 z=130');
  ok('剖面到外形 44.25', Math.abs(maxX - 44.25) < 0.01, maxX.toFixed(3));
}

console.log('\n=== 12 STL / 3MF 导出 ===');
{
  const r = build({ mode: 'box', boxLen: 130 });
  const stl = E.writeSTL(r);
  ok('STL 字节数 = 84 + 50×三角数', stl.length === 84 + 50 * r.audit.triangles, stl.length);
  const parsed = E.parseSTL(stl);
  ok('STL 回读三角数一致', parsed.triangles === r.audit.triangles);
  near(parsed.max[0] - parsed.min[0], 88.5, 0.01, 'STL 宽 88.5');
  near(parsed.min[2], 0, 1e-4, 'STL 底面 z=0');
  near(parsed.max[2], 130, 1e-3, 'STL 总高 130');

  const z3 = E.write3MF(r, { name: 'test' });
  const files = E.unzipStore(z3);
  ok('3MF 含 3 个必需 entry', !!files['[Content_Types].xml'] && !!files['_rels/.rels'] && !!files['3D/3dmodel.model']);
  const model = Buffer.from(files['3D/3dmodel.model']).toString('utf8');
  const nv = (model.match(/<vertex /g) || []).length;
  const nt = (model.match(/<triangle /g) || []).length;
  ok('3MF 顶点数一致', nv === r.audit.vertices, nv + '/' + r.audit.vertices);
  ok('3MF 三角数一致', nt === r.audit.triangles, nt + '/' + r.audit.triangles);
  ok('3MF 单位 mm', /unit="millimeter"/.test(model));
}

console.log('\n=== 13 参数 JSON / TXT ===');
{
  const r = build({ mode: 'box', boxLen: 130 });
  const json = JSON.parse(E.writeParamsJSON(r));
  ok('JSON 含参数与派生', !!json.params && !!json.derived && !!json.mesh);
  near(json.derived.totalHeight, 130, 1e-6, 'JSON 总高 130');
  ok('JSON 标记方箱', json.derived.mode === 'box' && !!json.derived.box);
  near(json.derived.box.inner, 76, 1e-9, 'JSON 内腔 76');
  near(json.mesh.volumeMm3, r.audit.volume, 1e-6, 'JSON 体积一致');
  ok('JSON 名称含 ALPA', String(json.name).indexOf('ALPA') === 0, json.name);
  const txt = E.writeParamsTXT(r);
  ok('TXT 含方箱与分段', txt.includes('方箱延长') && txt.includes('分段'), txt.split('\n')[3]);
}

console.log('\n=== 14 稳定性 ===');
{
  const a = build({ mode: 'box' });
  const b = build({ mode: 'box' });
  ok('两次构建完全一致', a.audit.volume === b.audit.volume && a.audit.triangles === b.audit.triangles);
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) build({ mode: 'box' });
  const ms = (Date.now() - t0) / 5;
  ok('单次构建 < 400 ms', ms < 400, ms.toFixed(0) + ' ms');
  const high = build({ mode: 'box', meshN: 720 });
  ok('高精度网格水密', high.audit.watertight, high.audit.triangles + ' 面');
}

console.log('\n========================================');
console.log(fail ? 'TEST FAILED: ' + fail + ' / ' + (pass + fail) : 'TEST OK: ' + pass + ' / ' + (pass + fail) + ' 全部通过');
if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '));
process.exit(fail ? 1 : 0);
