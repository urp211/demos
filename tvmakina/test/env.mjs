/* Ambiente de teste: carrega o index.html real num DOM (jsdom) e executa
 * o codigo real da aplicacao (app/*.js), com substitutos minimos para as
 * APIs que o jsdom nao implementa: canvas 2D, <video>, captureStream,
 * MediaRecorder e URL.createObjectURL.
 *
 * Nao ha aqui logica reimplementada: o que corre e o ficheiro que se entrega.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, '..');

function patchWindow(window) {
  /* ---------- canvas 2D ---------- */
  const ctxCalls = [];
  function stub2d(canvas) {
    return {
      canvas: canvas,
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      font: '',
      fillRect(x, y, w, h) { ctxCalls.push(['fillRect', x, y, w, h]); },
      clearRect() { ctxCalls.push(['clearRect']); },
      strokeRect() { ctxCalls.push(['strokeRect']); },
      beginPath() { ctxCalls.push(['beginPath']); },
      moveTo() { ctxCalls.push(['moveTo']); },
      lineTo() { ctxCalls.push(['lineTo']); },
      arc() { ctxCalls.push(['arc']); },
      stroke() { ctxCalls.push(['stroke']); },
      fill() { ctxCalls.push(['fill']); },
      fillText(t) { ctxCalls.push(['fillText', t]); }
    };
  }
  window.HTMLCanvasElement.prototype.getContext = function () { return stub2d(this); };
  window.HTMLCanvasElement.prototype.captureStream = function () {
    return { __fakeStream: true, stop() {} };
  };

  /* ---------- <video> ---------- */
  const videoProto = window.HTMLMediaElement.prototype;
  videoProto.play = function () {
    this.__played = (this.__played || 0) + 1;
    const self = this;
    setTimeout(function () {
      self.dispatchEvent(new window.Event('playing'));
    }, 0);
    return Promise.resolve();
  };
  videoProto.pause = function () { this.dispatchEvent(new window.Event('pause')); };
  videoProto.load = function () { /* sem rede em teste */ };
  videoProto.captureStream = function () { return { __fakeStream: true, stop() {} }; };
  Object.defineProperty(videoProto, 'currentTime', {
    configurable: true,
    get() { return this.__t || 0; },
    set(v) { this.__t = v; }
  });
  Object.defineProperty(videoProto, 'duration', { configurable: true, get() { return NaN; } });
  Object.defineProperty(videoProto, 'paused', { configurable: true, get() { return true; } });
  Object.defineProperty(videoProto, 'buffered', {
    configurable: true,
    get() {
      return { length: 1, start: () => 0, end: () => (this.__t || 0) + 5 };
    }
  });
  videoProto.getVideoPlaybackQuality = function () {
    return { droppedVideoFrames: 0, totalVideoFrames: 100 };
  };

  /* ---------- MediaRecorder ---------- */
  window.MediaRecorder = class FakeRecorder {
    constructor(stream, opts) {
      this.stream = stream;
      this.mimeType = (opts && opts.mimeType) || 'video/webm';
      this.state = 'inactive';
      this.ondataavailable = null;
      this.__chunks = 0;
    }
    static isTypeSupported(t) { return String(t).indexOf('webm') >= 0; }
    start() {
      this.state = 'recording';
      const self = this;
      this.__timer = setInterval(function () {
        if (self.ondataavailable) {
          self.ondataavailable({ data: new window.Blob(['1234567890']) });
          self.__chunks++;
        }
      }, 5);
    }
    stop() {
      this.state = 'inactive';
      if (this.__timer) { clearInterval(this.__timer); this.__timer = null; }
    }
  };

  /* ---------- URL.createObjectURL ---------- */
  window.__createdUrls = [];
  window.URL.createObjectURL = function (blob) {
    const u = 'blob:tvmakina/' + window.__createdUrls.length;
    window.__createdUrls.push({ url: u, size: blob && blob.size ? blob.size : 0 });
    return u;
  };
  window.URL.revokeObjectURL = function () {};

  /* ---------- rede: nada de pedidos reais durante os testes ---------- */
  class FakeXHR {
    constructor() { this.readyState = 0; this.status = 0; this.responseText = ''; }
    open() { this.readyState = 1; }
    setRequestHeader() {}
    send() {
      const self = this;
      setTimeout(function () {
        self.readyState = 4;
        self.status = 0;
        if (self.onerror) { self.onerror(new Error('rede desligada nos testes')); }
        if (self.onreadystatechange) { self.onreadystatechange(); }
      }, 1);
    }
    abort() {}
  }
  window.XMLHttpRequest = FakeXHR;

  /* ---------- maquina "fraca" por omissao nos testes ---------- */
  Object.defineProperty(window.navigator, 'hardwareConcurrency', {
    configurable: true, get() { return 2; }
  });
  Object.defineProperty(window.navigator, 'deviceMemory', {
    configurable: true, get() { return 3; }
  });

  return { ctxCalls };
}

export async function loadApp(options) {
  const opts = options || {};
  const htmlPath = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const dom = new JSDOM(html, {
    url: 'file://' + htmlPath,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });
  const window = dom.window;
  const extras = patchWindow(window);

  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') { resolve(); }
    else { window.addEventListener('load', resolve); }
    setTimeout(resolve, 8000);
  });
  /* dar tempo aos setTimeout(0) do video e aos arranques assincronos */
  await new Promise((resolve) => setTimeout(resolve, opts.settleMs || 120));

  if (!window.TVmakinaApp) {
    const box = window.document.getElementById('overlay-msg');
    throw new Error('a aplicacao nao arrancou no DOM: ' + (box ? box.innerHTML : 'sem mensagem'));
  }

  return {
    dom,
    window,
    document: window.document,
    app: window.TVmakinaApp,
    ui: window.TVmakinaApp.ui,
    player: window.TVmakinaApp.player,
    TV: window.TVmakina,
    ctxCalls: extras.ctxCalls,
    text: (id) => {
      const e = window.document.getElementById(id);
      return e ? e.textContent : null;
    },
    html: (id) => {
      const e = window.document.getElementById(id);
      return e ? e.innerHTML : null;
    },
    el: (id) => window.document.getElementById(id),
    click: (id) => {
      const e = window.document.getElementById(id);
      if (!e) { throw new Error('elemento nao existe: ' + id); }
      e.dispatchEvent(new window.Event('click', { bubbles: true }));
    },
    key: (keyCode, target) => {
      const ev = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'keyCode', { get: () => keyCode });
      Object.defineProperty(ev, 'which', { get: () => keyCode });
      (target || window.document).dispatchEvent(ev);
    },
    tick: (ms) => new Promise((resolve) => setTimeout(resolve, ms || 30)),
    close: () => dom.window.close()
  };
}
