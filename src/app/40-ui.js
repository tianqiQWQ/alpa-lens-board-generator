/* ============================================================
 * 40-ui.js — 参数面板 / 重建 / 导出 / 提示
 * ============================================================ */
'use strict';

FSG.UI = (function () {
  'use strict';

  var params = null, state = null, sceneApi = null, onResult = null;
  var result = null, derived = null;
  var timer = null;

  function $(id) { return document.getElementById(id); }

  function toast(msg, isErr) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = (isErr ? 'err ' : '') + 'show';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = isErr ? 'err' : ''; }, 2200);
  }

  function fillSelects() {
    ['threadKey', 'extThreadKey'].forEach(function (id) {
      var sel = $(id);
      sel.innerHTML = '';
      FSG.THREADS.forEach(function (t) {
        var o = document.createElement('option');
        o.value = t.key;
        o.textContent = t.label;
        sel.appendChild(o);
      });
    });
    var pv = $('presets');
    pv.innerHTML = '';
    FSG.PRESETS.forEach(function (preset) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = preset.label;
      b.setAttribute('data-preset', preset.key);
      b.addEventListener('click', function () { applyPreset(preset); });
      pv.appendChild(b);
    });
  }

  function applyPreset(preset) {
    var base = FSG.defaults();
    Object.keys(preset.params).forEach(function (k) { base[k] = preset.params[k]; });
    params = base;
    syncForm();
    rebuild();
    toast('已应用：' + preset.label);
  }

  /* ---------- DOM <-> params ---------- */
  function num(id, fallback) {
    var v = Number($(id).value);
    return isFinite(v) ? v : fallback;
  }

  function readForm() {
    params.board = document.querySelector('#boardSeg button.on').getAttribute('data-board');
    params.holeMode = document.querySelector('#holeSeg button.on').getAttribute('data-hole');
    params.holeD = num('holeD', 35);
    params.threadKey = $('threadKey').value;
    params.threadD = num('threadD', 65);
    params.threadP = num('threadP', 1);
    params.gap = num('gap', 0.15);
    params.frontChamfer = num('frontChamfer', 0);
    params.bossH = num('bossHNum', 0);
    params.mode = document.querySelector('#modeSeg button.on').getAttribute('data-mode');
    params.boxLen = num('boxLen', 130);
    params.boxWall = num('boxWall', 6.25);
    params.extLen = num('extLen', 21.4);
    params.extOuterD = num('extOuterD', 80);
    params.extDepth = num('extDepth', 5);
    params.extThreadKey = $('extThreadKey').value;
    params.extThreadD = num('extThreadD', 42);
    params.extThreadP = num('extThreadP', 1);
    params.meshN = Number($('meshN').value) || 360;
    return params;
  }

  function setSeg(segId, attr, value) {
    var btns = document.querySelectorAll('#' + segId + ' button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].className = (btns[i].getAttribute(attr) === String(value)) ? 'on' : '';
    }
  }

  function syncForm() {
    setSeg('boardSeg', 'data-board', params.board);
    setSeg('holeSeg', 'data-hole', params.holeMode);
    $('holeD').value = params.holeD;
    $('threadKey').value = params.threadKey;
    $('threadD').value = params.threadD;
    $('threadP').value = params.threadP;
    $('gap').value = params.gap;
    $('frontChamfer').value = params.frontChamfer;
    $('bossH').value = params.bossH;
    $('bossHNum').value = params.bossH;
    setSeg('modeSeg', 'data-mode', params.mode);
    $('boxLen').value = params.boxLen;
    $('boxWall').value = params.boxWall;
    $('extLen').value = params.extLen;
    $('extOuterD').value = params.extOuterD;
    $('extDepth').value = params.extDepth;
    $('extThreadKey').value = params.extThreadKey || 'M42x1';
    $('extThreadD').value = params.extThreadD;
    $('extThreadP').value = params.extThreadP;
    $('meshN').value = String(params.meshN);
    $('boardDesc').textContent = FSG.BOARD_INFO[params.board].desc;
    refreshVisibility();
  }

  /* 本地快速估算（供输入时即时反馈；最终以 derive 为准） */
  function localBoss() {
    var h = Math.max(0, Math.min(FSG.BOSS_MAX, Number(params.bossH) || 0));
    var th = FSG.threadInfo(params);
    var dReq = (params.holeMode === 'thread') ? th.D : (Number(params.holeD) || 35);
    var root = FSG.BOSS_D;
    var tip = h > 1e-9 ? Math.min(root, dReq + 2 * FSG.BOSS_WALL) : root;
    var angle = (h > 1e-9 && root - tip > 1e-9)
      ? Math.atan2((root - tip) / 2, h) * 180 / Math.PI : 0;
    return { h: h, tip: tip, root: root, angle: angle, wall: (tip - dReq) / 2 };
  }

  function refreshVisibility() {
    var mode = (params.mode === 'board' || params.mode === 'cone') ? params.mode : 'box';
    $('cardHole').className = 'card' + (mode === 'cone' ? ' hide' : '');
    $('cardBoss').className = 'card' + (mode === 'board' ? '' : ' hide');
    $('cardBox').className = 'card' + (mode === 'box' ? '' : ' hide');
    $('cardCone').className = 'card' + (mode === 'cone' ? '' : ' hide');
    $('holeTitle').textContent = (mode === 'box') ? '顶面开口' : '镜头侧开口';
    $('holeHint').textContent = (mode === 'box') ? '顶板 3 mm 贯通' : '贯通板体 + 凸台';
    if (mode === 'box') {
      var blen = Number(params.boxLen) || 130;
      var bwall = Number(params.boxWall) || 6.25;
      var binner = FSG.W - 2 * bwall;
      $('boxDesc').textContent = '方桶 外 ' + FSG.fmt(FSG.W, 2) + ' 方 / 内 ' + FSG.fmt(binner, 2) +
        ' 方（壁厚 ' + FSG.fmt(bwall, 2) + '）；分段 底板 3 + 方桶 ' +
        FSG.fmt(blen - 6, 2) + ' + 顶板 3 = ' + FSG.fmt(blen, 2) + ' mm';
      $('totalH').value = FSG.fmt(blen, 1) + ' mm';
    }
    if (mode === 'cone') {
      var et = FSG.threadInfo({ threadKey: params.extThreadKey, threadD: params.extThreadD, threadP: params.extThreadP });
      var customE = params.extThreadKey === 'custom';
      $('fldExtD').className = 'fld' + (customE ? '' : ' hide');
      $('fldExtP').className = 'fld' + (customE ? '' : ' hide');
      var tip = et.D + 2 * FSG.EXT_RIM;
      var crest = et.D1 + 2 * (Number(params.gap) || 0);
      var len2 = Number(params.extLen) || 0;
      var depth2 = Number(params.extDepth) || 0;
      var root2 = Number(params.extOuterD) || FSG.EXT_ROOT_D;
      var H2 = 3 + len2;
      var zT2 = 3 + len2 - depth2;
      var innerBase = FSG.extInnerBase(root2, tip, len2, zT2, crest);
      var wall = FSG.extWall(root2, tip, len2, zT2, crest, 3);
      $('extDesc').textContent = '外锥 ⌀' + FSG.fmt(root2, 2) + ' → ⌀' + FSG.fmt(tip, 2) +
        '；内锥 ⌀' + FSG.fmt(innerBase, 2) + ' → 牙顶 ⌀' + FSG.fmt(crest, 2) +
        '（等壁厚 ' + FSG.fmt(wall, 2) + '）；总高 ' + FSG.fmt(H2, 2) + ' mm';
      $('totalH').value = FSG.fmt(H2, 1) + ' mm';
      return;
    }
    var thread = params.holeMode === 'thread';
    $('fldHoleD').className = 'fld' + (thread ? ' hide' : '');
    $('fldThread').className = 'fld' + (thread ? '' : ' hide');
    $('fldGap').className = 'fld' + (thread ? '' : ' hide');
    var custom = thread && params.threadKey === 'custom';
    $('fldThreadD').className = 'fld' + (custom ? '' : ' hide');
    $('fldThreadP').className = 'fld' + (custom ? '' : ' hide');

    var b = localBoss();
    $('bossVal').textContent = FSG.fmt(b.h, 1) + ' mm';
    $('bossTip').textContent = b.h > 1e-9 ? ('尖端 ⌀' + FSG.fmt(b.tip, 2)) : '无凸台（平底）';
    $('bossAngle').value = b.h > 1e-9 ? (FSG.fmt(b.angle, 1) + '°') : '—';
    $('bossDesc').textContent = b.h > 1e-9
      ? ('根部 ⌀' + FSG.fmt(b.root, 2) + ' → 尖端 ⌀' + FSG.fmt(b.tip, 2) +
         '（壁厚 ' + FSG.fmt(b.wall, 2) + '）；总高 = 3 + ' + FSG.fmt(b.h, 1) + ' = ' + FSG.fmt(3 + b.h, 1) + ' mm')
      : '无凸台：相机侧为 78 方面；总高 3 mm';
    $('totalH').value = FSG.fmt(3 + b.h, 1) + ' mm';
    var pct = Math.max(0, Math.min(100, b.h / FSG.BOSS_MAX * 100));
    $('bossH').style.setProperty('--p', pct + '%');
  }

  /* ---------- 重建 ---------- */
  function setStatus(ok, text, stats) {
    var dot = $('dot');
    dot.className = 'dot' + (ok ? ' ok' : (text && text.length ? ' err' : ''));
    $('stText').textContent = text;
    $('stStats').textContent = stats || '';
    document.documentElement.setAttribute('data-ready', ok ? '1' : '0');
    ['btnSTL', 'btn3MF', 'btnJSON', 'btnTXT', 'btnShot'].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !ok;
    });
  }

  function renderMessages(d) {
    var ul = $('msgs');
    ul.innerHTML = '';
    (d.errors || []).forEach(function (m) {
      var li = document.createElement('li');
      li.className = 'err';
      li.textContent = m;
      ul.appendChild(li);
    });
    (d.warnings || []).forEach(function (m) {
      var li = document.createElement('li');
      li.className = 'warn';
      li.textContent = m;
      ul.appendChild(li);
    });
  }

  function updateReadouts(d, res) {
    $('roSize').textContent = FSG.fmt(d.W, 2) + ' × ' + FSG.fmt(d.W, 2) + ' × ' + FSG.fmt(d.H, 2) + ' mm';
    if (d.mode === 'cone') {
      var et = d.extThread;
      $('roOpen').textContent = (d.params.extThreadKey === 'custom' ? 'M' + FSG.fmt(et.D, 1) : et.key.replace('x', '×')) +
        '（⌀' + FSG.fmt(et.D, 2) + ' × ' + FSG.fmt(et.P, 2) + '，深 ' + FSG.fmt(d.extDepth, 2) + '）';
      $('roTurns').textContent = FSG.fmt(d.extDepth, 2) + ' mm / ' + FSG.fmt(d.extTurns, 2) + ' 圈';
    } else if (d.holeMode === 'thread') {
      $('roOpen').textContent = (d.params.threadKey === 'custom' ? 'M' + FSG.fmt(d.thread.D, 1) : d.thread.key.replace('x', '×')) +
        '（⌀' + FSG.fmt(d.thread.D, 2) + ' × ' + FSG.fmt(d.thread.P, 2) + '）';
      $('roTurns').textContent = FSG.fmt(d.threadLen, 2) + ' mm / ' + FSG.fmt(d.turns, 2) + ' 圈';
    } else {
      $('roOpen').textContent = '圆孔 ⌀' + FSG.fmt(d.holeD, 2);
      $('roTurns').textContent = '–';
    }
    if (d.hasBoss) {
      $('bossTip').textContent = '尖端 ⌀' + FSG.fmt(d.bossTipD, 2);
      $('bossAngle').value = FSG.fmt(d.bossAngle, 1) + '°';
    }
    if (res && res.audit) {
      $('roVol').textContent = FSG.fmt(res.audit.volume, 1) + ' mm³';
      $('roMass').textContent = FSG.fmt(res.audit.volume / 1000 * 1.24, 1) + ' g';
    } else {
      $('roVol').textContent = '–';
      $('roMass').textContent = '–';
    }
    $('totalH').value = FSG.fmt(d.H, 2) + ' mm';
  }

  function rebuild(silent) {
    readForm();
    var d = FSG.derive(params);
    derived = d;
    renderMessages(d);
    refreshVisibility();
    if (!d.ok) {
      result = null;
      updateReadouts(d, null);
      setStatus(false, '参数有误：' + d.errors[0], '');
      if (onResult) onResult(null);
      syncHash();
      return false;
    }
    var res = FSG.Geometry.build(params);
    if (!res.ok) {
      result = null;
      updateReadouts(res.derived, null);
      setStatus(false, '几何生成失败：' + res.error, '');
      if (onResult) onResult(null);
      syncHash();
      return false;
    }
    result = res;
    derived = res.derived;
    updateReadouts(derived, res);
    setStatus(true, '已生成', res.audit.triangles + ' 面 / ' + FSG.fmt(res.audit.volume / 1000, 2) + ' cm³');
    document.documentElement.setAttribute('data-tris', String(res.audit.triangles));
    if (onResult) onResult(res);
    syncHash();
    return true;
  }

  function schedule() {
    refreshVisibility();
    clearTimeout(timer);
    timer = setTimeout(function () { rebuild(); }, 50);
  }

  function setParams(patch) {
    var cur = FSG.clone(params);
    Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
    params = cur;
    syncForm();
    return rebuild();
  }

  function syncHash() {
    try {
      history.replaceState(null, '', FSG.hashFromParams(params, state));
    } catch (e) { /* ignore */ }
  }

  /* ---------- 导出 ---------- */
  function download(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 400);
  }

  function exportBytes(kind) {
    if (!result) return null;
    if (kind === 'stl') return FSG.Export.writeSTL(result);
    if (kind === '3mf') return FSG.Export.write3MF(result, { name: FSG.Export.baseName(result.derived) });
    if (kind === 'json') {
      return new TextEncoder().encode(FSG.Export.writeParamsJSON(result,
        ['生成器：' + FSG.TITLE + ' v' + FSG.VERSION]));
    }
    if (kind === 'txt') return new TextEncoder().encode(FSG.Export.writeParamsTXT(result));
    return null;
  }

  function exportSTL() {
    var b = exportBytes('stl');
    if (!b) return;
    download(b, FSG.Export.baseName(derived) + '.stl', 'model/stl');
    toast('已导出 STL：' + FSG.Export.baseName(derived) + '.stl');
  }
  function export3MF() {
    var b = exportBytes('3mf');
    if (!b) return;
    download(b, FSG.Export.baseName(derived) + '.3mf', 'model/3mf');
    toast('已导出 3MF');
  }
  function exportJSON() {
    var b = exportBytes('json');
    if (!b) return;
    download(b, FSG.Export.baseName(derived) + '.json', 'application/json');
    toast('已导出参数 JSON');
  }
  function exportTXT() {
    var b = exportBytes('txt');
    if (!b) return;
    download(b, FSG.Export.baseName(derived) + '.参数.txt', 'text/plain');
    toast('已导出参数 TXT');
  }
  function shot() {
    var url = sceneApi.screenshot();
    var a = document.createElement('a');
    a.href = url;
    a.download = FSG.Export.baseName(derived) + '.png';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 400);
    toast('已保存截图');
  }

  /* ---------- 交互 ---------- */
  function bind() {
    var segs = [
      ['boardSeg', 'data-board', 'board'],
      ['holeSeg', 'data-hole', 'holeMode'],
      ['modeSeg', 'data-mode', 'mode']
    ];
    segs.forEach(function (spec) {
      var segId = spec[0], attr = spec[1], key = spec[2];
      document.querySelectorAll('#' + segId + ' button').forEach(function (b) {
        b.addEventListener('click', function () {
          params[key] = b.getAttribute(attr);
          if (key === 'board') $('boardDesc').textContent = FSG.BOARD_INFO[params.board].desc;
          syncForm();
          rebuild();
        });
      });
    });

    ['holeD', 'threadD', 'threadP', 'gap', 'frontChamfer',
      'extLen', 'extDepth', 'extOuterD', 'extThreadD', 'extThreadP', 'boxLen', 'boxWall'].forEach(function (id) {
      $(id).addEventListener('input', schedule);
      $(id).addEventListener('change', schedule);
    });

    /* 凸台高度：滑杆与数字输入双向联动（不回写正在输入的那个框） */
    function onBossH(e) {
      var el = (e && e.target) ? e.target : $('bossHNum');
      var v = Number(el.value);
      if (!isFinite(v)) v = 0;
      var clamped = Math.max(0, Math.min(FSG.BOSS_MAX, Math.round(v * 100) / 100));
      params.bossH = clamped;
      if (el.id === 'bossHNum') {
        $('bossH').value = clamped;
      } else {
        $('bossHNum').value = clamped;
      }
      refreshVisibility();
      schedule();
    }
    $('bossH').addEventListener('input', onBossH);
    $('bossHNum').addEventListener('input', onBossH);
    $('bossHNum').addEventListener('change', onBossH);
    ['threadKey', 'extThreadKey', 'meshN'].forEach(function (id) {
      $(id).addEventListener('change', function () { refreshVisibility(); rebuild(); });
    });

    $('btnSTL').addEventListener('click', exportSTL);
    $('btn3MF').addEventListener('click', export3MF);
    $('btnJSON').addEventListener('click', exportJSON);
    $('btnTXT').addEventListener('click', exportTXT);
    $('btnShot').addEventListener('click', shot);

    document.querySelectorAll('#viewGroup button').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });
    [['tglSection', 'section'], ['tglDims', 'dims'], ['tglWire', 'wire'], ['tglAuto', 'auto']]
      .forEach(function (pair) {
        $(pair[0]).addEventListener('click', function () { toggle(pair[1]); });
      });

    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var k = String(e.key).toLowerCase();
      var views = { '1': 'iso', '2': 'front', '3': 'side', '4': 'top', '5': 'bottom' };
      if (views[k]) { setView(views[k]); e.preventDefault(); return; }
      if (k === 's') { toggle('section'); e.preventDefault(); return; }
      if (k === 'd') { toggle('dims'); e.preventDefault(); return; }
      if (k === 'w') { toggle('wire'); e.preventDefault(); return; }
      if (k === 'a') { toggle('auto'); e.preventDefault(); return; }
      if (k === 'r') { sceneApi.frameNow(); e.preventDefault(); return; }
    });
  }

  function setView(v) {
    state.view = v;
    sceneApi.setView(v);
    document.querySelectorAll('#viewGroup button').forEach(function (b) {
      b.className = b.getAttribute('data-view') === v ? 'on' : '';
    });
    syncHash();
  }

  function toggle(key) {
    state[key] = state[key] ? 0 : 1;
    $({ section: 'tglSection', dims: 'tglDims', wire: 'tglWire', auto: 'tglAuto' }[key])
      .className = state[key] ? 'on' : '';
    sceneApi.setState({ section: state.section, dims: state.dims, wire: state.wire, auto: state.auto });
    if (key === 'section' && state.section) sceneApi.setView('section');
    syncHash();
  }

  function applySceneState() {
    sceneApi.setState({ section: state.section, dims: state.dims, wire: state.wire, auto: state.auto });
    document.querySelectorAll('#viewGroup button').forEach(function (b) {
      b.className = b.getAttribute('data-view') === state.view ? 'on' : '';
    });
    $('tglSection').className = state.section ? 'on' : '';
    $('tglDims').className = state.dims ? 'on' : '';
    $('tglWire').className = state.wire ? 'on' : '';
    $('tglAuto').className = state.auto ? 'on' : '';
  }

  function init(opts) {
    params = opts.params;
    state = opts.state;
    sceneApi = opts.sceneApi;
    onResult = opts.onResult;
    fillSelects();
    bind();
    syncForm();
    var v = $('ver');
    if (v) v.textContent = 'v' + FSG.VERSION;
    document.title = FSG.TITLE;
  }

  return {
    init: init,
    rebuild: rebuild,
    setParams: setParams,
    getParams: function () { return FSG.clone(params); },
    getState: function () { return Object.assign({}, state); },
    getResult: function () { return result; },
    getDerived: function () { return derived; },
    setView: setView,
    toggle: toggle,
    applySceneState: applySceneState,
    exportSTL: exportSTL,
    export3MF: export3MF,
    exportJSON: exportJSON,
    exportTXT: exportTXT,
    exportBytes: exportBytes,
    screenshot: shot,
    toast: toast,
    refreshVisibility: refreshVisibility,
    syncForm: syncForm
  };
})();
