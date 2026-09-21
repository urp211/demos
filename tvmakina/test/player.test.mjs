/* Testes do motor de reproducao (configuracao HLS para PC fraco) e do armazenamento. */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TV = require(path.join(ROOT, 'app', 'core.js'));
require(path.join(ROOT, 'app', 'parser.js'));
require(path.join(ROOT, 'app', 'store.js'));
require(path.join(ROOT, 'app', 'net.js'));
require(path.join(ROOT, 'app', 'lowend.js'));
require(path.join(ROOT, 'app', 'player.js'));

/* ------------------------------------------------------------------ HLS */

test('a configuracao HLS e curta: buffers pequenos para 3 GB de RAM', () => {
  const cfg = TV.defaultHlsConfig({ maxBufferSec: 12, maxStarveSec: 4 });
  assert.equal(cfg.enableWorker, false, 'sem worker extra');
  assert.equal(cfg.maxBufferLength, 12);
  assert.equal(cfg.maxBufferSize, 2 * 1024 * 1024, '2 MB e nao os 60 MB por omissao do hls.js');
  assert.equal(cfg.backBufferLength, 10);
  assert.equal(cfg.maxStarvationDelay, 4);
  assert.equal(cfg.capLevelToPlayerSize, true);
  assert.ok(cfg.fragLoadingMaxRetry >= 1);
});

test('o buffer pedido nas definicoes e limitado a valores sensatos', () => {
  assert.equal(TV.defaultHlsConfig({ maxBufferSec: 1 }).maxBufferLength, 3, 'minimo 3 s');
  assert.equal(TV.defaultHlsConfig({ maxBufferSec: 9999 }).maxBufferLength, 120, 'maximo 120 s');
  assert.equal(TV.defaultHlsConfig({}).maxBufferLength, 12, 'por omissao 12 s');
});

test('pickMaxLevel escolhe o melhor nivel abaixo do limite', () => {
  const levels = [
    { bitrate: 400000, height: 360 },
    { bitrate: 900000, height: 576 },
    { bitrate: 1500000, height: 720 },
    { bitrate: 4000000, height: 1080 }
  ];
  assert.equal(TV.pickMaxLevel(levels, 0), -1, '0 = automatico');
  assert.equal(TV.pickMaxLevel(levels, 1500000), 2, 'ate 720p');
  assert.equal(TV.pickMaxLevel(levels, 1000000), 1, 'nao passa a 720p');
  assert.equal(TV.pickMaxLevel(levels, 99999999), 3, 'sem limite pratica');
  assert.equal(TV.pickMaxLevel([], 1500000), -1);
  assert.equal(TV.pickMaxLevel(null, 1500000), -1);
});

/* ------------------------------------------------------------------ definicoes */

test('as definicoes por omissao sao as de um PC fraco', () => {
  const d = TV.Store.defaultSettings();
  assert.equal(d.proxy, '127.0.0.1:4022');
  assert.equal(d.maxBufferSec, 12);
  assert.equal(d.autoNext, true);
  assert.equal(d.volume, 100);
  assert.equal(d.aspect, 'contain');
});

test('o modo leve corta buffer, esconde logotipos e limita a 720p', () => {
  const leve = TV.lowEndSettings(TV.Store.defaultSettings());
  assert.equal(leve.maxBufferSec, 8);
  assert.equal(leve.maxStarveSec, 3);
  assert.equal(leve.retryTimes, 1);
  assert.equal(leve.showLogos, false);
  assert.equal(leve.hwAccel, false);
  assert.equal(leve.maxBitrate, 1500000);
});

test('deteccao de maquina fraca', () => {
  const fraca = TV.detectLowEnd.call(null);
  assert.equal(typeof fraca.lowEnd, 'boolean');
  assert.ok(Array.isArray(fraca.reasons));
  assert.equal(typeof TV.describeMachine(fraca), 'string');
});

test('ajuste de modo leve liga e desliga a classe no documento', () => {
  const fakeDoc = { documentElement: { className: '' } };
  TV.applyLowEndTweaks(fakeDoc, true);
  assert.equal(fakeDoc.documentElement.className, ' modo-leve');
  TV.applyLowEndTweaks(fakeDoc, true);
  assert.equal(fakeDoc.documentElement.className, ' modo-leve', 'nao duplica');
  TV.applyLowEndTweaks(fakeDoc, false);
  assert.equal(fakeDoc.documentElement.className.trim(), '');
});

/* ------------------------------------------------------------------ store */

test('a reserva em memoria guarda e le sem localStorage', () => {
  TV.Store.clearAll();
  assert.equal(TV.Store.backend(), 'memoria', 'em Node nao ha localStorage');
  assert.equal(TV.Store.get('nada', 42), 42);

  TV.Store.set('teste', { a: 1 });
  assert.deepEqual(TV.Store.get('teste', null), { a: 1 });

  TV.Store.setRaw('bruto', 'abc');
  assert.equal(TV.Store.getRaw('bruto'), 'abc');
  assert.ok(TV.Store.usageBytes() > 0);

  TV.Store.remove('bruto');
  assert.equal(TV.Store.getRaw('bruto'), undefined);
});

test('favoritos: ligar, desligar e contar', () => {
  TV.Store.clearAll();
  assert.deepEqual(TV.Store.loadFavourites(), {});
  assert.equal(TV.Store.toggleFavourite('canal-1'), true);
  assert.equal(TV.Store.toggleFavourite('canal-2'), true);
  assert.deepEqual(TV.Store.loadFavourites(), { 'canal-1': 1, 'canal-2': 1 });
  assert.equal(TV.Store.toggleFavourite('canal-1'), false);
  assert.deepEqual(TV.Store.loadFavourites(), { 'canal-2': 1 });
});

test('historico: mais recentes primeiro, sem repetidos, com limite', () => {
  TV.Store.clearAll();
  for (let i = 1; i <= 5; i++) {
    TV.Store.pushHistory({ id: 'c' + i, name: 'Canal ' + i, group: 'G', logo: '' }, 3);
  }
  TV.Store.pushHistory({ id: 'c3', name: 'Canal 3', group: 'G', logo: '' }, 3);
  const h = TV.Store.loadHistory();
  assert.equal(h.length, 3, 'o limite e respeitado');
  assert.equal(h[0].id, 'c3', 'o repetido sobe para o topo');
  assert.equal(h[1].id, 'c5');
});

test('listas guardadas: guardar, listar, substituir e apagar', () => {
  TV.Store.clearAll();
  const canais = [{ id: 'a', name: 'A', url: 'http://a/1.ts', kind: 'native', group: 'G' }];
  TV.Store.savePlaylist('Minha lista', canais, { origin: 'ficheiro.m3u' });
  TV.Store.savePlaylist('Minha lista', canais.concat(canais), { origin: 'ficheiro.m3u' });
  let listas = TV.Store.loadPlaylists();
  assert.equal(listas.length, 1, 'guardar com o mesmo nome substitui');
  assert.equal(listas[0].count, 2);

  TV.Store.savePlaylist('Outra', canais, {});
  assert.equal(TV.Store.loadPlaylists().length, 2);
  TV.Store.deletePlaylist('Outra');
  assert.equal(TV.Store.loadPlaylists().length, 1);
});

test('definicoes guardadas sobrevivem e valores invalidos sao corrigidos', () => {
  TV.Store.clearAll();
  TV.Store.saveSettings({ volume: 40, maxBufferSec: 999, tema: 'ignorado' });
  const s = TV.Store.loadSettings();
  assert.equal(s.volume, 40);
  assert.equal(s.maxBufferSec, 120, 'valor fora do intervalo e limitado');
  assert.equal(s.tema, undefined, 'chaves desconhecidas nao entram');
  assert.equal(s.proxy, '127.0.0.1:4022', 'as restantes voltam ao valor por omissao');
});

/* ------------------------------------------------------------------ recorder */

test('o gravador recusa-se quando o browser nao tem MediaRecorder', () => {
  const rec = TV.Recorder();
  assert.equal(rec.supported(), false, 'em Node nao ha MediaRecorder');
  const res = rec.start({ fake: true }, 'webm');
  assert.equal(res.ok, false);
  assert.ok(/MediaRecorder/.test(res.error));
  assert.equal(rec.active(), false);
});
