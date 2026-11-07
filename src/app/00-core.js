/* ============================================================
 * 00-core.js — 参数定义 / 派生 / 校验 / URL 状态
 * ALPA 镜头板生成器 v4（单板 + 锥形延长 + 方箱延长）
 *
 * 坐标约定（单位 mm；与打印姿态一致）：
 *   Z = 光轴，z = 0 为「相机侧贴合面」，向镜头侧递增到 z = H
 *   XY = 板面平面；外形 88.5 × 88.5，关于原点对称
 *
 * 三种形态：
 *   board 单板      H = 3 + 凸台(0–5)
 *   cone  锥形延长  H = 3 + 锥筒长度
 *   box   方箱延长  H = 总长（3 底板 + 方桶 + 3 顶板）
 * ============================================================ */
'use strict';

var FSG = (typeof FSG === 'object' && FSG) ? FSG : {};

FSG.VERSION = '4.0.0';
FSG.TITLE = 'ALPA 镜头板生成器';
FSG.SUBTITLE = '单板 / 锥形延长 / 方箱延长 · 3 mm 板体';

/* 板外形与固定尺寸 */
FSG.W = 88.5;
FSG.CORNER_R = 8;
FSG.BOARD_T = 3.0;
FSG.BOSS_D = 75.08;
FSG.BOSS_WALL = 3.0;
FSG.BOSS_MAX = 5.0;
FSG.MIN_WALL = 1.2;

/* 锥形延长段（参考件 M42lens to ALPA） */
FSG.EXT_ROOT_D = 80.0;
FSG.EXT_ROOT_MIN = 60.0;
FSG.EXT_ROOT_MAX = 86.5;
FSG.EXT_INNER_MAX_D = 77.0;
FSG.EXT_RIM = 5.0;
FSG.EXT_MIN = 5.0;
FSG.EXT_MAX = 60.0;

/* 方箱延长段（参考件 ALPA猪嘴 130mm延长） */
FSG.BOX_MIN = 10.0;
FSG.BOX_MAX = 220.0;
FSG.BOX_WALL_MIN = 2.0;
FSG.BOX_WALL_MAX = 20.0;
FSG.BOX_TOP_T = 3.0;      // 顶板厚度
FSG.BOX_GROOVE_D = 1.25;  // 内壁光陷阱凹槽深度
FSG.BOX_GROOVE_W = 12.36; // 内壁光陷阱凹槽宽度
FSG.BOX_BASE_T = 3.0;     // 底板厚度（ALPA 板体）

/* 等壁厚自适应（锥形延长） */
FSG.extInnerBase = function (outerD, tipD, extLen, zThreadStart, crestD) {
  var slope = (tipD / 2 - outerD / 2) / extLen;
  return 2 * (crestD / 2 - slope * zThreadStart);
};
FSG.extWall = function (outerD, tipD, extLen, zThreadStart, crestD, boardT) {
  var slope = (tipD / 2 - outerD / 2) / extLen;
  return outerD / 2 - crestD / 2 + slope * (zThreadStart - boardT);
};

/* 板型说明 */
FSG.BOARD_INFO = {
  A: { key: 'A', name: '标准板', t: 3.0, desc: '3 mm：78 方 R4 → 82.5 方 R5 平台阶 → 88.5 方 R8' },
  B: { key: 'B', name: '锥面板', t: 3.0, desc: '3 mm：78 方 R4 → 82.5 → 88.5 斜锥 → 88.5 方 R8' }
};

/* 内螺纹规格表 */
FSG.THREADS = [
  { key: 'M65x1',    label: 'M65 × 1',      D: 65, P: 1.00 },
  { key: 'M65x075',  label: 'M65 × 0.75',   D: 65, P: 0.75 },
  { key: 'M62x1',    label: 'M62 × 1',      D: 62, P: 1.00 },
  { key: 'M58x075',  label: 'M58 × 0.75',   D: 58, P: 0.75 },
  { key: 'M55x075',  label: 'M55 × 0.75',   D: 55, P: 0.75 },
  { key: 'M52x075',  label: 'M52 × 0.75',   D: 52, P: 0.75 },
  { key: 'M52x1',    label: 'M52 × 1',      D: 52, P: 1.00 },
  { key: 'M50x075',  label: 'M50 × 0.75',   D: 50, P: 0.75 },
  { key: 'M42x1',    label: 'M42 × 1',      D: 42, P: 1.00 },
  { key: 'M42x075',  label: 'M42 × 0.75',   D: 42, P: 0.75 },
  { key: 'M39x1',    label: 'M39 × 1',      D: 39, P: 1.00 },
  { key: 'M39x075',  label: 'M39 × 0.75',   D: 39, P: 0.75 },
  { key: 'custom',   label: '自定义…',       D: null, P: null }
];

/* 默认参数 = 参考件「方箱延长 130 mm」 */
FSG.DEFAULT_PARAMS = {
  mode: 'box',         // 'board' | 'cone' | 'box'
  /* 方箱延长 */
  boxLen: 20,
  boxWall: 6.25,
  /* 锥形延长 */
  extLen: 20,
  extOuterD: 80,
  extThreadKey: 'M42x1',
  extThreadD: 42,
  extThreadP: 1.0,
  extDepth: 5,
  /* 单板 */
  board: 'A',
  bossH: 2.0,
  holeMode: 'thread',
  holeD: 35,
  threadKey: 'M65x1',
  threadD: 65,
  threadP: 1.0,
  gap: 0.15,
  frontChamfer: 0.6,
  meshN: 360
};

/* 预设 */
FSG.PRESETS = [
  { key: 'box20', label: '方箱延长 20', params: {
      mode: 'box', board: 'A', boxLen: 20, boxWall: 6.25, holeMode: 'thread', threadKey: 'M65x1' } },
  { key: 'box130', label: '方箱延长 130', params: {
      mode: 'box', board: 'A', boxLen: 130, boxWall: 6.25, holeMode: 'thread', threadKey: 'M65x1' } },
  { key: 'box35', label: '方箱 ⌀35 圆孔', params: {
      mode: 'box', board: 'A', boxLen: 20, boxWall: 6.25, holeMode: 'plain', holeD: 35 } },
  { key: 'ext20', label: '锥形延长 20', params: {
      mode: 'cone', board: 'A', extLen: 20, extOuterD: 80, extThreadKey: 'M42x1', extDepth: 5 } },
  { key: 'extM42', label: '锥形延长 21.4', params: {
      mode: 'cone', board: 'A', extLen: 21.4, extOuterD: 80, extThreadKey: 'M42x1', extDepth: 5 } },
  { key: 'board35', label: '⌀35 平底板', params: {
      mode: 'board', board: 'A', bossH: 0, holeMode: 'plain', holeD: 35, frontChamfer: 0 } },
  { key: 'coneM65', label: 'M65×1 锥面板 2 mm', params: {
      mode: 'board', board: 'B', bossH: 2, holeMode: 'thread', threadKey: 'M65x1', frontChamfer: 0 } }
];

/* 参考件实测 */
FSG.REFERENCE = {
  boardA: { thick: 3.0, volume: 18143.04, W: 88.5, boreD: 35 },
  boardB: { thick: 5.0, volume: 13195.75, W: 88.5, thread: 'M65x1', crest: 64.22, root: 65.52, bossH: 2.0 },
  extension: {
    total: 24.4, plate: 3.0, extLen: 21.4,
    outer: { rootD: 80, tipD: 52 }, thread: { key: 'M42x1', depth: 4.861 }
  },
  box: {
    total: 130.0, base: 3.0, tube: 124.0, top: 3.0,
    outer: 88.5, inner: 76.0, wall: 6.25,
    thread: { key: 'M65x1', depth: 3.0 }
  }
};

/* ---------- 小工具 ---------- */
FSG.fmt = function (v, digits) {
  var d = (digits === undefined) ? 2 : digits;
  if (!isFinite(v)) return '–';
  var s = Number(v).toFixed(d);
  s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return s;
};
FSG.clone = function (obj) { return JSON.parse(JSON.stringify(obj)); };
FSG.toNum = function (v, fallback) {
  var n = Number(v);
  return isFinite(n) ? n : fallback;
};
FSG.defaults = function () { return FSG.clone(FSG.DEFAULT_PARAMS); };

/* ---------- 螺纹规格解析 ---------- */
FSG.threadInfo = function (p) {
  var key = p.threadKey || 'M42x1';
  var spec = null;
  for (var i = 0; i < FSG.THREADS.length; i++) {
    if (FSG.THREADS[i].key === key) { spec = FSG.THREADS[i]; break; }
  }
  var D, P;
  if (!spec || spec.key === 'custom' || spec.D === null) {
    D = FSG.toNum(p.threadD, 42);
    P = FSG.toNum(p.threadP, 1.0);
  } else {
    D = spec.D; P = spec.P;
  }
  var D1 = D - 1.08253 * P;
  return { key: key, D: D, P: P, H: 0.8660254 * P, h: 0.61343 * P, D1: D1, rCrest: D1 / 2, rRoot: D / 2 };
};

/* ---------- 派生 + 校验 ---------- */
FSG.derive = function (params) {
  var p = params || FSG.defaults();
  var errors = [];
  var warnings = [];
  function bad(m) { errors.push(m); }
  function warn(m) { warnings.push(m); }

  var mode = (p.mode === 'board' || p.mode === 'cone') ? p.mode : 'box';
  var binfo = FSG.BOARD_INFO[(String(p.board).toUpperCase() === 'B') ? 'B' : 'A'];
  var board = (String(p.board).toUpperCase() === 'B') ? 'B' : 'A';
  var boardT = FSG.BOARD_T;
  var W = FSG.W;
  var gap = FSG.toNum(p.gap, 0.15);
  var meshN = Math.round(FSG.toNum(p.meshN, 360));
  var frontChamfer = FSG.toNum(p.frontChamfer, 0);
  var holeMode = (String(p.holeMode) === 'plain') ? 'plain' : 'thread';
  var th = FSG.threadInfo(p);
  var holeD = FSG.toNum(p.holeD, 35);
  var thrD = th.D, thrP = th.P;
  var dReq = (holeMode === 'plain') ? holeD : thrD;
  var nums = [gap, meshN, frontChamfer, holeD, th.D, th.P];
  if (nums.some(function (v) { return !isFinite(v); })) bad('存在空值或非数字参数');
  if (!(gap >= 0 && gap <= 0.8)) bad('配合间隙需在 0 – 0.8 mm 之间');
  if (meshN < 120 || meshN > 1440) bad('网格精度需在 120 – 1440 段/圈');
  if (meshN < 200) warn('采样偏少：螺纹会显得粗糙');
  if (frontChamfer < 0 || frontChamfer > 3) bad('孔口倒角需在 0 – 3 mm 之间');

  /* 通用孔/螺纹规格校验（单板开口 / 方箱顶面孔） */
  function checkHole(maxD, where) {
    if (holeMode === 'plain') {
      if (!(holeD > 2)) bad('圆孔直径必须 > 2 mm');
      if (frontChamfer >= holeD / 2) bad('孔口倒角不能大于孔半径');
      if (holeD > maxD + 1e-9) bad('圆孔太大：' + where + '最多 ⌀' + FSG.fmt(maxD, 2) + ' mm');
    } else {
      if (!(thrD > 6)) bad('螺纹大径必须 > 6 mm');
      if (!(thrP >= 0.2 && thrP <= 4)) bad('牙距需在 0.2 – 4 mm 之间');
      if (thrD - 1.08253 * thrP <= 2) bad('螺纹太小：小径需 > 2 mm');
      if (thrD > maxD + 1e-9) bad('螺纹太大：' + where + '最多 ⌀' + FSG.fmt(maxD, 2) + ' mm');
      if (gap > thrP * 0.8) warn('配合间隙接近牙距，牙型会很浅');
    }
  }

  var H = boardT;
  var out = {
    ok: true, errors: errors, warnings: warnings, params: p,
    mode: mode, board: board, boardName: binfo.name, boardDesc: binfo.desc,
    boardT: boardT, W: W,
    holeMode: holeMode, holeD: holeD, thread: null, threadLen: 0, turns: 0,
    gap: gap, frontChamfer: frontChamfer, meshN: meshN
  };

  /* ================= 方箱延长 ================= */
  if (mode === 'box') {
    var boxLen = FSG.toNum(p.boxLen, 130);
    var boxWall = FSG.toNum(p.boxWall, 6.25);
    var boxInner = W - 2 * boxWall;
    if (!(boxLen >= FSG.BOX_MIN && boxLen <= FSG.BOX_MAX)) {
      bad('总长需在 ' + FSG.BOX_MIN + ' – ' + FSG.BOX_MAX + ' mm 之间');
    }
    if (!(boxWall >= FSG.BOX_WALL_MIN && boxWall <= FSG.BOX_WALL_MAX)) {
      bad('桶壁厚需在 ' + FSG.BOX_WALL_MIN + ' – ' + FSG.BOX_WALL_MAX + ' mm 之间');
    }
    if (boxLen < FSG.BOX_TOP_T + FSG.BOX_BASE_T + 2) {
      bad('总长至少 ' + (FSG.BOX_TOP_T + FSG.BOX_BASE_T + 2) + ' mm（底板 3 + 顶板 3 + 桶 2）');
    }
    if (boxInner < 20) bad('内腔只剩 ⌀' + FSG.fmt(boxInner, 1) + ' mm，太小；请减小壁厚');
    /* 顶面孔开在 88.5 的顶板上，与内腔无关；只需顶板外缘留 3 mm */
    checkHole(W - 6, '顶面孔');
    H = boxLen;
    var boxTubeLen = Math.max(0, boxLen - FSG.BOX_TOP_T - FSG.BOX_BASE_T);
    out.extKind = 'box';
    out.boxLen = boxLen;
    out.boxWall = boxWall;
    out.boxInner = boxInner;
    out.boxTubeLen = boxTubeLen;
    out.topT = FSG.BOX_TOP_T;
    out.thread = holeMode === 'thread' ? th : null;
    out.threadLen = holeMode === 'thread' ? FSG.BOX_TOP_T : 0;
    out.turns = holeMode === 'thread' ? FSG.BOX_TOP_T / thrP : 0;
    if (holeMode === 'thread' && out.turns < 2.5) warn('顶面螺纹只有 ' + FSG.fmt(out.turns, 2) + ' 圈（顶板 3 mm）');
    if (boxLen > 150) warn('总长 ' + FSG.fmt(boxLen, 1) + ' mm 较长，打印时注意刚性');
  }

  /* ================= 锥形延长 ================= */
  if (mode === 'cone') {
    var extLen = FSG.toNum(p.extLen, 21.4);
    var extDepth = FSG.toNum(p.extDepth, 5);
    var extRootD = FSG.toNum(p.extOuterD, FSG.EXT_ROOT_D);
    var extTh = FSG.threadInfo({ threadKey: p.extThreadKey, threadD: p.extThreadD, threadP: p.extThreadP });
    var extTipD = 0, extCrestD = 0, extInnerRootD = 0, extWall = 0, extTurns = 0;
    if (!(extRootD >= FSG.EXT_ROOT_MIN && extRootD <= FSG.EXT_ROOT_MAX)) {
      bad('外锥根部需在 ⌀' + FSG.EXT_ROOT_MIN + ' – ⌀' + FSG.EXT_ROOT_MAX + ' 之间');
    }
    if (!(extLen >= FSG.EXT_MIN && extLen <= FSG.EXT_MAX)) {
      bad('延长长度需在 ' + FSG.EXT_MIN + ' – ' + FSG.EXT_MAX + ' mm 之间');
    }
    if (!(extDepth >= 1.5)) bad('螺纹深度至少 1.5 mm');
    if (extDepth > extLen - 2) bad('螺纹太深：深度需 ≤ 延长长度 − 2 mm（' + FSG.fmt(Math.max(0, extLen - 2), 1) + '）');
    if (!(extTh.D > 10)) bad('螺纹大径必须 > 10 mm');
    if (!(extTh.P >= 0.2 && extTh.P <= 4)) bad('牙距需在 0.2 – 4 mm 之间');
    if (extTh.D1 <= 2) bad('螺纹太小：小径需 > 2 mm');
    extTipD = extTh.D + 2 * FSG.EXT_RIM;
    if (extTipD > extRootD - 2) {
      bad('外锥太钝：尖端 ⌀' + FSG.fmt(extTipD, 2) + ' 需比根部 ⌀' + FSG.fmt(extRootD, 1) +
        ' 小至少 2 mm（该结构最大 M' + FSG.fmt(extRootD - 2 * FSG.EXT_RIM - 2, 1) + '，或把外锥根部加大）');
    }
    if (gap > extTh.P * 0.8) warn('配合间隙接近牙距，牙型会很浅');
    extCrestD = extTh.D1 + 2 * gap;
    var zThread = boardT + extLen - extDepth;
    extInnerRootD = FSG.extInnerBase(extRootD, extTipD, extLen, zThread, extCrestD);
    extWall = FSG.extWall(extRootD, extTipD, extLen, zThread, extCrestD, boardT);
    if (extInnerRootD > FSG.EXT_INNER_MAX_D) {
      bad('内锥根部 ⌀' + FSG.fmt(extInnerRootD, 2) + ' 超过上限 ⌀' + FSG.fmt(FSG.EXT_INNER_MAX_D, 1) +
        '（78 方上要留环）；可减小外锥根部或加长延长段');
    }
    if (extInnerRootD - extCrestD < 4) bad('内锥太短：外锥收得太快，内锥几乎没有锥度；可加大外锥根部直径');
    if (extWall < 1.5) bad('等壁厚只有 ' + FSG.fmt(extWall, 2) + ' mm，太薄；可加大外锥根部直径');
    else if (extWall > 14) warn('等壁厚 ' + FSG.fmt(extWall, 2) + ' mm，偏厚（较重）；可减小外锥根部直径');
    extTurns = extDepth / extTh.P;
    if (extTurns < 3) warn('螺纹只有 ' + FSG.fmt(extTurns, 2) + ' 圈，建议加深');
    if (frontChamfer > extDepth * 0.6) warn('入口倒角偏大，会吃掉螺纹圈数');
    if (extLen > 40) warn('延长 ' + FSG.fmt(extLen, 1) + ' mm 较长，打印时注意刚性');
    H = boardT + extLen;
    out.extKind = 'cone';
    out.extLen = extLen; out.extDepth = extDepth;
    out.extRootD = extRootD; out.extInnerRootD = extInnerRootD;
    out.extTipD = extTipD; out.extCrestD = extCrestD;
    out.extWall = extWall; out.extThread = extTh; out.extTurns = extTurns;
  }

  /* ================= 单板 ================= */
  if (mode === 'board') {
    var bossH = FSG.toNum(p.bossH, 0);
    var bossD = FSG.BOSS_D;
    var bossTipD = bossD, bossWall = 0, bossAngle = 0;
    if (!(bossH >= 0 && bossH <= FSG.BOSS_MAX)) bad('凸台高度需在 0 – ' + FSG.BOSS_MAX + ' mm 之间');
    var hasBoss = bossH > 1e-9;
    bossTipD = hasBoss ? Math.min(bossD, dReq + 2 * FSG.BOSS_WALL) : bossD;
    bossWall = hasBoss ? (bossTipD - dReq) / 2 : 0;
    if (hasBoss) {
      if (bossD - bossTipD > 1e-9) bossAngle = Math.atan2((bossD - bossTipD) / 2, bossH) * 180 / Math.PI;
      if (bossWall < FSG.MIN_WALL) {
        bad('孔/螺纹太大：凸台壁厚只剩 ' + FSG.fmt(bossWall, 2) + ' mm（至少 ' + FSG.MIN_WALL +
          ' mm）；有凸台时最大 ⌀' + FSG.fmt(bossD - 2 * FSG.MIN_WALL, 2) + '，或把凸台设为 0');
      } else if (bossWall < 2.5) warn('凸台壁厚 ' + FSG.fmt(bossWall, 2) + ' mm，偏薄');
      if (dReq + 2 * FSG.BOSS_WALL > bossD + 1e-9) {
        warn('孔径较大：尖端已收到根部 ⌀' + FSG.fmt(bossD, 2) + '，凸台变成直筒，实际壁厚 ' + FSG.fmt(bossWall, 2) + ' mm');
      }
      if (bossAngle > 60) warn('锥面很平（与轴线 ' + FSG.fmt(bossAngle, 1) + '°），打印时凸台下方需要支撑');
    }
    var maxBore = hasBoss ? (bossD - 2 * FSG.MIN_WALL) : 74;
    checkHole(maxBore, hasBoss ? '有凸台时' : '平底板');
    H = boardT + bossH;
    out.bossH = bossH; out.bossD = bossD; out.bossTipD = bossTipD;
    out.bossWall = bossWall; out.bossAngle = bossAngle; out.hasBoss = hasBoss;
    out.maxBore = maxBore;
    out.thread = holeMode === 'thread' ? th : null;
    out.threadLen = holeMode === 'thread' ? H : 0;
    out.turns = holeMode === 'thread' ? H / thrP : 0;
    if (holeMode === 'thread' && out.turns < 1.5) warn('螺纹只有 ' + FSG.fmt(out.turns, 2) + ' 圈，建议加大凸台或减小牙距');
  }

  out.H = H;
  out.ok = errors.length === 0;
  return out;
};

/* ---------- URL hash ---------- */
FSG.hashState = { view: 'iso', dims: 1, section: 0, wire: 0, auto: 0, ui: 1, freeze: 0 };

FSG.paramsFromHash = function (hash) {
  var p = FSG.defaults();
  var state = FSG.clone(FSG.hashState);
  if (!hash) return { params: p, state: state };
  var body = String(hash).replace(/^#/, '');
  var kv = {};
  body.split('&').forEach(function (part) {
    if (!part) return;
    var eq = part.indexOf('=');
    if (eq < 0) { kv[decodeURIComponent(part)] = ''; return; }
    kv[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
  });
  function num(key, fallback) {
    if (kv[key] === undefined || kv[key] === '') return fallback;
    var v = Number(kv[key]);
    return isFinite(v) ? v : fallback;
  }
  if (kv.b === 'A' || kv.b === 'B') p.board = kv.b;
  if (kv.h === 'plain' || kv.h === 'thread') p.holeMode = kv.h;
  if (kv.t !== undefined) p.threadKey = kv.t;
  if (kv.et !== undefined) p.extThreadKey = kv.et;
  if (kv.m === 'board' || kv.m === 'cone' || kv.m === 'box') p.mode = kv.m;
  else if (kv.e !== undefined) p.mode = (kv.e === '1') ? 'cone' : 'board';
  p.boxLen = num('bl', p.boxLen);
  p.boxWall = num('bw', p.boxWall);
  p.extLen = num('el', p.extLen);
  p.extOuterD = num('eo', p.extOuterD);
  p.extDepth = num('ed', p.extDepth);
  p.extThreadD = num('eD', p.extThreadD);
  p.extThreadP = num('eP', p.extThreadP);
  p.bossH = num('bh', p.bossH);
  p.holeD = num('d', p.holeD);
  p.threadD = num('D', p.threadD);
  p.threadP = num('P', p.threadP);
  p.gap = num('g', p.gap);
  p.frontChamfer = num('fc', p.frontChamfer);
  p.meshN = num('n', p.meshN);
  if (kv.view !== undefined) state.view = kv.view;
  ['dims', 'section', 'wire', 'auto', 'ui', 'freeze'].forEach(function (k) {
    if (kv[k] !== undefined) state[k] = (kv[k] === '1' || kv[k] === 'true') ? 1 : 0;
  });
  return { params: p, state: state };
};

FSG.hashFromParams = function (p, state) {
  var parts = [];
  parts.push('m=' + p.mode);
  parts.push('b=' + p.board);
  parts.push('h=' + p.holeMode);
  parts.push('t=' + p.threadKey);
  if (p.holeMode === 'plain') parts.push('d=' + FSG.fmt(p.holeD, 2));
  if (p.threadKey === 'custom') {
    parts.push('D=' + FSG.fmt(p.threadD, 2));
    parts.push('P=' + FSG.fmt(p.threadP, 3));
  }
  if (p.mode === 'board') parts.push('bh=' + FSG.fmt(p.bossH, 2));
  if (p.mode === 'box') {
    parts.push('bl=' + FSG.fmt(p.boxLen, 1));
    parts.push('bw=' + FSG.fmt(p.boxWall, 2));
  }
  if (p.mode === 'cone') {
    parts.push('el=' + FSG.fmt(p.extLen, 2));
    parts.push('eo=' + FSG.fmt(p.extOuterD, 1));
    parts.push('ed=' + FSG.fmt(p.extDepth, 2));
    parts.push('et=' + p.extThreadKey);
    if (p.extThreadKey === 'custom') {
      parts.push('eD=' + FSG.fmt(p.extThreadD, 2));
      parts.push('eP=' + FSG.fmt(p.extThreadP, 3));
    }
  }
  parts.push('g=' + FSG.fmt(p.gap, 2));
  if (p.frontChamfer) parts.push('fc=' + FSG.fmt(p.frontChamfer, 2));
  if (Number(p.meshN) !== 360) parts.push('n=' + Math.round(p.meshN));
  var st = state || {};
  if (st.view && st.view !== 'iso') parts.push('view=' + st.view);
  if (st.dims) parts.push('dims=1');
  if (st.section) parts.push('section=1');
  if (st.wire) parts.push('wire=1');
  if (st.auto) parts.push('auto=1');
  if (st.ui === 0) parts.push('ui=0');
  if (st.freeze) parts.push('freeze=1');
  return '#' + parts.join('&');
};

/* ---------- 参数摘要 ---------- */
FSG.paramsReport = function (d, extra) {
  var p = d.params;
  var lines = [];
  lines.push('ALPA 镜头板 · 参数摘要（' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '）');
  lines.push('================================================');
  lines.push('形态        : ' + (d.mode === 'board' ? '单板' : (d.mode === 'cone' ? '锥形延长' : '方箱延长')));
  lines.push('板型        : ' + d.boardName + '（板体 ' + FSG.fmt(d.boardT, 1) + ' mm）');
  lines.push('外形        : ' + FSG.fmt(d.W, 2) + ' × ' + FSG.fmt(d.W, 2) + ' mm，总高 ' + FSG.fmt(d.H, 2) + ' mm');
  if (d.mode === 'box') {
    lines.push('分段        : 底板 ' + FSG.fmt(d.boardT, 1) + ' + 方桶 ' + FSG.fmt(d.boxTubeLen, 2) +
      ' + 顶板 ' + FSG.fmt(d.topT, 1) + ' = ' + FSG.fmt(d.boxLen, 2));
    lines.push('桶截面      : 外 ' + FSG.fmt(d.W, 2) + ' 方 / 内 ' + FSG.fmt(d.boxInner, 2) + ' 方（壁厚 ' + FSG.fmt(d.boxWall, 2) + '）');
  } else if (d.mode === 'cone') {
    lines.push('延长段      : 锥筒长 ' + FSG.fmt(d.extLen, 2) + ' mm');
    lines.push('外锥        : 根部 ⌀' + FSG.fmt(d.extRootD, 2) + ' → 尖端 ⌀' + FSG.fmt(d.extTipD, 2));
    lines.push('内锥        : 根部 ⌀' + FSG.fmt(d.extInnerRootD, 2) + ' → 牙顶 ⌀' + FSG.fmt(d.extCrestD, 2) +
      '（等壁厚 ' + FSG.fmt(d.extWall, 2) + '）');
    lines.push('顶端螺纹    : ' + (p.extThreadKey === 'custom' ? '自定义' : d.extThread.key) +
      ' 深 ' + FSG.fmt(d.extDepth, 2) + ' mm（' + FSG.fmt(d.extTurns, 2) + ' 圈）');
  } else if (d.bossH > 1e-9) {
    lines.push('凸台        : 根部 ⌀' + FSG.fmt(d.bossD, 2) + ' → 尖端 ⌀' + FSG.fmt(d.bossTipD, 2) +
      '（与轴线 ' + FSG.fmt(d.bossAngle, 1) + '°，壁厚 ' + FSG.fmt(d.bossWall, 2) + '），高 ' + FSG.fmt(d.bossH, 2));
  } else {
    lines.push('凸台        : 无（平底 78 方面）');
  }
  if (d.mode === 'cone') {
    /* 锥形延长的开口已在上面写过 */
  } else if (d.holeMode === 'thread') {
    lines.push((d.mode === 'box' ? '顶面开口    : ' : '镜头侧开口  : ') + '内螺纹 ' + d.thread.key +
      '  ⌀' + FSG.fmt(d.thread.D, 2) + ' × ' + FSG.fmt(d.thread.P, 2) + '，小径 ⌀' + FSG.fmt(d.thread.D1, 2) +
      '，长 ' + FSG.fmt(d.threadLen, 2) + ' mm（' + FSG.fmt(d.turns, 2) + ' 圈），间隙 +' + FSG.fmt(d.gap, 2));
  } else {
    lines.push((d.mode === 'box' ? '顶面开口    : ' : '镜头侧开口  : ') + '圆孔 ⌀' + FSG.fmt(d.holeD, 2) + ' mm');
  }
  lines.push('孔口倒角    : ' + FSG.fmt(d.frontChamfer, 2) + ' mm');
  lines.push('网格        : ' + d.meshN + ' 段/圈');
  lines.push('长度定义    : 相机侧贴合面(z=0) → 镜头侧端面(z=H)');
  if (extra) { lines.push(''); extra.forEach(function (s) { lines.push(s); }); }
  return lines.join('\n') + '\n';
};
