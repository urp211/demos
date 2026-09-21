/* Testa o gerador de ficheiro unico e os icones: corre o script real e
 * confirma o que ele produz.
 */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function corre(script) {
  return execFileSync(process.execPath, [path.join(ROOT, 'build', script)], {
    cwd: ROOT,
    encoding: 'utf8'
  });
}

test('o ficheiro unico leve e gerado sem referencias exteriores', () => {
  const out = corre('single-file.js');
  assert.match(out, /TVmakina\.html/);

  const leve = fs.readFileSync(path.join(DIST, 'TVmakina.html'), 'utf8');
  assert.ok(leve.startsWith('<!doctype html>'));

  /* nenhum ficheiro local por carregar */
  const refs = leve.match(/(?:src|href)="([^"]+)"/g) || [];
  const locais = refs
    .map((r) => r.replace(/^(?:src|href)="/, '').replace(/"$/, ''))
    .filter((u) => /^(app|styles|vendor|icons)\//.test(u));
  assert.deepEqual(locais, [], 'o ficheiro unico nao pode depender de ficheiros soltos');

  /* o codigo real esta la dentro */
  assert.ok(leve.includes('TVmakina - nucleo'), 'core.js inline');
  assert.ok(leve.includes('lista virtualizada'), 'ui.js inline');
  assert.ok(leve.includes('TVmakina - folha de estilos'), 'CSS inline');
  /* o motor HLS (biblioteca) nao esta na versao leve; o nosso leitor esta */
  assert.ok(!/hls\.js/.test(leve), 'a biblioteca hls.js nao esta na versao leve');
  assert.ok(leve.includes('TVmakina - motor de reproducao'), 'mas o nosso leitor esta');
  assert.match(leve, /motor HLS nao incluido/, 'com aviso explicativo');
  assert.ok(leve.length < 200000, 'a versao leve tem de continuar pequena: ' + leve.length);
});

test('o ficheiro unico completo traz o motor HLS dentro', () => {
  corre('single-file.js');
  const completo = fs.readFileSync(path.join(DIST, 'TVmakina-completo.html'), 'utf8');
  assert.ok(completo.length > 400000, 'deve incluir o hls.min.js: ' + completo.length);
  assert.ok(/hls\.js/.test(completo), 'o bloco do hls.js esta identificado');
  assert.ok(completo.includes('TVmakina - motor de reproducao'), 'player.js inline');

  const leve = fs.statSync(path.join(DIST, 'TVmakina.html')).size;
  assert.ok(completo.length - leve > 250000,
    'a diferenca tem de ser o motor HLS: ' + (completo.length - leve));
});

test('os icones PNG e ICO sao gerados e validos', () => {
  corre('make-icons.js');
  const png = fs.readFileSync(path.join(ROOT, 'icons', 'icon-64.png'));
  const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(0, 8).compare(assinatura), 0, 'assinatura PNG');

  const ico = fs.readFileSync(path.join(ROOT, 'icons', 'icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0, 'reservado');
  assert.equal(ico.readUInt16LE(2), 1, 'tipo icone');
  const quantos = ico.readUInt16LE(4);
  assert.ok(quantos >= 4, 'ICO com varios tamanhos: ' + quantos);

  /* cada entrada aponta para um PNG dentro do ficheiro */
  for (let i = 0; i < quantos; i++) {
    const base = 6 + i * 16;
    const tamanho = ico.readUInt32LE(base + 8);
    const offset = ico.readUInt32LE(base + 12);
    assert.ok(tamanho > 0 && offset + tamanho <= ico.length, 'entrada valida');
    assert.equal(ico.subarray(offset, offset + 8).compare(assinatura), 0, 'entrada ' + i + ' e PNG');
  }
});

test('a verificacao de ES5 passa sobre o codigo todo', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'build', 'check-es5.js')], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  assert.match(out, /0 erro\(s\)/);
  assert.match(out, /app\/ui\.js\s+\(ES5/);
});

test('o ficheiro unico gerado arranca mesmo num DOM (sem ficheiros externos)', async () => {
  const { JSDOM } = await import('jsdom');
  const { readFileSync } = await import('node:fs');
  const htmlPath = path.join(DIST, 'TVmakina.html');
  const html = readFileSync(htmlPath, 'utf8');

  const dom = new JSDOM(html, { url: 'file://' + htmlPath, runScripts: 'dangerously', pretendToBeVisual: true });
  const window = dom.window;

  /* os mesmos substitutos minimos do ambiente de teste */
  window.HTMLCanvasElement.prototype.getContext = function () {
    return { fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {}, fill() {}, fillText() {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set font(v) {} };
  };
  window.HTMLCanvasElement.prototype.captureStream = function () { return { stop() {} }; };
  window.HTMLMediaElement.prototype.play = function () {
    const self = this;
    setTimeout(() => self.dispatchEvent(new window.Event('playing')), 0);
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function () {};
  window.HTMLMediaElement.prototype.load = function () {};

  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.dispatchEvent(new window.Event('load'));
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.ok(window.TVmakina, 'o codigo inline correu');
  assert.ok(window.TVmakinaApp, 'a aplicacao arrancou a partir do ficheiro unico');
  assert.equal(window.TVmakinaApp.player.state(), 'a-reproduzir', 'o sinal de teste arrancou');
  assert.equal(window.TVmakinaApp.ui.allChannels().length, 0);
  dom.window.close();
});
