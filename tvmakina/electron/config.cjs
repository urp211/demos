/* TVmakina - configuracao do processo principal do Electron
 *
 * Todo o "saber" sobre como correr em PCs fracos esta aqui, em funcoes puras,
 * para poder ser testado sem o Electron instalado (npm test).
 *
 * Alvo: Windows 7 SP1 / 8.1, 3 GB de RAM, CPU de 2 nucleos.
 * Por isso: Electron 22.3.x (Chromium 108) e a ULTIMA linha com suporte a Windows 7.
 */
'use strict';

var DEFAULTS = {
  width: 1280,
  height: 800,
  minWidth: 900,
  minHeight: 560,
  ramMb: 0,           /* 0 = desconhecido */
  cores: 0,
  lowEnd: null,       /* null = deteccao automatica */
  hwAccel: true,
  devTools: false,
  title: 'TVmakina'
};

function assign(target) {
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    if (!src) { continue; }
    for (var k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) { target[k] = src[k]; }
    }
  }
  return target;
}

/* Decide se a maquina e "fraca" com a informacao que o Electron consegue ler. */
function isLowEndMachine(info) {
  var i = info || {};
  if (i.lowEnd === true) { return true; }
  if (i.lowEnd === false) { return false; }
  if (i.ramMb && i.ramMb <= 3584) { return true; }        /* <= 3.5 GB */
  if (i.cores && i.cores <= 2) { return true; }
  return false;
}

/* Flags do Chromium para ocupar menos RAM e nao depender de drivers graficos velhos. */
function buildSwitches(options) {
  var o = assign({}, DEFAULTS, options || {});
  var list = [];

  var low = isLowEndMachine(o);
  var features = ['Translate', 'MediaRouter', 'OptimizationHints', 'InterestFeedContentSuggestions'];
  if (low) { features.push('BackForwardCache'); }

  list.push('--js-flags=--max-old-space-size=' + (low ? 256 : 512));
  list.push('--disable-features=' + features.join(','));
  list.push('--disable-background-timer-throttling');   /* o video nao pode ser travado em segundo plano */
  list.push('--disable-renderer-backgrounding');
  list.push('--disable-backgrounding-occluded-windows');
  list.push('--no-default-browser-check');
  list.push('--no-first-run');
  list.push('--metrics-recording-only');

  if (low) {
    list.push('--disable-smooth-scrolling');
    list.push('--renderer-process-limit=2');
    list.push('--disk-cache-size=52428800');            /* 50 MB de cache, nao centenas */
    list.push('--force-color-profile=srgb');
  }

  if (!o.hwAccel) {
    /* Em Windows 7 com drivers antigos a GPU e a causa numero 1 de ecra preto. */
    list.push('--disable-gpu');
    list.push('--disable-gpu-compositing');
    list.push('--disable-gpu-vsync');
    list.push('--in-process-gpu');
  }

  /* remover duplicados mantendo a ordem */
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (!seen[list[i]]) { seen[list[i]] = 1; out.push(list[i]); }
  }
  return out;
}

/* Opcoes da janela: sem transparencias nem vibracoes, que custam GPU. */
function buildWindowOptions(options) {
  var o = assign({}, DEFAULTS, options || {});
  return {
    width: o.width,
    height: o.height,
    minWidth: o.minWidth,
    minHeight: o.minHeight,
    title: o.title,
    backgroundColor: '#05070d',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      preload: o.preload || null
    }
  };
}

/* Limite de memoria do proprio Node (processo principal). */
function memoryArgv(options) {
  var o = assign({}, DEFAULTS, options || {});
  return ['--max-old-space-size=' + (isLowEndMachine(o) ? 128 : 256)];
}

/* Mapa de atalhos de teclado anunciado no menu (a UI trata deles). */
function shortcuts() {
  return [
    { tecla: 'Page Down', accao: 'canal seguinte' },
    { tecla: 'Page Up', accao: 'canal anterior' },
    { tecla: '0-9', accao: 'sintonizar por numero' },
    { tecla: 'Espaco', accao: 'reproduzir / pausa' },
    { tecla: 'M', accao: 'silenciar' },
    { tecla: 'F', accao: 'favorito' },
    { tecla: 'R', accao: 'gravar' },
    { tecla: 'I', accao: 'informacao do canal' },
    { tecla: '/', accao: 'procurar' }
  ];
}

module.exports = {
  DEFAULTS: DEFAULTS,
  isLowEndMachine: isLowEndMachine,
  buildSwitches: buildSwitches,
  buildWindowOptions: buildWindowOptions,
  memoryArgv: memoryArgv,
  shortcuts: shortcuts
};
