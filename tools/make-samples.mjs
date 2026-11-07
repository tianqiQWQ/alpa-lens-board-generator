#!/usr/bin/env node
/* tools/make-samples.mjs — 按预设生成 samples/（STL / 3MF / 参数 TXT）
 *
 *   node tools/make-samples.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'samples');
mkdirSync(OUT, { recursive: true });

for (const f of ['src/app/00-core.js', 'src/app/10-geometry.js', 'src/app/20-export.js']) {
  vm.runInThisContext(readFileSync(join(ROOT, f), 'utf8'), { filename: f });
}
const FSG = globalThis.FSG;
const G = FSG.Geometry;
const E = FSG.Export;

const lines = [];
for (const preset of FSG.PRESETS) {
  const params = Object.assign(FSG.defaults(), preset.params);
  const r = G.build(params);
  if (!r.ok) { console.error('FAILED ' + preset.key + ': ' + r.error); process.exitCode = 1; continue; }
  const name = E.baseName(r.derived);
  writeFileSync(join(OUT, name + '.stl'), E.writeSTL(r));
  writeFileSync(join(OUT, name + '.3mf'), E.write3MF(r, { name: name }));
  writeFileSync(join(OUT, name + '.参数.txt'), E.writeParamsTXT(r, [
    '预设        : ' + preset.label + '（' + preset.key + '）',
    '生成器      : ' + FSG.TITLE + ' v' + FSG.VERSION
  ]));
  console.log('  ' + preset.key.padEnd(11) + name.padEnd(34) +
    String(r.audit.triangles).padStart(7) + ' tris  ' +
    (r.audit.volume / 1000).toFixed(2).padStart(7) + ' cm³  ' +
    (r.audit.watertight ? 'watertight' : 'NOT WATERTIGHT'));
  lines.push({
    preset: preset.key, label: preset.label, file: name,
    params: r.derived.params, volume: r.audit.volume,
    triangles: r.audit.triangles, watertight: r.audit.watertight,
    bboxMax: r.audit.bboxMax
  });
}
writeFileSync(join(OUT, 'samples.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  generator: FSG.TITLE + ' v' + FSG.VERSION,
  samples: lines
}, null, 2) + '\n');
console.log('\nSAMPLES OK: ' + lines.length + ' 组 → ' + OUT);
