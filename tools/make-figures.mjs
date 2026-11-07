#!/usr/bin/env node
/* tools/make-figures.mjs — 生成三种形态的「全景 + 剖面」原图（纯 3D canvas，无 UI）
 *
 *   node tools/make-figures.mjs
 *
 * 输出：tools/out/fig-<mode>-iso.png、tools/out/fig-<mode>-section.png
 * 之后由 tools/make-figures.py 合成带文字讲解的示例图。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => existsSync(p));

const OUT = join(ROOT, 'tools', 'out');
const PORT = 9457;
const W = 2100, H = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 三种形态的代表性配置 */
const MODES = [
  {
    key: 'board', title: '① 单板 · ALPA 镜头板',
    params: { mode: 'board', board: 'A', bossH: 2, holeMode: 'thread', threadKey: 'M65x1', frontChamfer: 0.6 }
  },
  {
    key: 'cone', title: '② 锥形延长 · M42',
    params: { mode: 'cone', board: 'A', extLen: 20, extOuterD: 80, extThreadKey: 'M42x1', extDepth: 5, frontChamfer: 0.6 }
  },
  {
    key: 'box', title: '③ 方箱延长 · 130 mm',
    params: { mode: 'box', board: 'A', boxLen: 130, boxWall: 6.25, holeMode: 'thread', threadKey: 'M65x1', frontChamfer: 0.6 }
  }
];

async function main() {
  if (!CHROME) throw new Error('Chrome/Edge not found');
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'alpa-fig-'));
  const url = pathToFileURL(join(ROOT, 'ALPA镜头板生成器.html')).href;
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=' + W + ',' + H, '--user-data-dir=' + profile,
    '--remote-debugging-port=' + PORT,
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    url
  ], { stdio: 'ignore', windowsHide: true });
  let ws = null;
  try {
    let target = null;
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        target = list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
        if (target) break;
      } catch (e) { /* retry */ }
      await sleep(250);
    }
    if (!target) throw new Error('no page target');
    ws = await new Promise((res, rej) => {
      const s = new WebSocket(target.webSocketDebuggerUrl);
      const t = setTimeout(() => rej(new Error('ws timeout')), 15000);
      s.onopen = () => { clearTimeout(t); res(s); };
      s.onerror = () => { clearTimeout(t); rej(new Error('ws error')); };
    });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result);
      }
    };
    const send = (method, params) => new Promise((r, j) => {
      const mid = ++id; pending.set(mid, { r, j });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception || {}).description);
      return r.result.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    for (let i = 0; i < 80; i++) {
      if (await ev("document.documentElement.getAttribute('data-ready') === '1'")) break;
      await sleep(250);
    }
    /* 只留 canvas：隐藏面板，让 3D 视图占满窗口（screenshot() 只抓 canvas，本身已无 UI） */
    await ev("document.getElementById('panel').style.display='none'; window.dispatchEvent(new Event('resize')); true");
    await sleep(800);

    for (const m of MODES) {
      const ok = await ev(`__ALPA__.setParams(${JSON.stringify(m.params)})`);
      if (!ok) throw new Error('derive failed: ' + m.key);
      await ev("__ALPA__.setView('iso')");
      await sleep(900);
      let dataUrl = await ev('__ALPA__.screenshot()');
      writeFileSync(join(OUT, `fig-${m.key}-iso.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log('  iso    ', m.key, Math.round(dataUrl.length / 1024) + ' KiB (base64)');
      await ev("document.getElementById('tglSection').click()");
      await sleep(900);
      dataUrl = await ev('__ALPA__.screenshot()');
      writeFileSync(join(OUT, `fig-${m.key}-section.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log('  section', m.key, Math.round(dataUrl.length / 1024) + ' KiB (base64)');
      await ev("document.getElementById('tglSection').click()");
      await sleep(300);
    }
    console.log('FIGURES OK: 6 张原图 → tools/out/fig-*.png');
  } finally {
    try { if (ws) ws.close(); } catch (e) { }
    try { proc.kill(); } catch (e) { }
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
  }
}

main().catch((e) => { console.error('FIGURES FAILED: ' + (e && e.stack || e)); process.exit(1); });
