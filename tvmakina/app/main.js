/* TVmakina - arranque da aplicacao
 * ES5 puro.
 */
(function (root) {
  'use strict';

  var TV = root.TVmakina || (root.TVmakina = {});

  var SAMPLES = [
    { label: 'Canais iniciais (exemplo)', src: 'channels/canais-inicial.m3u' },
    { label: 'Catalogo PT (iptv-org)', src: 'channels/catalogo/pt.m3u' },
    { label: 'Catalogo BR (iptv-org)', src: 'channels/catalogo/br.m3u' },
    { label: 'Catalogo AO (iptv-org)', src: 'channels/catalogo/ao.m3u' },
    { label: 'Catalogo MZ (iptv-org)', src: 'channels/catalogo/mz.m3u' },
    { label: 'Catalogo ES (iptv-org)', src: 'channels/catalogo/es.m3u' },
    { label: 'Catalogo FR (iptv-org)', src: 'channels/catalogo/fr.m3u' }
  ];

  function start() {
    var doc = root.document;
    var video = doc.getElementById('video');
    var canvas = doc.getElementById('test-canvas');

    var ui = TV.UI({ doc: doc, win: root, samples: SAMPLES });

    /* o leitor partilha o MESMO objecto de definicoes da interface:
     * mudar uma definicao no ecra afecta imediatamente a reproducao. */
    var player = TV.Player({
      video: video,
      canvas: canvas,
      settings: ui.settings(),
      hooks: {
        state: function (d) { ui.onState(d); },
        stats: function (d) { ui.onStats(d); },
        loading: function (d) { ui.onLoading(d); },
        next: function () { ui.playDelta(1); },
        stalled: function () { ui.toast('O stream esta parado; a tentar recuperar.', 'warn', 2500); }
      }
    });

    var boot = ui.init(player);

    /* ligacao opcional ao processo principal do Electron (aplicacao para desktop) */
    if (root.tvmakinaDesktop && root.tvmakinaDesktop.onOpenChannel) {
      root.tvmakinaDesktop.onOpenChannel(function (payload) {
        if (!payload || !payload.url) { return; }
        ui.setChannels([{
          id: 'ipc-1',
          name: payload.name || 'Canal aberto por linha de comandos',
          group: 'Linha de comandos',
          url: payload.url,
          kind: TV.detectStreamType(payload.url),
          logo: ''
        }], 'Linha de comandos');
        ui.playChannel(ui.channels()[0]);
      });
    }

    /* retomar o ultimo canal visto */
    if (boot.lastChannel && boot.lastChannel.url && TV.parseBool(ui.settings().rememberLast, true)) {
      ui.setChannels([boot.lastChannel], 'Ultimo canal');
      ui.playChannel(boot.lastChannel, true);
      ui.toast('A retomar: ' + boot.lastChannel.name, '', 3500);
    } else {
      /* sem nada guardado: arrancar com o sinal de teste para provar que tudo funciona */
      ui.startTest('smpte');
    }

    if (!TV.hlsAvailable()) {
      ui.toast('Este browser nao tem Media Source Extensions: canais HLS (m3u8) nao vao tocar. ' +
        'No Windows 7 use Firefox 115 ESR ou Chrome 109, ou a aplicacao para desktop.', 'warn', 9000);
    }

    root.TVmakinaApp = { ui: ui, player: player };
    return root.TVmakinaApp;
  }

  function ready(fn) {
    if (root.document && root.document.readyState === 'complete') { fn(); return; }
    if (root.document && root.document.addEventListener) {
      root.document.addEventListener('DOMContentLoaded', fn, false);
      root.addEventListener('load', fn, false);
    } else if (root.document && root.document.attachEvent) {
      root.document.attachEvent('onreadystatechange', function () {
        if (root.document.readyState === 'complete') { fn(); }
      });
      root.attachEvent('onload', fn);
    }
  }

  var started = false;
  ready(function () {
    if (started) { return; }
    started = true;
    try {
      start();
    } catch (e) {
      var box = root.document.getElementById('overlay-msg');
      if (box) { box.innerHTML = 'Erro ao arrancar: ' + TV.escapeHtml(e.message); }
      if (root.console && root.console.log) { root.console.log(e); }
    }
  });

  TV.start = start;

  if (typeof module !== 'undefined' && module.exports) { module.exports = TV; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
