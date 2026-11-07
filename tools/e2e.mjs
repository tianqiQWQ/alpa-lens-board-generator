#!/usr/bin/env node
/* tools/e2e.mjs — headless Chrome 端到端验收（CDP，无第三方依赖）
 *
 *   node tools/e2e.mjs
 *
 * 覆盖：启动 / 方箱延长几何 / 导出 STL+3MF / 真实下载 / 改总长与壁厚 / 非法参数拦截 /
 *       单板（凸台、自适应尖端、滑杆+数字联动）/ 锥形延长 / 剖视 / 视图 / 快捷键 /
 *       预设 / 移动端 / 截图
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

let pass = 0, fail = 0;
const failures = [];
const results = [];
function ok(name, cond, info) {
  results.push({ name, ok: !!cond, info: info === undefined ? null : String(info) });
  if (cond) { pass++; console.log('  OK  ' + name + (info !== undefined ? '  [' + info + ']' : '')); return true; }
  fail++; failures.push(name);
  console.log('  FAIL ' + name + (info !== undefined ? '  [' + info + ']' : ''));
  return false;
}
function near(a, b, tol, name) { return ok(name, Math.abs(a - b) <= tol, a + ' vs ' + b + ' ±' + tol); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs() {
  const o = { html: join(ROOT, 'ALPA镜头板生成器.html'), out: join(ROOT, 'tools', 'out'), port: 9437, headless: true };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--html') o.html = resolve(a[++i]);
    else if (a[i] === '--out') o.out = resolve(a[++i]);
    else if (a[i] === '--port') o.port = Number(a[++i]);
    else if (a[i] === '--headed') o.headless = false;
  }
  return o;
}

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('Chrome/Edge not found');
}

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

async function main() {
  const o = parseArgs();
  if (!existsSync(o.html)) throw new Error('HTML not found: ' + o.html);
  mkdirSync(o.out, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'alpa-e2e-'));
  const downloads = mkdtempSync(join(tmpdir(), 'alpa-dl-'));
  const chrome = findChrome();
  const pageUrl = pathToFileURL(o.html).href + '#freeze=1';
  const args = [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter',
    '--disable-breakpad', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--metrics-recording-only', '--mute-audio', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1440,900', '--user-data-dir=' + profile,
    '--remote-debugging-port=' + o.port,
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    pageUrl
  ];
  console.log('chrome:', chrome);
  console.log('page  :', pageUrl);
  const proc = spawn(chrome, args, { stdio: 'ignore', windowsHide: true });
  let ws = null;
  try {
    let version = null;
    for (let i = 0; i < 80; i++) {
      try {
        version = await getJson('http://127.0.0.1:' + o.port + '/json/version');
        if (version) break;
      } catch (e) { /* retry */ }
      await sleep(250);
    }
    ok('Chrome 调试端口可用', !!version, version && version.Browser);
    if (!version) throw new Error('no devtools endpoint');

    let target = null;
    for (let i = 0; i < 80; i++) {
      const list = await getJson('http://127.0.0.1:' + o.port + '/json/list');
      target = list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
      if (target) break;
      await sleep(250);
    }
    ok('页面目标已创建', !!target, target && basename(decodeURIComponent(target.url.split('#')[0])));
    if (!target) throw new Error('no page target');

    ws = await connect(target.webSocketDebuggerUrl);
    ok('CDP WebSocket 已连接', true);

    let id = 0;
    const pending = new Map();
    const consoleErrors = [];
    const exceptions = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        exceptions.push(msg.params.exceptionDetails.text + ' ' + ((msg.params.exceptionDetails.exception || {}).description || ''));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '));
      }
    };
    function send(method, params) {
      const mid = ++id;
      return new Promise((res, rej) => {
        pending.set(mid, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      });
    }
    async function ev(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error('eval threw: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
      return r.result.value;
    }
    async function shot(name) {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const p = join(o.out, name);
      writeFileSync(p, Buffer.from(r.data, 'base64'));
      return p;
    }
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Log.enable').catch(() => { });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }).catch(() => { });

    let booted = false;
    for (let i = 0; i < 80; i++) {
      try {
        booted = await ev("document.documentElement.getAttribute('data-ready') === '1'");
        if (booted) break;
      } catch (e) { /* retry */ }
      await sleep(250);
    }
    ok('应用启动 data-ready=1', booted);
    ok('WebGL 标记 ok', (await ev("document.documentElement.getAttribute('data-webgl')")) === 'ok');
    const appVer = await ev('window.__ALPA__ && window.__ALPA__.version');
    ok('对外 API 存在', !!appVer, appVer);

    /* ---------- 默认几何：方箱延长 130 mm ---------- */
    const d0 = await ev(`(()=>{const d=__ALPA__.getDerived();return {
      mode:d.mode, board:d.board, boardT:d.boardT, H:d.H,
      boxLen:d.boxLen, tube:d.boxTubeLen, inner:d.boxInner, wall:d.boxWall, top:d.topT,
      hm:d.holeMode, th:d.thread&&d.thread.key, D:d.thread&&d.thread.D, turns:d.turns};})()`);
    ok('默认是方箱形态', d0.mode === 'box', d0.mode);
    near(d0.H, 20, 1e-9, '默认总长 20');
    near(d0.tube, 14, 1e-9, '默认方桶 14 = 20 − 3 − 3');
    near(d0.inner, 76, 1e-9, '内腔 76 方');
    near(d0.wall, 6.25, 1e-9, '壁厚 6.25');
    near(d0.top, 3, 1e-9, '顶板 3');
    near(d0.D, 65, 1e-9, '顶面 M65');
    near(d0.turns, 3, 1e-9, '顶面螺纹 3 圈');

    const a0 = await ev('(()=>{const a=__ALPA__.getAudit();return {tris:a.triangles,verts:a.vertices,volume:a.volume,watertight:a.watertight,boundary:a.boundaryEdges,bboxMin:a.bboxMin,bboxMax:a.bboxMax};})()');
    ok('网格水密', a0.watertight === true && a0.boundary === 0, 'boundary=' + a0.boundary);
    ok('三角面数量合理', a0.tris > 5000 && a0.tris < 300000, a0.tris);
    near(a0.bboxMax[0] - a0.bboxMin[0], 88.5, 0.01, 'X 外形 88.5');
    near(a0.bboxMax[2] - a0.bboxMin[2], 20, 0.01, 'Z 总高 20');
    near(a0.volume, 36937, 1500, '默认体积 ≈ 36937（方箱 20）');

    /* ---------- 三种形态的全景 / 截面示例图 ---------- */
    await ev("__ALPA__.setView('iso')");
    await sleep(700);
    await shot('e2e-box-iso.png');
    await ev("document.getElementById('tglSection').click()");
    await sleep(800);
    await shot('e2e-box-section.png');
    await ev("document.getElementById('tglSection').click()");
    await sleep(300);

    /* ---------- 导出 ---------- */
    const stl = await ev(`(()=>{
      const b=__ALPA__.exportBytes('stl');
      const head=String.fromCharCode.apply(null,b.slice(0,32));
      return {bytes:b.length, head, expected: 84 + 50*__ALPA__.getAudit().triangles};
    })()`);
    ok('STL 字节数 = 84 + 50×三角数', stl.bytes === stl.expected, stl.bytes + '/' + stl.expected);
    ok('STL 头包含生成器标识', /ALPA lens board/.test(stl.head), stl.head);

    const mf3 = await ev(`(()=>{
      const b=__ALPA__.exportBytes('3mf');
      const files=FSG.Export.unzipStore(b);
      const model=new TextDecoder().decode(files['3D/3dmodel.model']);
      const a=__ALPA__.getAudit();
      return {bytes:b.length, hasModel:!!files['3D/3dmodel.model'], hasCT:!!files['[Content_Types].xml'],
        verts:(model.match(/<vertex /g)||[]).length, tris:(model.match(/<triangle /g)||[]).length,
        auditV:a.vertices, auditT:a.triangles,
        unit:/unit="millimeter"/.test(model), bed:/transform="1 0 0 0 1 0 0 0 1 128 128 0"/.test(model)};
    })()`);
    ok('3MF 包含 model + Content_Types', mf3.hasModel && mf3.hasCT);
    ok('3MF 顶点数一致', mf3.verts === mf3.auditV, mf3.verts + '/' + mf3.auditV);
    ok('3MF 三角数一致', mf3.tris === mf3.auditT, mf3.tris + '/' + mf3.auditT);
    ok('3MF 单位 mm + 热床居中', mf3.unit && mf3.bed);

    await ev("document.getElementById('btn3MF').click()");
    await sleep(1500);
    let dl = [];
    try { dl = readdirSync(downloads); } catch (e) { dl = []; }
    ok('点击「导出 3MF」触发真实下载', dl.some((f) => f.endsWith('.3mf')), dl.join(', '));

    /* ---------- 改总长 / 壁厚 ---------- */
    const okShort = await ev("__ALPA__.setParams({boxLen:80})");
    ok('总长改 80 重建成功', okShort === true);
    const dShort = await ev('(()=>{const d=__ALPA__.getDerived();return {H:d.H,tube:d.boxTubeLen};})()');
    near(dShort.H, 80, 1e-9, '总长 80');
    near(dShort.tube, 74, 1e-9, '方桶 74');
    await ev("__ALPA__.setView('iso')");
    await sleep(700);
    await shot('e2e-box80.png');

    const okWall = await ev("__ALPA__.setParams({boxWall:3})");
    ok('壁厚改 3 重建成功', okWall === true);
    const dWall = await ev('(()=>{const d=__ALPA__.getDerived();return {inner:d.boxInner,wall:d.boxWall};})()');
    near(dWall.inner, 82.5, 1e-9, '壁厚 3 → 内腔 82.5');
    await ev("__ALPA__.setParams({boxLen:130,boxWall:6.25})");
    await sleep(300);

    /* ---------- 非法参数 ---------- */
    const bad = await ev("__ALPA__.setParams({boxLen:5})");
    ok('总长 5 被拦截', bad === false);
    ok('data-ready=0', (await ev("document.documentElement.getAttribute('data-ready')")) === '0');
    const msg = await ev("document.querySelector('#msgs li.err') && document.querySelector('#msgs li.err').textContent");
    ok('错误信息已显示', !!msg && msg.length > 4, msg);
    ok('导出按钮已禁用', (await ev("document.getElementById('btnSTL').disabled")) === true);
    await shot('e2e-error.png');
    await ev("__ALPA__.setParams({boxLen:130})");
    await sleep(400);

    /* ---------- 单板：⌀35 平底 ---------- */
    const b1 = await ev("__ALPA__.setParams({mode:'board',board:'A',bossH:0,holeMode:'plain',holeD:35,frontChamfer:0})");
    ok('切到单板 ⌀35 成功', b1 === true);
    const a1 = await ev('(()=>{const a=__ALPA__.getAudit();return {volume:a.volume,watertight:a.watertight,bboxMax:a.bboxMax};})()');
    ok('⌀35 板水密', a1.watertight === true);
    near(a1.volume, 18143.04, 90, '⌀35 板体积 ≈ 18143.0 mm³');
    near(a1.bboxMax[2], 3, 0.01, '总高 3 mm');
    await ev("__ALPA__.setView('iso')");
    await sleep(700);
    await shot('e2e-board-iso.png');
    await ev("document.getElementById('tglSection').click()");
    await sleep(800);
    await shot('e2e-board-section.png');
    await ev("document.getElementById('tglSection').click()");
    await sleep(300);

    /* ---------- 单板：自适应凸台 ⌀35 + 3 mm ---------- */
    const okAdapt = await ev("__ALPA__.setParams({mode:'board',board:'A',bossH:3,holeMode:'plain',holeD:35,frontChamfer:0})");
    ok('⌀35 + 3 mm 凸台重建成功', okAdapt === true);
    const dAdapt = await ev('(()=>{const d=__ALPA__.getDerived();return {tip:d.bossTipD,angle:d.bossAngle,H:d.H,wall:d.bossWall};})()');
    near(dAdapt.tip, 41, 1e-6, '尖端 = 35 + 6 = ⌀41');
    near(dAdapt.H, 6, 1e-9, '总高 6 = 3 + 3');
    near(dAdapt.wall, 3, 1e-6, '凸台壁厚 3 mm');
    const angShow = await ev("document.getElementById('bossAngle').value");
    ok('锥角自动显示', /\d/.test(angShow), angShow);
    await ev("__ALPA__.setView('bottom')");
    await sleep(700);
    await shot('e2e-boss-cone35.png');

    /* ---------- 数字输入凸台高度（与滑杆联动） ---------- */
    await ev("(()=>{const el=document.getElementById('bossHNum'); el.value='4.2'; el.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await sleep(500);
    near(await ev('__ALPA__.getDerived().bossH'), 4.2, 1e-9, '数字输入凸台 4.2 生效');
    near(await ev("Number(document.getElementById('bossH').value)"), 4.2, 1e-9, '滑杆跟随数字输入');
    await ev("(()=>{const el=document.getElementById('bossH'); el.value='1'; el.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await sleep(500);
    near(await ev('__ALPA__.getDerived().bossH'), 1, 1e-9, '滑杆改 1 生效');
    near(await ev("Number(document.getElementById('bossHNum').value)"), 1, 1e-9, '数字框跟随滑杆');

    /* ---------- 单板：锥面板 M65 凸台 2 ---------- */
    const b2 = await ev("__ALPA__.setParams({mode:'board',board:'B',bossH:2,holeMode:'thread',threadKey:'M65x1',frontChamfer:0,gap:0.15})");
    ok('锥面板 M65 重建成功', b2 === true);
    const a2 = await ev('(()=>{const a=__ALPA__.getAudit();return {volume:a.volume,watertight:a.watertight,bboxMax:a.bboxMax};})()');
    near(a2.volume, 13195.75, 264, '锥面板体积 ≈ 13195.8 mm³（参考 3MF）');
    near(a2.bboxMax[2], 5, 0.01, '锥面板总高 5 mm');
    await ev("__ALPA__.setView('iso')");
    await sleep(700);
    await shot('e2e-board-B.png');

    /* ---------- 锥形延长 ---------- */
    const okCone = await ev("__ALPA__.setParams({mode:'cone',board:'A',extLen:20,extOuterD:80,extThreadKey:'M42x1',extDepth:5,frontChamfer:0.6})");
    ok('切到锥形延长成功', okCone === true);
    const dCone = await ev('(()=>{const d=__ALPA__.getDerived();return {H:d.H,tip:d.extTipD,inner:d.extInnerRootD,wall:d.extWall,turns:d.extTurns};})()');
    near(dCone.H, 23, 1e-9, '锥形总高 23（延长 20）');
    near(dCone.tip, 52, 1e-9, '外锥尖端 ⌀52');
    near(dCone.wall, 8.89, 0.03, '等壁厚 8.89');
    await ev("__ALPA__.setView('iso')");
    await sleep(700);
    await shot('e2e-cone-iso.png');
    await ev("document.getElementById('tglSection').click()");
    await sleep(800);
    await shot('e2e-cone-section.png');
    await ev("document.getElementById('tglSection').click()");
    await sleep(300);

    /* ---------- 回到方箱：剖视 / 视图 ---------- */
    await ev("__ALPA__.setParams({mode:'box',boxLen:130,boxWall:6.25})");
    await sleep(500);
    await ev("__ALPA__.setView('iso')");
    await sleep(600);
    await ev("document.getElementById('tglSection').click()");
    await sleep(700);
    ok('剖视已开启', (await ev('__ALPA__.getState().section')) === 1);
    await shot('e2e-section.png');
    await ev("document.getElementById('tglSection').click()");
    await sleep(200);
    ok('剖视已关闭', (await ev('__ALPA__.getState().section')) === 0);

    await ev("document.querySelectorAll('#viewGroup button')[3].click()");
    await sleep(700);
    ok('切到俯视', (await ev('__ALPA__.getState().view')) === 'top');
    await shot('e2e-top.png');
    await ev("document.querySelectorAll('#viewGroup button')[4].click()");
    await sleep(700);
    ok('切到仰视', (await ev('__ALPA__.getState().view')) === 'bottom');
    await shot('e2e-bottom.png');
    await ev("document.querySelectorAll('#viewGroup button')[1].click()");
    await sleep(700);
    ok('切到正视', (await ev('__ALPA__.getState().view')) === 'front');
    await shot('e2e-front.png');
    await ev("document.querySelectorAll('#viewGroup button')[0].click()");
    await sleep(700);

    /* ---------- 键盘快捷键 ---------- */
    await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'2',bubbles:true}))");
    await sleep(600);
    ok('快捷键 2 → 正视', (await ev('__ALPA__.getState().view')) === 'front');
    await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',bubbles:true}))");
    await sleep(500);
    ok('快捷键 S → 剖视开', (await ev('__ALPA__.getState().section')) === 1);
    await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',bubbles:true}))");
    await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true}))");
    await sleep(700);
    ok('快捷键 1 → 等轴 + 剖视关',
      (await ev('__ALPA__.getState().view')) === 'iso' && (await ev('__ALPA__.getState().section')) === 0);

    /* ---------- DOM / 文案 ---------- */
    const dom = await ev(`(()=>({
      title: document.title,
      panelW: document.getElementById('panel').getBoundingClientRect().width,
      stageH: document.getElementById('stage').getBoundingClientRect().height,
      status: document.getElementById('stText').textContent,
      sizeText: document.getElementById('roSize').textContent,
      openText: document.getElementById('roOpen').textContent,
      turnsText: document.getElementById('roTurns').textContent,
      volText: document.getElementById('roVol').textContent,
      presets: document.querySelectorAll('#presets button').length,
      threads: document.querySelectorAll('#threadKey option').length,
      modeOn: document.querySelector('#modeSeg button.on').getAttribute('data-mode'),
      boxVisible: !document.getElementById('cardBox').className.includes('hide'),
      holeTitle: document.getElementById('holeTitle').textContent,
      bossHidden: document.getElementById('cardBoss').className.includes('hide'),
      coneHidden: document.getElementById('cardCone').className.includes('hide')
    }))()`);
    ok('标题正确', dom.title.includes('ALPA'), dom.title);
    ok('面板宽度 386', Math.abs(dom.panelW - 386) < 2, dom.panelW);
    ok('画布高度 ≥ 400', dom.stageH >= 400, dom.stageH);
    ok('状态显示已生成', dom.status.includes('已生成'), dom.status);
    ok('外形读数含 130', dom.sizeText.includes('130'), dom.sizeText);
    ok('开口读数含 M65', dom.openText.includes('65'), dom.openText);
    ok('圈数读数含 3', /3/.test(dom.turnsText), dom.turnsText);
    ok('体积读数已显示', /mm³/.test(dom.volText), dom.volText);
    ok('7 个预设', dom.presets === 7, dom.presets);
    ok('螺纹规格 ≥ 12 种', dom.threads >= 12, dom.threads);
    ok('方箱形态选中 + 方箱卡片可见', dom.modeOn === 'box' && dom.boxVisible === true);
    ok('开口卡片改名为「顶面开口」', dom.holeTitle.includes('顶面'), dom.holeTitle);
    ok('方箱下隐藏凸台与锥形卡片', dom.bossHidden === true && dom.coneHidden === true);

    /* 预设按钮 */
    await ev("document.querySelector('[data-preset=\"box20\"]').click()");
    await sleep(600);
    const dp = await ev('(()=>{const d=__ALPA__.getDerived();return {mode:d.mode,H:d.H};})()');
    ok('预设「方箱延长 20」生效', dp.mode === 'box' && Math.abs(dp.H - 20) < 1e-9, JSON.stringify(dp));
    await ev("document.querySelector('[data-preset=\"box130\"]').click()");
    await sleep(700);
    const dp2 = await ev('(()=>{const d=__ALPA__.getDerived();return {mode:d.mode,H:d.H};})()');
    ok('预设「方箱延长 130」生效', dp2.mode === 'box' && Math.abs(dp2.H - 130) < 1e-9, JSON.stringify(dp2));
    await ev("document.querySelector('[data-preset=\"board35\"]').click()");
    await sleep(600);
    const dp3 = await ev('(()=>{const d=__ALPA__.getDerived();return {mode:d.mode,H:d.H};})()');
    ok('预设「⌀35 平底板」生效', dp3.mode === 'board' && Math.abs(dp3.H - 3) < 1e-9, JSON.stringify(dp3));
    await ev("document.querySelector('[data-preset=\"box130\"]').click()");
    await sleep(900);
    await shot('e2e-desktop.png');

    /* ---------- 移动端 ---------- */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(900);
    const mob = await ev(`(()=>{
      const p=document.getElementById('panel').getBoundingClientRect();
      const s=document.getElementById('stage').getBoundingClientRect();
      return {w:innerWidth, panelW:Math.round(p.width), stageH:Math.round(s.height), scrollX:document.documentElement.scrollWidth};
    })()`);
    ok('移动端视口 390', mob.w === 390, mob.w);
    ok('移动端面板全宽', Math.abs(mob.panelW - 390) < 2, mob.panelW);
    ok('移动端画布高度 ≥ 260', mob.stageH >= 260, mob.stageH);
    ok('移动端无横向溢出', mob.scrollX <= 391, mob.scrollX);
    await shot('e2e-mobile.png');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(500);

    ok('无页面异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));
    ok('无 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

    const report = {
      generatedAt: new Date().toISOString(),
      html: o.html,
      browser: version.Browser,
      pass, fail, results,
      screenshots: readdirSync(o.out).filter((f) => f.startsWith('e2e-'))
    };
    writeFileSync(join(o.out, 'e2e-report.json'), JSON.stringify(report, null, 2));
    console.log('\n========================================');
    console.log(fail ? 'E2E FAILED: ' + fail + ' / ' + (pass + fail) : 'E2E OK: ' + pass + ' / ' + (pass + fail) + ' 全部通过');
    if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '));
    process.exitCode = fail ? 1 : 0;
  } finally {
    try { if (ws) ws.close(); } catch (e) { /* ignore */ }
    try { proc.kill(); } catch (e) { /* ignore */ }
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    try { rmSync(downloads, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => reject(new Error('ws timeout')), 15000);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('ws error')); };
  });
}

main().catch((e) => {
  console.error('\nE2E CRASHED: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
