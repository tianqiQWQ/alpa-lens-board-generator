/* ============================================================
 * 10-geometry.js — ALPA 镜头板 / 延长桶 解析几何核
 *
 * 模型抽象：把零件看成「沿 z 轴扫掠的闭合剖面」。
 *   对每个角度参数 t∈[0,1)，在 (r,z) 半平面里取一条闭合折线：
 *     外轮廓链（z 升序）→ 镜头侧端面 → 内孔链（倒序）→ 相机侧端面
 *   把这条折线绕 z 轴扫一圈即得实体网格；t 方向上顶点一一对应，
 *   因此天然水密、无自交、无需布尔运算。
 *
 * 轮廓：圆角方（roundRect）/ 圆（circle）/ 内螺纹（thread，半径随 z 与 t 变化）
 * 台阶：链里同一 z 的两个节点 → 平面环带
 * 锥面：链里不同 z、不同半径 → 锥带
 *
 * 坐标：z=0 相机侧贴合面，z=L 镜头侧端面；XY 关于原点对称。
 * ============================================================ */
'use strict';

FSG.Geometry = (function () {
  'use strict';
  var TAU = Math.PI * 2;

  /* ---------------- 形状 ---------------- */
  function circleShape(d) { return { kind: 'circle', r: d / 2 }; }
  function rrShape(w, r) { return { kind: 'rr', h: w / 2, R: Math.min(r, w / 2 - 1e-9) }; }
  function threadShape(th, gap, z0) { return { kind: 'thread', th: th, gap: gap, z0: z0 }; }

  /* 88.5 方 + 阶梯切角轮廓（参考件 ALPA猪嘴 的外观）：半宽 1 归一化多边形 */
  var STEP_POLY = null;
  function stepPoly() {
    if (STEP_POLY) return STEP_POLY;
    var A = [44.25, 26], B = [42, 28.9], C = [42, 36], D = [36, 42], E = [28.9, 42], F = [26, 44.25];
    /* 弧按给定圆心/半径采样，两端强制落到给定顶点（STEP 里实际顶点与圆弧有 ~0.005 mm 偏差） */
    function arc(cx, cz, r, a0, a1, n, p0, p1) {
      var out = [];
      for (var k = 0; k <= n; k++) {
        var a = a0 + (a1 - a0) * k / n;
        out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
      }
      out[0] = p0; out[n] = p1;
      return out;
    }
    /* 一个角：A -R3-> B —线— C -R6-> D —线— E -R3-> F */
    var corner = [A];
    corner = corner.concat(arc(45, 28.9, 3, Math.atan2(A[1] - 28.9, A[0] - 45), -Math.PI, 6, A, B).slice(1));
    corner.push(C);
    corner = corner.concat(arc(36, 36, 6, 0, Math.PI / 2, 8, C, D).slice(1));
    corner.push(E);
    corner = corner.concat(arc(28.9, 45, 3, Math.atan2(E[1] - 45, E[0] - 28.9), Math.atan2(F[1] - 45, F[0] - 28.9), 6, E, F).slice(1));
    var poly = [];
    for (var q = 0; q < 4; q++) {
      var ang = q * Math.PI / 2, ca = Math.cos(ang), sa = Math.sin(ang);
      for (var m = 0; m < corner.length; m++) {
        var x = corner[m][0], z = corner[m][1];
        poly.push([(x * ca - z * sa) / 44.25, (x * sa + z * ca) / 44.25]);
      }
    }
    STEP_POLY = poly;
    return poly;
  }
  function stepShape(w) { return { kind: 'step', h: w / 2 }; }

  /* 角部外壁凹槽（参考件：8 个 R8 圆柱面，位置 (±45,±28.9)/(±28.9,±45)）
     用射线法：外轮廓取 step 与 8 个圆盘入射点的最小值，再保证与内腔至少 minW 壁厚 */
  var SCALLOP_CENTERS = [[45, 28.9], [45, -28.9], [-45, 28.9], [-45, -28.9],
    [28.9, 45], [-28.9, 45], [28.9, -45], [-28.9, -45]];
  function scallopShape(w, cav, minW) {
    return { kind: 'scallop', h: w / 2, k: (w / 2) / 44.25, cav: cav, minW: minW, R: 8.0 };
  }
  function scallopRadius(sh, t) {
    var a = t * TAU, dx = Math.cos(a), dz = Math.sin(a);
    var r = stepRadius(sh.h, t);
    for (var i = 0; i < SCALLOP_CENTERS.length; i++) {
      var cx = SCALLOP_CENTERS[i][0] * sh.k, cz = SCALLOP_CENTERS[i][1] * sh.k;
      var b = dx * cx + dz * cz;
      var c2 = cx * cx + cz * cz;
      var disc = b * b - (c2 - sh.R * sh.R);
      if (disc <= 0) continue;
      var t1 = b - Math.sqrt(disc);
      if (t1 > 1e-6 && t1 < r) r = t1;
    }
    if (sh.cav) {
      var ri = polyRadius(sh.cav.pts, t) + sh.minW;
      if (r < ri) r = ri;
    }
    return r;
  }

  /* 显式多边形（星形区域）：用于带光陷阱凹槽的内腔 */
  function polyShape(pts) { return { kind: 'poly', pts: pts }; }
  function polyRadius(pts, t) {
    var a = t * TAU, dx = Math.cos(a), dz = Math.sin(a);
    var best = Infinity, n = pts.length;
    for (var i = 0; i < n; i++) {
      var p1 = pts[i], p2 = pts[(i + 1) % n];
      var ex = p2[0] - p1[0], ez = p2[1] - p1[1];
      var den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-14) continue;
      var sp = (p1[0] * dz - p1[1] * dx) / den;
      var u = (p1[0] * ez - p1[1] * ex) / den;
      if (sp >= -1e-9 && sp <= 1 + 1e-9 && u > 1e-9 && u < best) best = u;
    }
    return best === Infinity ? 1 : best;
  }
  /* 内腔：R3 圆角方（边长 w）+ 四面墙中间的光陷阱凹台（深 depth、半宽 halfW、倒角 1.25×1.69）—— 按 3MF 实测 */
  function cavityShape(w, depth, halfW) {
    var h = w / 2, rc = 3.0, cw = 1.25, cz = 1.69;
    var pts = [];
    function P(x, z) { pts.push([x, z]); }
    function arc(cx, cz2, r, a0, a1, n) {
      for (var k = 1; k <= n; k++) {
        var a = a0 + (a1 - a0) * k / n;
        P(cx + r * Math.cos(a), cz2 + r * Math.sin(a));
      }
    }
    P(h, -(halfW + cz)); P(h + depth, -halfW); P(h + depth, halfW); P(h, halfW + cz);
    P(h, h - rc); arc(h - rc, h - rc, rc, 0, Math.PI / 2, 6);
    P(halfW + cz, h); P(halfW, h + depth); P(-halfW, h + depth); P(-(halfW + cz), h);
    P(-(h - rc), h); arc(-(h - rc), h - rc, rc, Math.PI / 2, Math.PI, 6);
    P(-h, halfW + cz); P(-h - depth, halfW); P(-h - depth, -halfW); P(-h, -(halfW + cz));
    P(-h, -(h - rc)); arc(-(h - rc), -(h - rc), rc, Math.PI, 1.5 * Math.PI, 6);
    P(-(halfW + cz), -h); P(-halfW, -h - depth); P(halfW, -h - depth); P(halfW + cz, -h);
    P(h - rc, -h); arc(h - rc, -(h - rc), rc, 1.5 * Math.PI, 2 * Math.PI, 6);
    return polyShape(pts);
  }
  function stepRadius(h, t) {
    var poly = stepPoly();
    var a = t * TAU, dx = Math.cos(a), dz = Math.sin(a);
    var best = Infinity, n = poly.length;
    for (var i = 0; i < n; i++) {
      var p1 = poly[i], p2 = poly[(i + 1) % n];
      var ex = p2[0] - p1[0], ez = p2[1] - p1[1];
      var den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-14) continue;
      var s = (p1[0] * dz - p1[1] * dx) / den;
      var u = (p1[0] * ez - p1[1] * ex) / den;
      if (s >= -1e-9 && s <= 1 + 1e-9 && u > 1e-9 && u < best) best = u;
    }
    return (best === Infinity ? 1 : best) * h;
  }

  /* 圆角方：沿角度 t 的射线与轮廓交点（到原点距离） */
  function rrRadius(h, R, t) {
    var a = t * TAU;
    var ux = Math.abs(Math.cos(a));
    var uy = Math.abs(Math.sin(a));
    var c = h - R;
    if (c <= 1e-9) return h;
    var s = c * (ux + uy);
    var disc = s * s - 2 * c * c + R * R;
    if (disc < 0) disc = 0;
    var tc = s + Math.sqrt(disc);
    if (tc * ux > c - 1e-7 && tc * uy > c - 1e-7) return tc;
    return h / Math.max(ux, uy, 1e-12);
  }

  /* 内螺纹：ISO 基本牙型（牙顶平 P/8、牙根平 P/4、牙侧 30°），沿 z 上升 +t 相位 */
  function threadRadius(shape, t, z) {
    var th = shape.th, P = th.P;
    var ph = (z - shape.z0) / P - t;
    ph = ph - Math.floor(ph);
    var r0 = th.D1 / 2 + shape.gap;   // 牙顶（内孔最小）
    var r1 = th.D / 2 + shape.gap;    // 牙根（内孔最大）
    var A = 0.125, B = 0.4375, C = 0.6875;
    if (ph < A) return r0;
    if (ph < B) return r0 + (r1 - r0) * (ph - A) / (B - A);
    if (ph < C) return r1;
    return r1 - (r1 - r0) * (ph - C) / (1 - C);
  }

  function radiusAt(shape, t, z) {
    if (shape.kind === 'circle') return shape.r;
    if (shape.kind === 'rr') return rrRadius(shape.h, shape.R, t);
    if (shape.kind === 'step') return stepRadius(shape.h, t);
    if (shape.kind === 'poly') return polyRadius(shape.pts, t);
    if (shape.kind === 'scallop') return scallopRadius(shape, t);
    if (shape.kind === 'thread') return threadRadius(shape, t, z);
    return 0;
  }

  /* ---------------- 剖面（链） ---------------- */
  function sameShape(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === 'circle') return Math.abs(a.r - b.r) < 1e-9;
    if (a.kind === 'rr') return Math.abs(a.h - b.h) < 1e-9 && Math.abs(a.R - b.R) < 1e-9;
    if (a.kind === 'step') return Math.abs(a.h - b.h) < 1e-9;
    if (a.kind === 'poly') return a === b;
    if (a.kind === 'scallop') return a === b;
    return a === b;
  }

  function buildProfile(d) {
    var outer = [], inner = [];
    var T = d.boardT, H = d.H;
    var i;

    function pushOuter(z, shape) {
      var n = outer.length;
      if (n && Math.abs(outer[n - 1].z - z) < 1e-9 && sameShape(outer[n - 1].shape, shape)) return;
      outer.push({ z: z, shape: shape });
    }
    function pushInner(z, shape) {
      var n = inner.length;
      if (n && Math.abs(inner[n - 1].z - z) < 1e-9 && sameShape(inner[n - 1].shape, shape)) return;
      inner.push({ z: z, shape: shape });
    }

    /* ================= 方箱形态：底板 + 方桶 + 顶板开孔 ================= */
    if (d.mode === 'box') {
      var innerW = d.boxInner;
      var topT = d.topT || 3;
      /* 外形：底板 = ALPA 板层级（78 R4 / 82.5 R5 / 88.5 R8）；桶身 + 顶板 = 88.5 阶梯切角 */
      pushOuter(0.0, rrShape(78, 4));
      pushOuter(1.0, rrShape(78, 4));
      pushOuter(1.0, rrShape(82.5, 5));
      if (d.board === 'A') pushOuter(1.6, rrShape(82.5, 5));
      pushOuter(1.6, rrShape(88.5, 8));
      pushOuter(T, rrShape(88.5, 8));
      pushOuter(T, stepShape(88.5));
      pushOuter(H, stepShape(88.5));

      var fcB = d.frontChamfer || 0;
      if (fcB > topT * 0.6) fcB = topT * 0.6;
      var zTop = H - topT;
      /* 内腔：底板处浅凹台（0.5），桶身全深（1.25） */
      /* 底板开口固定为参考件尺寸（不随壁厚变化），只有桶身内腔跟随壁厚 */
      var cavEntry = cavityShape(76, 0.5, 23.34);
      var cavFull = cavityShape(innerW, 1.25, 23.34);
      pushInner(0.0, cavEntry);
      pushInner(T, cavEntry);
      pushInner(T, cavFull);
      pushInner(zTop, cavFull);
      if (d.holeMode === 'thread') {
        var bth = d.thread;
        var stepB = bth.P / 16;
        var nB = Math.max(1, Math.ceil((H - fcB - zTop) / stepB - 1e-9));
        var bShape = threadShape(bth, d.gap, zTop);
        pushInner(zTop, bShape);
        for (i = 1; i <= nB; i++) pushInner(zTop + (H - fcB - zTop) * i / nB, bShape);
        if (fcB > 0) pushInner(H, circleShape((bth.D / 2 + d.gap + fcB) * 2));
      } else {
        var bd = circleShape(d.holeD);
        pushInner(zTop, bd);
        pushInner(H - fcB, bd);
        if (fcB > 0) pushInner(H, circleShape(d.holeD + 2 * fcB));
      }
      return { outer: outer, inner: inner, zMax: H };
    }


    /* ================= 锥形延长形态：板体 + 外锥/内锥锥筒 + 顶端螺纹 ================= */
    if (d.mode === 'cone') {
      pushOuter(0.0, rrShape(78, 4));
      pushOuter(1.0, rrShape(78, 4));
      pushOuter(1.0, rrShape(82.5, 5));
      if (d.board === 'A') pushOuter(1.6, rrShape(82.5, 5));
      pushOuter(1.6, rrShape(88.5, 8));
      pushOuter(T, rrShape(88.5, 8));
      /* 外锥：从 88.5 面上的 ⌀80 收到顶端 ⌀(螺纹+10) */
      pushOuter(T, circleShape(d.extRootD));
      pushOuter(H, circleShape(d.extTipD));

      var extTh = d.extThread;
      var fc2 = d.frontChamfer || 0;
      if (fc2 > d.extDepth * 0.6) fc2 = d.extDepth * 0.6;
      var zThreadStart = H - d.extDepth;
      /* 内锥：相机侧 ⌀76 → 螺纹牙顶（自动连成一条锥） */
      pushInner(0.0, circleShape(d.extInnerRootD));
      pushInner(zThreadStart, circleShape(d.extCrestD));
      /* 顶端螺纹段 */
      var stepT = extTh.P / 16;
      var nT = Math.max(1, Math.ceil((H - fc2 - zThreadStart) / stepT - 1e-9));
      var extHoleShape = threadShape(extTh, d.gap, zThreadStart);
      for (i = 0; i <= nT; i++) pushInner(zThreadStart + (H - fc2 - zThreadStart) * i / nT, extHoleShape);
      if (fc2 > 0) pushInner(H, circleShape((extTh.D / 2 + d.gap + fc2) * 2));

      return { outer: outer, inner: inner, zMax: H };
    }

    /* ---- 外轮廓：凸台（可选）+ 78 / 82.5 / 88.5 三级板体 ---- */
    var h = Math.max(0, d.bossH);
    if (h > 1e-9) {
      pushOuter(0.0, circleShape(d.bossTipD));
      pushOuter(h, circleShape(d.bossD));
    }
    pushOuter(h, rrShape(78, 4));
    pushOuter(h + 1.0, rrShape(78, 4));
    pushOuter(h + 1.0, rrShape(82.5, 5));
    if (d.board === 'A') pushOuter(h + 1.6, rrShape(82.5, 5));
    pushOuter(h + 1.6, rrShape(88.5, 8));
    pushOuter(H, rrShape(88.5, 8));

    /* ---- 内孔：贯通板体 + 凸台 ---- */
    var fc = d.frontChamfer || 0;
    if (fc > H * 0.6) fc = H * 0.6;                   /* 倒角不能吃掉整段螺纹 */
    var zHoleTop = H - fc;
    var th = d.thread;
    var holeShape = (d.holeMode === 'thread')
      ? threadShape(th, d.gap, 0.0)
      : circleShape(d.holeD);
    var rTopChamfer = (d.holeMode === 'thread')
      ? (th.D / 2 + d.gap + fc)
      : (d.holeD / 2 + fc);

    if (d.holeMode === 'thread') {
      var step = th.P / 16;
      var n = Math.max(1, Math.ceil(zHoleTop / step - 1e-9));
      for (i = 0; i <= n; i++) pushInner(zHoleTop * i / n, holeShape);
    } else {
      pushInner(0.0, holeShape);
      pushInner(zHoleTop, holeShape);
    }
    if (fc > 0) pushInner(H, circleShape(rTopChamfer * 2));

    return { outer: outer, inner: inner, zMax: H };
  }

  /* ---------------- 网格 ---------------- */
  function buildMesh(prof, N) {
    var O = prof.outer.length, I = prof.inner.length, M = O + I;
    var pos = new Float32Array(N * M * 3);
    var idx = new Uint32Array(N * M * 6);
    var i, j, t, a, r, z;
    for (i = 0; i < N; i++) {
      t = i / N;
      a = t * TAU;
      var ca = Math.cos(a), sa = Math.sin(a);
      for (j = 0; j < O; j++) {
        z = prof.outer[j].z;
        r = radiusAt(prof.outer[j].shape, t, z);
        var p = (i * M + j) * 3;
        pos[p] = r * ca; pos[p + 1] = r * sa; pos[p + 2] = z;
      }
      for (j = 0; j < I; j++) {
        var node = prof.inner[I - 1 - j];
        z = node.z;
        r = radiusAt(node.shape, t, z);
        var q = (i * M + O + j) * 3;
        pos[q] = r * ca; pos[q + 1] = r * sa; pos[q + 2] = z;
      }
    }
    var k = 0;
    for (i = 0; i < N; i++) {
      var i2 = (i + 1) % N;
      for (j = 0; j < M; j++) {
        var j2 = (j + 1) % M;
        var v00 = i * M + j, v01 = i * M + j2, v11 = i2 * M + j2, v10 = i2 * M + j;
        idx[k++] = v00; idx[k++] = v10; idx[k++] = v11;
        idx[k++] = v00; idx[k++] = v11; idx[k++] = v01;
      }
    }
    return { positions: pos, indices: idx };
  }

  function signedVolume(pos, idx) {
    var v = 0;
    for (var i = 0; i < idx.length; i += 3) {
      var a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      var ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
      var bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
      var cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
  }

  function flipWinding(idx) {
    for (var i = 0; i < idx.length; i += 3) {
      var t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t;
    }
  }

  function bboxOf(pos) {
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < pos.length; i += 3) {
      for (var k = 0; k < 3; k++) {
        var v = pos[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
    return { min: min, max: max };
  }

  /* 水密检查：每条边恰好被 2 个三角形使用 */
  function manifoldReport(idx) {
    var map = new Map();
    for (var i = 0; i < idx.length; i += 3) {
      for (var k = 0; k < 3; k++) {
        var a = idx[i + k], b = idx[i + (k + 1) % 3];
        var key = a < b ? (a + ',' + b) : (b + ',' + a);
        map.set(key, (map.get(key) || 0) + 1);
      }
    }
    var bad = 0, boundary = 0;
    map.forEach(function (n) { if (n === 2) return; if (n === 1) boundary++; else bad++; });
    return { edges: map.size, boundary: boundary, nonManifold: bad, watertight: boundary === 0 && bad === 0 };
  }

  /* ---------------- 三角化（剖面封盖） ---------------- */
  function earClip(poly) {
    /* poly: [[x,z],...] 逆时针；返回索引三元组 */
    var n = poly.length;
    var V = [];
    for (var i = 0; i < n; i++) V.push(i);
    function area2(a, b, c) {
      return (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) -
             (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
    }
    function inside(p, a, b, c) {
      var d1 = area2(a, b, p), d2 = area2(b, c, p), d3 = area2(c, a, p);
      return d1 > 1e-12 && d2 > 1e-12 && d3 > 1e-12;
    }
    var tris = [];
    var guard = 0;
    while (V.length > 3 && guard++ < 4000) {
      var found = false;
      for (var k = 0; k < V.length; k++) {
        var i0 = V[(k + V.length - 1) % V.length], i1 = V[k], i2 = V[(k + 1) % V.length];
        if (area2(i0, i1, i2) <= 1e-12) continue;
        var ok = true;
        for (var m = 0; m < V.length; m++) {
          var p = V[m];
          if (p === i0 || p === i1 || p === i2) continue;
          if (inside(p, i0, i1, i2)) { ok = false; break; }
        }
        if (!ok) continue;
        tris.push([i0, i1, i2]);
        V.splice(k, 1);
        found = true;
        break;
      }
      if (!found) break;
    }
    if (V.length === 3) tris.push([V[0], V[1], V[2]]);
    return tris;
  }

  /* 剖面：y=0 平面上的封盖（左右两半，供 3D 剖视用） */
  function sectionMesh(d) {
    var prof = buildProfile(d);
    var nodes = prof.outer.concat(prof.inner.slice().reverse());
    var pos = [], idx = [];
    for (var side = 0; side < 2; side++) {
      var t = side ? 0.5 : 0;
      var sgn = side ? -1 : 1;
      var poly = [], i;
      for (i = 0; i < nodes.length; i++) poly.push([radiusAt(nodes[i].shape, t, nodes[i].z), nodes[i].z]);
      var clean = [];
      for (i = 0; i < poly.length; i++) {
        var p = poly[i], q = poly[(i + 1) % poly.length];
        if (Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9) continue;
        clean.push(p);
      }
      var area = 0;
      for (i = 0; i < clean.length; i++) {
        var a0 = clean[i], b0 = clean[(i + 1) % clean.length];
        area += a0[0] * b0[1] - b0[0] * a0[1];
      }
      if (area < 0) clean.reverse();
      var tris = earClip(clean);
      var base = pos.length / 3;
      for (i = 0; i < clean.length; i++) pos.push(sgn * clean[i][0], 0, clean[i][1]);
      for (i = 0; i < tris.length; i++) {
        if (sgn > 0) idx.push(base + tris[i][0], base + tris[i][1], base + tris[i][2]);
        else idx.push(base + tris[i][0], base + tris[i][2], base + tris[i][1]);
      }
    }
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  }

  /* ---------------- 对外构建 ---------------- */
  function build(params) {
    var d = FSG.derive(params);
    if (!d.ok) return { ok: false, derived: d, error: d.errors[0] };
    var prof = buildProfile(d);
    var N = Math.max(120, Math.min(1440, Math.round(d.meshN)));
    var mesh = buildMesh(prof, N);
    var vol = signedVolume(mesh.positions, mesh.indices);
    if (vol < 0) { flipWinding(mesh.indices); vol = -vol; }
    var bbox = bboxOf(mesh.positions);
    var man = manifoldReport(mesh.indices);
    return {
      ok: true,
      derived: d,
      positions: mesh.positions,
      indices: mesh.indices,
      audit: {
        vertices: mesh.positions.length / 3,
        triangles: mesh.indices.length / 3,
        volume: vol,
        bboxMin: bbox.min, bboxMax: bbox.max,
        watertight: man.watertight, boundaryEdges: man.boundary, nonManifoldEdges: man.nonManifold,
        profileNodes: prof.outer.length + prof.inner.length,
        rings: N
      }
    };
  }

  return {
    build: build,
    buildProfile: buildProfile,
    sectionMesh: sectionMesh,
    signedVolume: signedVolume,
    manifoldReport: manifoldReport,
    bboxOf: bboxOf,
    radiusAt: radiusAt,
    circleShape: circleShape,
    rrShape: rrShape,
    polyShape: polyShape,
    cavityShape: cavityShape,
    stepShape: stepShape,
    scallopShape: scallopShape,
    threadShape: threadShape,
    _rrRadius: rrRadius,
    _threadRadius: threadRadius
  };
})();
