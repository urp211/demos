/* TVmakina - deteccao e ajustes para PCs fracos
 * Windows 7 + 3 GB RAM + CPU de 2 nucleos a 2.2 GHz entra automaticamente em "modo leve".
 * ES5 puro.
 */
(function (root) {
  'use strict';

  var TV = root.TVmakina || (root.TVmakina = {});

  TV.detectLowEnd = function () {
    var reasons = [];
    var cores = 0;
    var ramGb = 0;
    var nav = root.navigator || {};

    if (nav.hardwareConcurrency) { cores = nav.hardwareConcurrency; }
    if (nav.deviceMemory) { ramGb = nav.deviceMemory; }

    if (cores && cores <= 2) { reasons.push('CPU com ' + cores + ' nucleos logico(s)'); }
    if (ramGb && ramGb <= 4) { reasons.push('o browser declara ~' + ramGb + ' GB de RAM'); }

    /* sem navegadores modernos: sem fetch ou sem MSE = maquina/browser antigo */
    if (!root.fetch) { reasons.push('browser sem fetch (antigo)'); }
    if (!TV.mseSupported()) { reasons.push('sem Media Source Extensions'); }

    var mem = null;
    try {
      if (root.performance && root.performance.memory && root.performance.memory.jsHeapSizeLimit) {
        mem = root.performance.memory.jsHeapSizeLimit / (1024 * 1024);
        if (mem && mem < 1200) { reasons.push('limite de memoria do browser ~' + Math.round(mem) + ' MB'); }
      }
    } catch (e) { mem = null; }

    return {
      lowEnd: reasons.length > 0,
      cores: cores,
      ramGb: ramGb,
      heapLimitMb: mem ? Math.round(mem) : 0,
      reasons: reasons,
      userAgent: nav.userAgent || ''
    };
  };

  /* Aplicar ajustes ao documento: menos sombras, menos animacoes, menos pixels. */
  TV.applyLowEndTweaks = function (doc, enabled) {
    if (!doc || !doc.documentElement) { return false; }
    var cls = ' modo-leve';
    var el = doc.documentElement;
    var current = el.className || '';
    if (enabled) {
      if (current.indexOf('modo-leve') === -1) { el.className = current + cls; }
    } else {
      el.className = current.replace(/\s*modo-leve/g, '');
    }
    return enabled;
  };

  /* Definicoes recomendadas quando o modo leve esta activo. */
  TV.lowEndSettings = function (settings) {
    var out = TV.assign({}, settings || {});
    out.maxBufferSec = Math.min(TV.parseIntSafe(out.maxBufferSec, 8), 8);
    out.maxStarveSec = 3;
    out.retryTimes = 1;
    out.hwAccel = false;
    out.showLogos = false;
    if (!out.maxBitrate) { out.maxBitrate = 1500000; }  /* ~720p: um Core 2 Duo nao aguenta 1080p por software */
    return out;
  };

  TV.describeMachine = function (info) {
    var bits = [];
    bits.push(info.cores ? info.cores + ' nucleo(s)' : 'nucleos: desconhecido');
    if (info.ramGb) { bits.push('~' + info.ramGb + ' GB RAM (browser)'); }
    if (info.heapLimitMb) { bits.push('limite JS ' + info.heapLimitMb + ' MB'); }
    return bits.join(' · ');
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = TV; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
