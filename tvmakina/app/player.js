/* TVmakina - motor de reproducao (video nativo + HLS + multicast via proxy)
 * Ajustado para PCs fracos: buffers pequenos, sem workers extra, limite de bitrate.
 * ES5 puro.
 */
(function (root) {
  'use strict';

  var TV = root.TVmakina || (root.TVmakina = {});
  var has = TV.has;

  /* ---------------- configuracao HLS para maquinas fracas ---------------- */

  TV.defaultHlsConfig = function (settings) {
    var s = settings || {};
    var buffer = TV.clamp(TV.parseIntSafe(s.maxBufferSec, 12), 3, 120);
    var cfg = {
      enableWorker: false,              /* 1 thread a menos = menos RAM e menos trocas de contexto */
      lowLatencyMode: false,
      backBufferLength: 10,
      maxBufferLength: buffer,
      maxBufferSize: 2 * 1024 * 1024,   /* 2 MB por buffer, nao 60 MB como por omissao */
      maxBufferHole: 1.5,
      maxStarvationDelay: TV.clamp(TV.parseIntSafe(s.maxStarveSec, 4), 1, 30),
      maxLoadingDelay: 4,
      fragLoadingTimeOut: 20000,
      fragLoadingMaxRetry: 4,
      fragLoadingRetryDelay: 1000,
      manifestLoadingTimeOut: 15000,
      manifestLoadingMaxRetry: 3,
      levelLoadingTimeOut: 15000,
      levelLoadingMaxRetry: 4,
      startLevel: -1,
      autoStartLoad: true,
      capLevelToPlayerSize: true,       /* nao descarrega 1080p num ecra pequeno */
      stretchShortVideoTrack: true,
      progressive: false,
      xhrSetup: null
    };
    var maxBr = TV.parseIntSafe(s.maxBitrate, 0);
    if (maxBr > 0) { cfg.autoLevelCapping = -1; cfg.maxAutoLevel = -1; }
    return cfg;
  };

  /* Escolhe o nivel maximo de acordo com o limite de bitrate (0 = automatico). */
  TV.pickMaxLevel = function (levels, maxBitrate) {
    if (!levels || !levels.length) { return -1; }
    if (!maxBitrate || maxBitrate <= 0) { return -1; }
    var best = -1;
    for (var i = 0; i < levels.length; i++) {
      var br = levels[i] && levels[i].bitrate ? levels[i].bitrate : 0;
      if (br && br <= maxBitrate) { best = i; }
    }
    return best;
  };

  TV.hlsAvailable = function () {
    return !!(root.Hls && root.Hls.isSupported && root.Hls.isSupported());
  };

  TV.mseSupported = function () {
    try {
      return !!(root.MediaSource || root.WebKitMediaSource);
    } catch (e) { return false; }
  };

  /* ---------------- sinal de teste ---------------- */

  TV.TestSignal = function (opts) {
    var o = opts || {};
    var canvas = o.canvas || null;
    var ctx = canvas ? (canvas.getContext ? canvas.getContext('2d') : null) : null;
    var timer = null;
    var audio = null;
    var osc = null;
    var gain = null;
    var stream = null;
    var pattern = o.pattern || 'smpte';
    var label = o.label || 'TVmakina';
    var frames = 0;

    var SMPTE = [
      ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'],
      ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0']
    ];

    function drawSmpte(w, h, t) {
      var i;
      var top = Math.floor(h * 0.66);
      var mid = Math.floor(h * 0.09);
      var bw = w / 7;
      for (i = 0; i < 7; i++) {
        ctx.fillStyle = SMPTE[0][i];
        ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, top);
      }
      for (i = 0; i < 7; i++) {
        ctx.fillStyle = SMPTE[1][i];
        ctx.fillRect(Math.floor(i * bw), top, Math.ceil(bw) + 1, mid);
      }
      var shades = ['#002b52', '#ffffff', '#3b0b4d', '#131313'];
      var bw2 = w / 4;
      for (i = 0; i < 4; i++) {
        ctx.fillStyle = shades[i];
        ctx.fillRect(Math.floor(i * bw2), top + mid, Math.ceil(bw2) + 1, h - top - mid);
      }
      /* barra a mexer para provar que ha movimento */
      ctx.fillStyle = '#ffffff';
      var x = Math.floor((t / 25) % w);
      ctx.fillRect(x, top + mid, Math.max(4, Math.floor(w / 120)), h - top - mid);
    }

    function drawBars(w, h, t) {
      var colors = ['#ff2d55', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de'];
      var bw = w / colors.length;
      for (var i = 0; i < colors.length; i++) {
        ctx.fillStyle = colors[i];
        ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, h);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, h - Math.floor(h * 0.18), w, Math.floor(h * 0.18));
      ctx.fillStyle = '#ffffff';
      var s = Math.max(10, Math.floor(h / 12));
      if (ctx.font !== undefined) { ctx.font = 'bold ' + s + 'px monospace'; }
      var txt = label + '  ' + (pattern === 'relogio' ? clockText() : 'CANAL DE TESTE  ' + Math.floor(t / 1000) + 's');
      if (ctx.fillText) { ctx.fillText(txt, 12, h - Math.floor(h * 0.06)); }
    }

    function drawNoise(w, h, t) {
      var block = 8;
      for (var y = 0; y < h; y += block) {
        for (var x = 0; x < w; x += block) {
          var v = Math.floor(((Math.sin((x + y + t) * 0.07) + 1) * 0.5) * 255);
          var c = Math.floor(Math.random() * 255);
          var g = Math.floor((v + c) / 2);
          ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
          ctx.fillRect(x, y, block, block);
        }
      }
    }

    function drawClock(w, h) {
      ctx.fillStyle = '#05070d';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#39d98a';
      ctx.lineWidth = Math.max(2, Math.floor(h / 120));
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      var d = new Date();
      var angles = [
        ((d.getSeconds() / 60) * Math.PI * 2) - Math.PI / 2,
        ((d.getMinutes() / 60) * Math.PI * 2) - Math.PI / 2,
        ((d.getHours() % 12) / 12) * Math.PI * 2 - Math.PI / 2
      ];
      var lens = [0.32, 0.26, 0.16];
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 + Math.cos(angles[i]) * Math.min(w, h) * lens[i], h / 2 + Math.sin(angles[i]) * Math.min(w, h) * lens[i]);
        ctx.stroke();
      }
      ctx.fillStyle = '#39d98a';
      if (ctx.font !== undefined) { ctx.font = 'bold ' + Math.floor(h / 10) + 'px monospace'; }
      if (ctx.fillText) { ctx.fillText(clockText(), w / 2 - Math.floor(h / 6), h * 0.88); }
    }

    function clockText() {
      var d = new Date();
      var p = function (x) { return (x < 10 ? '0' : '') + x; };
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    function draw() {
      if (!ctx) { return; }
      var w = canvas.width;
      var h = canvas.height;
      var t = TV.now();
      if (pattern === 'barras') { drawBars(w, h, t); }
      else if (pattern === 'ruido') { drawNoise(w, h, t); }
      else if (pattern === 'relogio') { drawClock(w, h); }
      else { drawSmpte(w, h, t); }
      frames++;
    }

    var api = {
      start: function () {
        if (!canvas || !ctx) { return false; }
        if (!timer) { timer = setInterval(draw, 100); draw(); }   /* 10 fps: chega e poupa CPU */
        return true;
      },
      stop: function () {
        if (timer) { clearInterval(timer); timer = null; }
        api.stopAudio();
        if (stream && stream.stop) { try { stream.stop(); } catch (e) { /* ignorar */ } }
        stream = null;
      },
      setPattern: function (p) { pattern = p; draw(); },
      getPattern: function () { return pattern; },
      frames: function () { return frames; },
      stream: function () {
        if (stream) { return stream; }
        if (!canvas || !canvas.captureStream) { return null; }
        try { stream = canvas.captureStream(10); } catch (e) { stream = null; }
        return stream;
      },
      canvas: function () { return canvas; },
      startAudio: function () {
        var AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) { return false; }
        try {
          if (!audio) { audio = new AC(); }
          if (audio.state === 'suspended' && audio.resume) { audio.resume(); }
          if (!osc) {
            osc = audio.createOscillator();
            gain = audio.createGain();
            osc.type = 'sine';
            osc.frequency.value = 1000;
            gain.gain.value = 0.06;
            osc.connect(gain);
            gain.connect(audio.destination);
            osc.start(0);
          }
          return true;
        } catch (e) { return false; }
      },
      stopAudio: function () {
        try { if (osc) { osc.stop(); } } catch (e) { /* ignorar */ }
        osc = null;
        gain = null;
        if (audio && audio.close) { try { audio.close(); } catch (e2) { /* ignorar */ } }
        audio = null;
      },
      running: function () { return !!timer; }
    };
    return api;
  };

  /* ---------------- gravador ---------------- */

  TV.Recorder = function () {
    var recorder = null;
    var chunks = [];
    var startedAt = 0;
    var mime = '';

    function pickMime(preferred) {
      var list = [];
      if (preferred === 'mp4') { list = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm']; }
      else {
        list = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];
      }
      if (!root.MediaRecorder || !root.MediaRecorder.isTypeSupported) { return list[0]; }
      for (var i = 0; i < list.length; i++) {
        try { if (root.MediaRecorder.isTypeSupported(list[i])) { return list[i]; } } catch (e) { /* ignorar */ }
      }
      return '';
    }

    var api = {
      supported: function () { return !!root.MediaRecorder; },

      start: function (stream, preferred) {
        if (!root.MediaRecorder) { return { ok: false, error: 'Este browser nao suporta gravacao (MediaRecorder).' }; }
        if (!stream) { return { ok: false, error: 'Sem fluxo de video para gravar.' }; }
        if (recorder) { return { ok: false, error: 'Ja esta a gravar.' }; }
        mime = pickMime(preferred);
        chunks = [];
        try {
          recorder = new root.MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 1500000 } : undefined);
        } catch (e) {
          try { recorder = new root.MediaRecorder(stream); } catch (e2) {
            return { ok: false, error: 'Nao foi possivel iniciar a gravacao: ' + e2.message };
          }
        }
        recorder.ondataavailable = function (ev) {
          if (ev && ev.data && ev.data.size) { chunks.push(ev.data); }
        };
        try { recorder.start(1000); } catch (e3) {
          return { ok: false, error: 'Nao foi possivel iniciar a gravacao: ' + e3.message };
        }
        startedAt = TV.now();
        return { ok: true, mime: mime };
      },

      stop: function () {
        if (!recorder) { return null; }
        try { recorder.stop(); } catch (e) { /* ignorar */ }
        recorder = null;
        var size = 0;
        for (var i = 0; i < chunks.length; i++) { size += chunks[i].size || 0; }
        var out = { chunks: chunks, mime: mime, bytes: size, seconds: Math.round((TV.now() - startedAt) / 1000) };
        chunks = [];
        return out;
      },

      active: function () { return !!recorder && recorder.state === 'recording'; },

      elapsed: function () { return startedAt ? Math.floor((TV.now() - startedAt) / 1000) : 0; },

      toBlob: function (data) {
        if (!data || !data.chunks || !data.chunks.length) { return null; }
        try { return new root.Blob(data.chunks, { type: data.mime || 'video/webm' }); } catch (e) { return null; }
      }
    };
    return api;
  };

  /* ---------------- leitor ---------------- */

  TV.Player = function (opts) {
    var o = opts || {};
    var video = o.video;
    var canvas = o.canvas || null;
    var settings = o.settings || {};
    var hooks = o.hooks || {};

    var hls = null;
    var test = null;
    var current = null;
    var attempt = 0;
    var timerRetry = null;
    var statsTimer = null;
    var state = 'parado';
    var lastError = '';
    var usingHls = false;
    var lastBytes = 0;
    var lastBytesAt = 0;

    function emit(name, data) {
      if (hooks[name]) {
        try { hooks[name](data || {}); } catch (e) { /* nunca deixar a UI partir o leitor */ }
      }
    }

    function setState(s, extra) {
      state = s;
      emit('state', { state: s, channel: current, error: lastError, extra: extra || {} });
    }

    function destroyHls() {
      if (hls) {
        try { hls.destroy(); } catch (e) { /* ignorar */ }
        hls = null;
      }
      usingHls = false;
    }

    function stopTest() {
      if (test) { test.stop(); test = null; }
      if (canvas) { canvas.style.display = 'none'; }
    }

    function clearTimers() {
      if (timerRetry) { clearTimeout(timerRetry); timerRetry = null; }
    }

    function stopStats() {
      if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    }

    function startStats() {
      stopStats();
      statsTimer = setInterval(function () { emit('stats', api.stats()); }, 1000);
    }

    function nativeLoad(url, type) {
      destroyHls();
      stopTest();
      if (video) {
        try { video.pause(); } catch (e) { /* ignorar */ }
        video.src = url;
        if (video.load) { video.load(); }
        var p = null;
        try { p = video.play(); } catch (e2) { p = null; }
        if (p && p['catch']) {
          p['catch'](function (err) {
            if (err && err.name === 'NotAllowedError') {
              lastError = 'Reproducao bloqueada pelo browser: prima reproduzir outra vez.';
              setState('bloqueado');
            }
          });
        }
      }
      setState('a-carregar', { type: type });
    }

    function hlsLoad(url) {
      if (!TV.hlsAvailable()) {
        lastError = 'Este canal e HLS (m3u8) e este browser nao tem suporte MSE. ' +
          'Use o Firefox 115 ESR / Chrome 109 no Windows 7, ou a aplicacao TVmakina para desktop.';
        setState('erro');
        return;
      }
      destroyHls();
      stopTest();
      try {
        hls = new root.Hls(TV.defaultHlsConfig(settings));
      } catch (e) {
        lastError = 'Falha ao iniciar o motor HLS: ' + e.message;
        setState('erro');
        return;
      }
      usingHls = true;
      hls.on(root.Hls.Events.MANIFEST_PARSED, function (evt, data) {
        var maxBr = TV.parseIntSafe(settings.maxBitrate, 0);
        hls.maxAutoLevel = TV.pickMaxLevel(data && data.levels, maxBr);
        if (video) {
          var p = null;
          try { p = video.play(); } catch (e2) { p = null; }
          if (p && p['catch']) { p['catch'](function () { /* ignorar */ }); }
        }
        setState('a-reproduzir', { levels: (data && data.levels) ? data.levels.length : 0 });
      });
      hls.on(root.Hls.Events.LEVEL_SWITCHED, function (evt, data) {
        emit('level', { index: data && data.level });
      });
      hls.on(root.Hls.Events.ERROR, function (evt, data) {
        if (!data || !data.fatal) { return; }
        var type = data.type;
        var details = data.details || '';
        if (type === root.Hls.ErrorTypes.NETWORK_ERROR && attempt < TV.parseIntSafe(settings.retryTimes, 2)) {
          attempt++;
          lastError = 'Rede: ' + details + ' (tentativa ' + attempt + ')';
          setState('a-tentar', { attempt: attempt });
          try { hls.startLoad(); } catch (e) { /* ignorar */ }
          return;
        }
        if (type === root.Hls.ErrorTypes.MEDIA_ERROR) {
          lastError = 'Descodificacao: ' + details;
          setState('a-tentar', {});
          try { hls.recoverMediaError(); } catch (e2) { /* ignorar */ }
          return;
        }
        lastError = 'HLS: ' + details;
        setState('erro');
      });
      hls.loadSource(url);
      if (video) { hls.attachMedia(video); }
      setState('a-carregar', { type: 'hls' });
    }

    function testLoad(channel) {
      destroyHls();
      if (!canvas) {
        lastError = 'Sinal de teste indisponivel (sem canvas).';
        setState('erro');
        return;
      }
      canvas.style.display = 'block';
      var parts = String(channel.url || 'test:').split(':');
      var pattern = parts[1] || 'smpte';
      if (canvas.width !== 640) { canvas.width = 640; }
      if (canvas.height !== 360) { canvas.height = 360; }
      test = TV.TestSignal({ canvas: canvas, pattern: pattern, label: channel.name || 'TVmakina' });
      test.start();
      var stream = test.stream();
      if (stream && video) {
        try {
          video.src = '';
          video.srcObject = stream;
          var p = video.play();
          if (p && p['catch']) { p['catch'](function () { /* ignorar */ }); }
        } catch (e) { /* canvas visivel chega */ }
      } else if (video) {
        try { video.removeAttribute('src'); video.load(); } catch (e2) { /* ignorar */ }
      }
      lastError = '';
      setState('a-reproduzir', { type: 'test', pattern: pattern });
    }

    function failUnsupported(channel) {
      destroyHls();
      stopTest();
      lastError = TV.unsupportedReason(channel.kind || TV.detectStreamType(channel.url)) || 'Formato nao suportado.';
      setState('erro');
    }

    var api = {
      current: function () { return current; },
      state: function () { return state; },
      error: function () { return lastError; },
      isHls: function () { return usingHls; },
      video: function () { return video; },
      testSignal: function () { return test; },

      load: function (channel) {
        clearTimers();
        attempt = 0;
        lastError = '';
        current = channel;
        if (!channel) { api.stop(); return; }
        var type = channel.kind || TV.detectStreamType(channel.url);
        var url = TV.buildStreamUrl(channel, settings);
        emit('loading', { channel: channel, url: url, type: type });
        if (type === 'test') { testLoad(channel); startStats(); return; }
        if (type === 'unsupported') { failUnsupported(channel); stopStats(); return; }
        if (type === 'hls') { hlsLoad(url); startStats(); return; }
        if (type === 'udp' || type === 'native' || type === 'unknown') { nativeLoad(url, type); startStats(); return; }
        failUnsupported(channel);
        stopStats();
      },

      /* Estrategia de recuperacao usada quando o browser desiste do stream. */
      handleFailure: function (message) {
        lastError = message || 'O stream terminou ou nao esta acessivel.';
        var max = TV.parseIntSafe(settings.retryTimes, 2);
        if (attempt < max) {
          attempt++;
          setState('a-tentar', { attempt: attempt });
          timerRetry = setTimeout(function () {
            if (current) { api.load(current); }
          }, 1500 * attempt);
          return 'retry';
        }
        setState('erro');
        if (TV.parseBool(settings.autoNext, true)) {
          emit('next');
          return 'next';
        }
        return 'stop';
      },

      stop: function () {
        clearTimers();
        stopStats();
        destroyHls();
        stopTest();
        if (video) {
          try { video.pause(); } catch (e) { /* ignorar */ }
          try { video.removeAttribute('src'); video.load(); } catch (e2) { /* ignorar */ }
          try { video.srcObject = null; } catch (e3) { /* ignorar */ }
        }
        current = null;
        setState('parado');
      },

      pause: function () { if (video) { try { video.pause(); } catch (e) { /* ignorar */ } } },

      resume: function () {
        if (!video) { return; }
        try {
          var p = video.play();
          if (p && p['catch']) { p['catch'](function () { /* ignorar */ }); }
        } catch (e) { /* ignorar */ }
      },

      setVolume: function (v) {
        if (!video) { return; }
        var vol = TV.clamp(TV.parseIntSafe(v, 100), 0, 100) / 100;
        try { video.volume = vol; } catch (e) { /* ignorar */ }
      },

      setMuted: function (m) { if (video) { try { video.muted = !!m; } catch (e) { /* ignorar */ } } },

      setAspect: function (mode) {
        if (!video) { return; }
        var map = { contain: 'contain', cover: 'cover', fill: 'fill' };
        try { video.style.objectFit = map[mode] || 'contain'; } catch (e) { /* ignorar */ }
      },

      levels: function () { return (hls && hls.levels) ? hls.levels : []; },

      setMaxBitrate: function (bps) {
        settings.maxBitrate = bps;
        if (hls) { hls.maxAutoLevel = TV.pickMaxLevel(hls.levels, bps); }
      },

      audioTracks: function () { return (hls && hls.audioTracks) ? hls.audioTracks : []; },

      setAudioTrack: function (id) { if (hls) { hls.audioTrack = id; } },

      stats: function () {
        var out = {
          state: state,
          error: lastError,
          resolution: '',
          bitrate: 0,
          bufferSec: 0,
          dropped: 0,
          channel: current ? current.name : ''
        };
        if (video) {
          if (video.videoWidth) { out.resolution = video.videoWidth + 'x' + video.videoHeight; }
          if (video.getVideoPlaybackQuality) {
            try { out.dropped = video.getVideoPlaybackQuality().droppedVideoFrames || 0; } catch (e) { /* ignorar */ }
          }
          try {
            if (video.buffered && video.buffered.length) {
              out.bufferSec = Math.max(0, video.buffered.end(video.buffered.length - 1) - (video.currentTime || 0));
            }
          } catch (e2) { /* ignorar */ }
        }
        if (hls) {
          try {
            var lvl = hls.levels && hls.levels[hls.currentLevel];
            if (lvl && lvl.bitrate) { out.bitrate = lvl.bitrate; }
            if (lvl && lvl.height && !out.resolution) { out.resolution = (lvl.width || '?') + 'x' + lvl.height; }
          } catch (e3) { /* ignorar */ }
          var stats = hls.bandwidthEstimate;
          if (stats && !out.bitrate) { out.bitrate = Math.round(stats); }
        }
        /* estimativa de debito para streams nativos */
        if (!out.bitrate && video && video.webkitVideoDecodedByteCount !== undefined) {
          var b = video.webkitVideoDecodedByteCount || 0;
          var t = TV.now();
          if (lastBytesAt && b >= lastBytes) {
            out.bitrate = Math.round(((b - lastBytes) * 8000) / Math.max(1, t - lastBytesAt));
          }
          lastBytes = b;
          lastBytesAt = t;
        }
        return out;
      },

      attachEvents: function () {
        if (!video || video.__tvmakinaBound) { return; }
        video.__tvmakinaBound = true;
        video.onplaying = function () { lastError = ''; setState('a-reproduzir'); };
        video.onwaiting = function () { setState('a-carregar', { reason: 'buffer' }); };
        video.onpause = function () { if (state !== 'parado') { setState('pausa'); } };
        video.onended = function () {
          if (test && test.running()) { return; }
          api.handleFailure('O stream terminou.');
        };
        video.onstalled = function () { emit('stalled', {}); };
        video.onerror = function () {
          var code = video.error ? video.error.code : 0;
          var map = {
            1: 'Reproducao interrompida.',
            2: 'Falha de rede ao descarregar o stream.',
            3: 'Falha ao descodificar o video (codec nao suportado ou CPU insuficiente).',
            4: 'Origem nao suportada: o endereco nao devolve video valido (ou precisa do proxy UDP).'
          };
          if (usingHls) { return; }  /* o HLS trata dos proprios erros */
          api.handleFailure(map[code] || ('Erro de video (codigo ' + code + ').'));
        };
      }
    };

    api.attachEvents();
    return api;
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = TV; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
