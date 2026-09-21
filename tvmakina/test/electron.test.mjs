/* Testes da configuracao do Electron (electron/config.cjs) - corre SEM o Electron,
 * porque as funcoes sao puras. E isto que garante que a aplicacao para desktop
 * arranca afinada para Windows 7 / 3 GB / 2 nucleos.
 */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const cfg = require(path.join(ROOT, 'electron', 'config.cjs'));

const PC_FRACO = { ramMb: 3072, cores: 2 };
const PC_NORMAL = { ramMb: 16384, cores: 8 };

test('3 GB de RAM e 2 nucleos = maquina fraca', () => {
  assert.equal(cfg.isLowEndMachine(PC_FRACO), true);
  assert.equal(cfg.isLowEndMachine(PC_NORMAL), false);
  assert.equal(cfg.isLowEndMachine({ lowEnd: true, ramMb: 32768, cores: 16 }), true, 'override manual');
  assert.equal(cfg.isLowEndMachine({ lowEnd: false, ramMb: 512, cores: 1 }), false, 'override manual');
  assert.equal(cfg.isLowEndMachine({}), false, 'sem informacao nao se acusa a maquina');
});

test('flags do Chromium: menos memoria e menos processos no PC fraco', () => {
  const fracas = cfg.buildSwitches(PC_FRACO);
  const normais = cfg.buildSwitches(PC_NORMAL);

  assert.ok(fracas.includes('--js-flags=--max-old-space-size=256'));
  assert.ok(normais.includes('--js-flags=--max-old-space-size=512'));
  assert.ok(fracas.includes('--renderer-process-limit=2'), 'menos processos = menos RAM');
  assert.ok(fracas.includes('--disk-cache-size=52428800'));
  assert.ok(!normais.includes('--renderer-process-limit=2'));

  /* o video nunca pode ser posto em pausa por o browser estar em segundo plano */
  const ambas = fracas.concat(normais);
  assert.ok(ambas.includes('--disable-background-timer-throttling'));
  assert.ok(ambas.includes('--disable-renderer-backgrounding'));
  assert.ok(ambas.includes('--disable-backgrounding-occluded-windows'));

  /* sem duplicados: uma flag repetida faz o Chromium usar so a ultima */
  const unicas = fracas.filter((v, i) => fracas.indexOf(v) === i);
  assert.equal(unicas.length, fracas.length, 'nao ha flags duplicadas');
  const disableFeatures = fracas.filter((f) => f.indexOf('--disable-features=') === 0);
  assert.equal(disableFeatures.length, 1, 'apenas um --disable-features');
});

test('sem aceleracao por hardware (drivers antigos do Windows 7) a GPU e desligada', () => {
  const sem = cfg.buildSwitches({ ramMb: 3072, cores: 2, hwAccel: false });
  assert.ok(sem.includes('--disable-gpu'));
  assert.ok(sem.includes('--disable-gpu-compositing'));
  assert.ok(sem.includes('--in-process-gpu'));

  const com = cfg.buildSwitches({ ramMb: 16384, cores: 8, hwAccel: true });
  assert.ok(!com.includes('--disable-gpu'));
});

test('janela: opcoes seguras e sem transparencia', () => {
  const o = cfg.buildWindowOptions({ preload: '/x/preload.cjs' });
  assert.equal(o.backgroundColor, '#05070d', 'fundo escuro evita o flash branco no arranque');
  assert.equal(o.show, false, 'so aparece quando estiver pronta');
  assert.equal(o.autoHideMenuBar, true);
  assert.equal(o.webPreferences.contextIsolation, true);
  assert.equal(o.webPreferences.nodeIntegration, false);
  assert.equal(o.webPreferences.sandbox, true);
  assert.equal(o.webPreferences.backgroundThrottling, false, 'o video continua em segundo plano');
  assert.equal(o.webPreferences.preload, '/x/preload.cjs');
  assert.equal(o.transparent, undefined, 'sem transparencia: custa GPU');
  assert.equal(o.vibrancy, undefined);
});

test('memoria do processo principal tambem e limitada', () => {
  assert.deepEqual(cfg.memoryArgv(PC_FRACO), ['--max-old-space-size=128']);
  assert.deepEqual(cfg.memoryArgv(PC_NORMAL), ['--max-old-space-size=256']);
});

test('atalhos anunciados no menu batem certo com os da interface', () => {
  const teclas = cfg.shortcuts().map((s) => s.tecla);
  ['Page Down', 'Page Up', 'Espaco', 'M', 'F', 'R', 'I', '/'].forEach((t) => {
    assert.ok(teclas.includes(t), 'falta o atalho ' + t);
  });
});
