/* TVmakina - interface (DOM puro, sem frameworks)
 * Lista virtualizada: so desenha as linhas visiveis, por isso 10 000 canais
 * continuam a usar pouca memoria e pouca CPU.
 * ES5 puro.
 */
(function (root) {
  'use strict';

  var TV = root.TVmakina || (root.TVmakina = {});
  var has = TV.has;
  var ROW_H = 46;
  var ROW_H_LEVE = 40;

  TV.UI = function (opts) {
    var o = opts || {};
    var doc = o.doc || root.document;
    var win = o.win || root;
    var samples = o.samples || [];

    var el = {};
    var channels = [];        /* lista activa (apos filtro) */
    var allChannels = [];     /* todos os canais carregados */
    var favourites = {};
    var settings = {};
    var player = null;
    var recorder = TV.Recorder ? TV.Recorder() : null;
    var recorderData = null;
    var sleepTimer = null;
    var sleepUntil = 0;
    var currentId = '';
    var groupFilter = '';
    var query = '';
    var onlyFav = false;
    var onlyPlayable = true;
    var lowEnd = false;
    var rowH = ROW_H;
    var frames = 0;
    var fps = 0;
    var lastRenderKey = '';
    var numberBuffer = '';
    var numberTimer = null;
    var info = null;

    function $(id) { return doc.getElementById(id); }

    function ids(list) {
      for (var i = 0; i < list.length; i++) { el[list[i]] = $(list[i]); }
    }

    /* ---------------- avisos ---------------- */

    function toast(msg, kind, ms) {
      if (!el['toasts']) { return; }
      var d = doc.createElement('div');
      d.className = 'toast' + (kind ? ' ' + kind : '');
      d.innerHTML = TV.escapeHtml(msg);
      el['toasts'].appendChild(d);
      setTimeout(function () {
        if (d.parentNode) { d.parentNode.removeChild(d); }
      }, ms || 4200);
    }

    /* ---------------- lista virtualizada ---------------- */

    function rowHeight() {
      return lowEnd ? ROW_H_LEVE : ROW_H;
    }

    function badgeFor(ch) {
      if (ch.kind === 'udp') { return '<span class="badge badge-udp">UDP</span>'; }
      if (ch.kind === 'hls') { return '<span class="badge">HLS</span>'; }
      if (ch.kind === 'test') { return '<span class="badge">TESTE</span>'; }
      if (ch.kind === 'unsupported') { return '<span class="badge badge-bad">SEM SUPORTE</span>'; }
      if (ch.resolution) { return '<span class="badge">' + ch.resolution + 'p</span>'; }
      return '';
    }

    function rowHtml(ch, index) {
      var y = index * rowH;
      var active = ch.id === currentId ? ' active' : '';
      var noLogo = (lowEnd || !TV.parseBool(settings.showLogos, true) || !ch.logo) ? ' row-nologo' : '';
      var meta = TV.escapeHtml(ch.group);
      if (ch.kind === 'unsupported') { meta += ' &middot; protocolo nao suportado'; }
      else if (ch.kind === 'udp') {
        var t = TV.parseUdpTarget(ch.url);
        meta += ' &middot; ' + TV.escapeHtml(t.group + ':' + t.port);
      }
      var logo = ch.logo
        ? '<img class="row-logo" src="' + TV.escapeAttr(ch.logo) + '" alt="" onerror="this.style.visibility=\'hidden\'" />'
        : '<span class="row-logo"></span>';
      return '<div class="row' + active + noLogo + '" data-id="' + TV.escapeAttr(ch.id) +
        '" data-i="' + index + '" style="top:' + y + 'px;height:' + rowH + 'px">' +
        '<span class="row-idx">' + (index + 1) + '</span>' +
        logo +
        '<span class="row-body">' +
        '<span class="row-name">' + TV.escapeHtml(ch.name) + badgeFor(ch) + '</span>' +
        '<span class="row-meta">' + meta + '</span>' +
        '</span>' +
        '<a href="#" class="row-fav" data-fav="' + TV.escapeAttr(ch.id) + '" title="Favorito">' +
        (favourites[ch.id] ? '&#9733;' : '&#9734;') + '</a>' +
        '</div>';
    }

    function renderList(force) {
      if (!el['list']) { return; }
      var inner = el['list-inner'];
      if (!inner) {
        inner = doc.createElement('div');
        inner.id = 'list-inner';
        el['list'].appendChild(inner);
        el['list-inner'] = inner;
      }
      rowH = rowHeight();
      var wrapH = el['list'].clientHeight || 400;
      var total = channels.length;
      inner.style.height = (total * rowH) + 'px';

      var top = el['list'].scrollTop || 0;
      var first = Math.max(0, Math.floor(top / rowH) - 4);
      var visible = Math.ceil(wrapH / rowH) + 8;
      var last = Math.min(total, first + visible);

      var key = total + ':' + first + ':' + last + ':' + currentId + ':' + rowH + ':' + query + ':' + groupFilter;
      if (!force && key === lastRenderKey) { return; }
      lastRenderKey = key;

      var html = [];
      for (var i = first; i < last; i++) { html.push(rowHtml(channels[i], i)); }
      inner.innerHTML = html.join('');

      if (el['list-empty']) {
        el['list-empty'].className = total ? 'empty hidden' : 'empty';
      }
      if (el['count-info']) {
        var txt = total + ' de ' + allChannels.length + ' canais';
        if (groupFilter) { txt += ' &middot; ' + TV.escapeHtml(groupFilter); }
        el['count-info'].innerHTML = txt;
      }
    }

    function applyFilter() {
      channels = TV.filterChannels(allChannels, query, {
        group: groupFilter,
        onlyFavourites: onlyFav,
        onlyPlayable: onlyPlayable,
        favourites: favourites
      });
      renderList(true);
      if (el['list']) { el['list'].scrollTop = 0; }
    }

    function refreshGroups() {
      if (!el['group-filter']) { return; }
      var groups = {};
      for (var i = 0; i < allChannels.length; i++) {
        groups[allChannels[i].group || 'Sem grupo'] = 1;
      }
      var names = TV.keys(groups).sort(function (a, b) {
        var fa = TV.fold(a); var fb = TV.fold(b);
        return fa < fb ? -1 : (fa > fb ? 1 : 0);
      });
      var html = ['<option value="">Todos os grupos (' + allChannels.length + ')</option>'];
      for (var j = 0; j < names.length; j++) {
        html.push('<option value="' + TV.escapeAttr(names[j]) + '">' + TV.escapeHtml(names[j]) + '</option>');
      }
      el['group-filter'].innerHTML = html.join('');
      el['group-filter'].value = groupFilter;
    }

    /* ---------------- canais ---------------- */

    function setChannels(list, label) {
      allChannels = list || [];
      favourites = TV.Store.loadFavourites();
      refreshGroups();
      applyFilter();
      updateStorageInfo();
      if (allChannels.length) {
        toast((label ? label + ': ' : '') + allChannels.length + ' canais carregados.', 'ok', 3000);
      }
      return allChannels.length;
    }

    function byId(id) {
      for (var i = 0; i < allChannels.length; i++) {
        if (allChannels[i].id === id) { return allChannels[i]; }
      }
      return null;
    }

    function indexOfVisible(id) {
      for (var i = 0; i < channels.length; i++) {
        if (channels[i].id === id) { return i; }
      }
      return -1;
    }

    function playChannel(channel, silent) {
      if (!channel) { return false; }
      currentId = channel.id;
      hideOverlay();
      TV.Store.pushHistory(channel, 25);
      if (TV.parseBool(settings.rememberLast, true)) {
        TV.Store.set('last', {
          id: channel.id, name: channel.name, group: channel.group,
          url: channel.url, kind: channel.kind, logo: channel.logo || ''
        });
      }
      if (el['now-name']) { el['now-name'].innerHTML = TV.escapeHtml(channel.name); }
      if (el['now-meta']) { el['now-meta'].innerHTML = TV.escapeHtml(TV.describeChannel(channel)); }
      updateFavButton();
      var idx = indexOfVisible(channel.id);
      if (idx >= 0 && el['list']) {
        var y = idx * rowH;
        var top = el['list'].scrollTop || 0;
        var h = el['list'].clientHeight || 400;
        if (y < top || y + rowH > top + h) { el['list'].scrollTop = Math.max(0, y - h / 2); }
      }
      renderList(true);
      /* o leitor e o ultimo a ser chamado: o aviso de erro tem de ficar por cima */
      if (player) { player.load(channel); }
      if (!silent) { /* manter silencioso quando chamado pelo utilizador */ }
      return true;
    }

    function playDelta(delta) {
      if (!channels.length) { return false; }
      var idx = indexOfVisible(currentId);
      if (idx === -1) { idx = delta > 0 ? -1 : 0; }
      var next = idx + delta;
      if (next < 0) { next = channels.length - 1; }
      if (next >= channels.length) { next = 0; }
      return playChannel(channels[next]);
    }

    function updateFavButton() {
      if (!el['btn-fav']) { return; }
      var on = !!favourites[currentId];
      el['btn-fav'].innerHTML = on ? '&#9733;' : '&#9734;';
      el['btn-fav'].className = 'btn btn-ghost' + (on ? ' btn-on' : '');
    }

    function toggleFav(id) {
      var target = id || currentId;
      if (!target) { return; }
      var on = TV.Store.toggleFavourite(target);
      favourites = TV.Store.loadFavourites();
      updateFavButton();
      renderList(true);
      var ch = byId(target);
      toast((ch ? ch.name : target) + (on ? ' adicionado aos favoritos.' : ' removido dos favoritos.'), '', 2500);
    }

    /* ---------------- overlay / estado ---------------- */

    function showOverlay(title, msg, actions) {
      if (!el['player-overlay']) { return; }
      if (el['overlay-title']) { el['overlay-title'].innerHTML = TV.escapeHtml(title || ''); }
      if (el['overlay-msg']) { el['overlay-msg'].innerHTML = TV.escapeHtml(msg || ''); }
      if (el['btn-retry']) { el['btn-retry'].className = 'btn' + (actions === 'retry' || actions === 'both' ? '' : ' hidden'); }
      if (el['btn-next-err']) { el['btn-next-err'].className = 'btn' + (actions === 'next' || actions === 'both' ? '' : ' hidden'); }
      el['player-overlay'].className = 'overlay';
    }

    function hideOverlay() {
      if (el['player-overlay']) { el['player-overlay'].className = 'overlay hidden'; }
    }

    function stateLabel(s) {
      var map = {
        'parado': 'parado',
        'a-carregar': 'a carregar',
        'a-reproduzir': 'a reproduzir',
        'a-tentar': 'a tentar de novo',
        'pausa': 'pausa',
        'erro': 'ERRO',
        'bloqueado': 'bloqueado pelo browser'
      };
      return map[s] || s;
    }

    function onState(data) {
      var s = data.state || '';
      if (el['st-state']) {
        el['st-state'].innerHTML = stateLabel(s);
        el['st-state'].className = 'st st-state-' + (s.indexOf('erro') >= 0 ? 'erro' : (s.indexOf('carregar') >= 0 || s.indexOf('tentar') >= 0 ? 'carregar' : 'reproduzir'));
      }
      if (s === 'erro') {
        showOverlay('Nao foi possivel reproduzir', data.error || 'Erro desconhecido.', 'both');
      } else if (s === 'bloqueado') {
        showOverlay('Reproducao bloqueada', data.error || 'Prima o botao de reproduzir.', 'retry');
      } else if (s === 'parado' && !player.current()) {
        showOverlay('TVmakina', 'Escolha um canal na lista, ou importe uma lista M3U.', '');
      } else {
        hideOverlay();
      }
      if (el['btn-play']) {
        el['btn-play'].innerHTML = (s === 'a-reproduzir') ? '&#10074;&#10074;' : '&#9654;';
      }
    }

    function onStats(st) {
      if (!st) { return; }
      if (el['st-res']) { el['st-res'].innerHTML = st.resolution || '--'; }
      if (el['st-bitrate']) { el['st-bitrate'].innerHTML = TV.formatBitrate(st.bitrate); }
      if (el['st-buffer']) { el['st-buffer'].innerHTML = 'buffer ' + (st.bufferSec ? st.bufferSec.toFixed(1) + 's' : '--'); }
      if (el['st-dropped']) { el['st-dropped'].innerHTML = 'perdas ' + (st.dropped || 0); }
      if (recorder && recorder.active() && el['st-rec']) {
        el['st-rec'].innerHTML = 'GRAVACAO ' + TV.formatDuration(recorder.elapsed());
      }
    }

    function updateStorageInfo() {
      var bytes = TV.Store.usageBytes();
      if (el['storage-info']) {
        el['storage-info'].innerHTML = 'Guardado: ' + TV.formatBytes(bytes * 2) + ' &middot; ' + TV.Store.backend();
      }
      if (el['set-storage']) { el['set-storage'].innerHTML = TV.formatBytes(bytes * 2); }
      if (el['set-backend']) { el['set-backend'].innerHTML = TV.Store.backend(); }
    }

    /* ---------------- gravacao ---------------- */

    function toggleRecord() {
      if (!recorder) { toast('Gravacao nao suportada neste browser.', 'err'); return; }
      if (recorder.active()) {
        recorderData = recorder.stop();
        if (el['btn-rec']) { el['btn-rec'].className = 'btn btn-ghost'; el['btn-rec'].innerHTML = '&#9679; Gravar'; }
        if (el['st-rec']) { el['st-rec'].className = 'st rec hidden'; }
        if (!recorderData || !recorderData.bytes) { toast('Gravacao vazia.', 'warn'); return; }
        var blob = recorder.toBlob(recorderData);
        if (!blob) { toast('Nao foi possivel criar o ficheiro.', 'err'); return; }
        var ch = player ? player.current() : null;
        var name = 'tvmakina-' + ((ch ? ch.name : 'canal').replace(/[^a-z0-9]+/gi, '-')) + '-' +
          recorderData.seconds + 's.' + (recorderData.mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm');
        try {
          var a = doc.createElement('a');
          a.href = win.URL.createObjectURL(blob);
          a.download = name;
          doc.body.appendChild(a);
          a.click();
          doc.body.removeChild(a);
          toast('Gravacao guardada: ' + name + ' (' + TV.formatBytes(recorderData.bytes) + ')', 'ok', 6000);
        } catch (e) {
          toast('O browser bloqueou a gravacao do ficheiro.', 'err');
        }
        return;
      }
      var video = player ? player.video() : null;
      var stream = null;
      if (video && video.srcObject) { stream = video.srcObject; }
      else if (video && video.mozCaptureStream) { try { stream = video.mozCaptureStream(); } catch (e2) { stream = null; } }
      else if (video && video.captureStream) { try { stream = video.captureStream(); } catch (e3) { stream = null; } }
      if (!stream) { toast('Este browser nao permite capturar o video para gravar.', 'err'); return; }
      var res = recorder.start(stream, settings.recordFormat);
      if (!res.ok) { toast(res.error, 'err'); return; }
      if (el['btn-rec']) { el['btn-rec'].className = 'btn btn-ghost rec-on'; el['btn-rec'].innerHTML = '&#9632; Parar'; }
      if (el['st-rec']) { el['st-rec'].className = 'st rec'; el['st-rec'].innerHTML = 'GRAVACAO 00:00'; }
      toast('A gravar (' + res.mime + ')', 'ok', 3000);
    }

    /* ---------------- temporizador de sono ---------------- */

    function setSleep(minutes) {
      if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
      sleepUntil = 0;
      if (minutes > 0) {
        sleepUntil = TV.now() + minutes * 60000;
        sleepTimer = setTimeout(function () {
          if (player) { player.stop(); }
          toast('Temporizador: reproducao parada.', 'warn', 5000);
          if (el['sleep-state']) { el['sleep-state'].innerHTML = 'Terminado: reproducao parada.'; }
        }, minutes * 60000);
        if (el['sleep-state']) { el['sleep-state'].innerHTML = 'Para dentro de ' + minutes + ' minutos.'; }
        toast('Temporizador: ' + minutes + ' minutos.', 'ok', 2500);
      } else {
        if (el['sleep-state']) { el['sleep-state'].innerHTML = 'Desligado.'; }
      }
    }

    /* ---------------- definicoes ---------------- */

    function fillSettingsForm() {
      if (el['set-lowend']) { el['set-lowend'].checked = lowEnd; }
      if (el['set-hwaccel']) { el['set-hwaccel'].checked = !!settings.hwAccel; }
      if (el['set-buffer']) { el['set-buffer'].value = settings.maxBufferSec; }
      if (el['set-bitrate']) { el['set-bitrate'].value = settings.maxBitrate || 0; }
      if (el['set-autonext']) { el['set-autonext'].checked = TV.parseBool(settings.autoNext, true); }
      if (el['set-retry']) { el['set-retry'].value = settings.retryTimes; }
      if (el['set-proxy']) { el['set-proxy'].value = settings.proxy || ''; }
      if (el['set-logos']) { el['set-logos'].checked = !!settings.showLogos; }
      if (el['set-theme']) { el['set-theme'].value = settings.theme || 'escuro'; }
      if (el['set-remember']) { el['set-remember'].checked = !!settings.rememberLast; }
      if (el['set-recformat']) { el['set-recformat'].value = settings.recordFormat || 'webm'; }
      if (el['quality']) { el['quality'].value = String(settings.maxBitrate || 0); }
      if (el['aspect']) { el['aspect'].value = settings.aspect || 'contain'; }
      if (el['volume']) { el['volume'].value = settings.volume; }
      if (el['vol-label']) { el['vol-label'].innerHTML = settings.volume + '%'; }
      updateStorageInfo();
    }

    function readSettingsForm() {
      if (el['set-hwaccel']) { settings.hwAccel = el['set-hwaccel'].checked; }
      if (el['set-buffer']) { settings.maxBufferSec = TV.parseIntSafe(el['set-buffer'].value, 12); }
      if (el['set-bitrate']) { settings.maxBitrate = TV.parseIntSafe(el['set-bitrate'].value, 0); }
      if (el['set-autonext']) { settings.autoNext = el['set-autonext'].checked; }
      if (el['set-retry']) { settings.retryTimes = TV.parseIntSafe(el['set-retry'].value, 2); }
      if (el['set-proxy']) { settings.proxy = TV.trim(el['set-proxy'].value); }
      if (el['set-logos']) { settings.showLogos = el['set-logos'].checked; }
      if (el['set-theme']) { settings.theme = el['set-theme'].value; }
      if (el['set-remember']) { settings.rememberLast = el['set-remember'].checked; }
      if (el['set-recformat']) { settings.recordFormat = el['set-recformat'].value; }
      TV.Store.saveSettings(settings);
      applyTheme();
      if (player) {
        player.setVolume(settings.volume);
        player.setMuted(settings.muted);
        player.setAspect(settings.aspect);
        player.setMaxBitrate(settings.maxBitrate || 0);
      }
      renderList(true);
      updateStorageInfo();
    }

    function applyTheme() {
      var theme = settings.theme || 'escuro';
      var cls = (doc.documentElement.className || '').replace(/\s*alto-contraste/g, '');
      if (theme === 'alto-contraste') { cls += ' alto-contraste'; }
      doc.documentElement.className = TV.trim(cls);
      TV.applyLowEndTweaks(doc, lowEnd);
    }

    function setLowEnd(on, announce) {
      lowEnd = !!on;
      settings.lowEnd = lowEnd;
      TV.Store.saveSettings(settings);
      TV.applyLowEndTweaks(doc, lowEnd);
      if (el['btn-lowend']) { el['btn-lowend'].className = 'btn btn-ghost' + (lowEnd ? ' btn-on' : ''); }
      if (el['set-lowend']) { el['set-lowend'].checked = lowEnd; }
      rowH = rowHeight();
      renderList(true);
      if (announce) {
        toast(lowEnd
          ? 'Modo leve ligado: buffer curto, sem logotipos, limite de 720p.'
          : 'Modo leve desligado.', lowEnd ? 'ok' : '', 4000);
      }
    }

    /* ---------------- importacao ---------------- */

    function importText(text, label) {
      var res = TV.parsePlaylist(text, label);
      if (!res.channels.length) {
        setImportStatus('Nao encontrei canais: ' + (res.warnings.join(' ') || 'formato desconhecido.'), 'err');
        toast('A lista nao tem canais.', 'err');
        return 0;
      }
      var n = setChannels(res.channels, label || 'Lista');
      TV.Store.savePlaylist(label || 'Lista importada', res.channels, { origin: label || '' });
      setImportStatus(n + ' canais importados (' + res.format + ').', 'ok');
      renderSavedLists();
      var bad = 0;
      for (var i = 0; i < res.channels.length; i++) {
        if (res.channels[i].kind === 'unsupported') { bad++; }
      }
      if (bad) { toast(bad + ' canais usam RTSP/RTMP/MMS e nao tocam no browser.', 'warn', 6000); }
      return n;
    }

    function setImportStatus(msg, kind) {
      if (el['imp-status']) {
        el['imp-status'].className = 'imp-status' + (kind ? ' ' + kind : '');
        el['imp-status'].innerHTML = TV.escapeHtml(msg);
      }
    }

    function loadFromUrl(url) {
      setImportStatus('A descarregar ' + url + ' ...', '');
      TV.getText(url, 20000, function (err, text) {
        if (err) {
          setImportStatus('Falhou: ' + err.message + '. Se a lista estiver em http:// e a pagina em https://, o browser bloqueia (mixed content).', 'err');
          toast('Nao consegui descarregar a lista.', 'err');
          return;
        }
        importText(text, url.replace(/^.*\//, '') || 'URL');
      });
    }

    function renderSamples() {
      if (!el['imp-samples']) { return; }
      var html = [];
      for (var i = 0; i < samples.length; i++) {
        html.push('<button type="button" class="btn sample" data-src="' + TV.escapeAttr(samples[i].src) +
          '" data-label="' + TV.escapeAttr(samples[i].label) + '">' + TV.escapeHtml(samples[i].label) + '</button>');
      }
      html.push('<button type="button" class="btn sample-test" data-pattern="smpte">Sinal de teste SMPTE</button>');
      html.push('<button type="button" class="btn sample-test" data-pattern="barras">Barras de cor</button>');
      html.push('<button type="button" class="btn sample-test" data-pattern="ruido">Ruido</button>');
      html.push('<button type="button" class="btn sample-test" data-pattern="relogio">Relogio</button>');
      el['imp-samples'].innerHTML = html.join('');
    }

    function renderSavedLists() {
      if (!el['imp-saved']) { return; }
      var lists = TV.Store.loadPlaylists();
      if (!lists.length) { el['imp-saved'].innerHTML = '<span class="tiny">Ainda nao ha listas guardadas.</span>'; return; }
      var html = [];
      for (var i = 0; i < lists.length; i++) {
        html.push('<button type="button" class="btn saved" data-name="' + TV.escapeAttr(lists[i].name) + '">' +
          TV.escapeHtml(lists[i].name) + ' (' + lists[i].count + ')</button>');
        html.push('<button type="button" class="btn btn-ghost saved-del" data-name="' + TV.escapeAttr(lists[i].name) +
          '" title="Apagar lista">x</button>');
      }
      el['imp-saved'].innerHTML = html.join('');
    }

    function openModal(id) {
      var m = $(id);
      if (m) { m.className = 'modal'; }
      if (id === 'modal-settings') { fillSettingsForm(); }
      if (id === 'modal-import') { renderSavedLists(); }
    }

    function closeModal(id) {
      var m = $(id);
      if (m) { m.className = 'modal hidden'; }
    }

    /* ---------------- proxy ---------------- */

    function probeProxy() {
      if (!el['btn-proxy']) { return; }
      var base = settings.proxy || '127.0.0.1:4022';
      el['btn-proxy'].innerHTML = 'Proxy: a testar';
      TV.probeProxy(base, function (ok, detail) {
        el['btn-proxy'].innerHTML = 'Proxy: ' + (ok ? 'ligado' : 'desligado');
        el['btn-proxy'].className = 'btn btn-ghost' + (ok ? ' btn-on' : '');
        el['btn-proxy'].title = base + ' - ' + detail;
        if (el['set-proxy-result']) {
          el['set-proxy-result'].innerHTML = ok
            ? 'OK: ' + TV.escapeHtml(base + ' respondeu ' + detail)
            : 'Sem resposta de ' + TV.escapeHtml(base) + '. Ligue o proxy: <code>node server/proxy.js</code>';
        }
      });
    }

    /* ---------------- atalhos ---------------- */

    function fullscreen() {
      var d = doc;
      var target = el['player-wrap'] || d.documentElement;
      var on = d.fullscreenElement || d.webkitFullscreenElement || d.msFullscreenElement;
      if (on) {
        if (d.exitFullscreen) { d.exitFullscreen(); }
        else if (d.webkitExitFullscreen) { d.webkitExitFullscreen(); }
        else if (d.msExitFullscreen) { d.msExitFullscreen(); }
      } else {
        if (target.requestFullscreen) { target.requestFullscreen(); }
        else if (target.webkitRequestFullscreen) { target.webkitRequestFullscreen(); }
        else if (target.msRequestFullscreen) { target.msRequestFullscreen(); }
        else {
          var cls = (doc.documentElement.className || '');
          doc.documentElement.className = cls.indexOf('ecra-inteiro') >= 0
            ? cls.replace(/\s*ecra-inteiro/g, '') : cls + ' ecra-inteiro';
          renderList(true);
        }
      }
    }

    function tryPip() {
      var video = player ? player.video() : null;
      if (!video) { return; }
      if (video.requestPictureInPicture) {
        var p = video.requestPictureInPicture();
        if (p && p['catch']) { p['catch'](function () { toast('Janela flutuante bloqueada.', 'warn'); }); }
      } else if (video.webkitSetPresentationMode) {
        video.webkitSetPresentationMode('picture-in-picture');
      } else {
        toast('Este browser nao tem janela flutuante (PiP).', 'warn');
      }
    }

    function onKey(e) {
      var t = e.target || {};
      var tag = t.tagName ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.keyCode === 27) { t.blur(); }
        return;
      }
      var k = e.keyCode;
      if (k >= 48 && k <= 57) {                    /* 0-9: sintonizar por numero */
        numberBuffer += String(k - 48);
        if (numberTimer) { clearTimeout(numberTimer); }
        numberTimer = setTimeout(function () { tuneNumber(numberBuffer); numberBuffer = ''; }, 900);
        if (el['now-meta']) { el['now-meta'].innerHTML = 'Canal numero ' + numberBuffer + '...'; }
        return;
      }
      switch (k) {
        case 33: playDelta(-1); break;             /* PageUp */
        case 34: playDelta(1); break;              /* PageDown */
        case 38: changeVolume(5); break;           /* cima */
        case 40: changeVolume(-5); break;          /* baixo */
        case 77: toggleMute(); break;              /* M */
        case 70: toggleFav(); break;               /* F */
        case 82: toggleRecord(); break;            /* R */
        case 73: showChannelInfo(); break;         /* I */
        case 191: case 111:                        /* / */
          if (el['search']) { el['search'].focus(); el['search'].select(); }
          break;
        case 32:                                   /* espaco */
          if (player) {
            if (player.state() === 'a-reproduzir') { player.pause(); } else { player.resume(); }
          }
          break;
        case 27:                                   /* Esc */
          closeModal('modal-import'); closeModal('modal-settings'); closeModal('modal-sleep');
          break;
        default: return;
      }
      if (e.preventDefault) { e.preventDefault(); }
    }

    function tuneNumber(str) {
      var n = parseInt(str, 10);
      if (isNaN(n) || n < 1) { return; }
      var ch = channels[n - 1];
      if (!ch) { toast('Nao existe o canal ' + n + ' na lista actual.', 'warn'); return; }
      playChannel(ch);
    }

    function setVolumeAbs(value) {
      settings.volume = TV.clamp(TV.parseIntSafe(value, settings.volume), 0, 100);
      if (el['volume']) { el['volume'].value = settings.volume; }
      if (el['vol-label']) { el['vol-label'].innerHTML = settings.volume + '%'; }
      if (player) { player.setVolume(settings.volume); }
      if (settings.muted && settings.volume > 0) { settings.muted = false; if (player) { player.setMuted(false); } }
      TV.Store.saveSettings(settings);
    }

    function changeVolume(delta) {
      settings.volume = TV.clamp(settings.volume + delta, 0, 100);
      if (el['volume']) { el['volume'].value = settings.volume; }
      if (el['vol-label']) { el['vol-label'].innerHTML = settings.volume + '%'; }
      if (player) { player.setVolume(settings.volume); }
      if (settings.muted && settings.volume > 0) { toggleMute(); }
      TV.Store.saveSettings(settings);
    }

    function toggleMute() {
      settings.muted = !settings.muted;
      if (player) { player.setMuted(settings.muted); }
      if (el['btn-mute']) { el['btn-mute'].innerHTML = settings.muted ? '&#128263;' : '&#128266;'; }
      TV.Store.saveSettings(settings);
    }

    function showChannelInfo() {
      var ch = player ? player.current() : null;
      if (!ch) { toast('Nenhum canal activo.', 'warn'); return; }
      var st = player.stats();
      var msg = 'Grupo: ' + ch.group + '\nTipo: ' + (ch.kind || '?') +
        '\nEndereco: ' + TV.buildStreamUrl(ch, settings) +
        '\nResolucao: ' + (st.resolution || '--') + '  Debito: ' + TV.formatBitrate(st.bitrate) +
        '\nBuffer: ' + (st.bufferSec ? st.bufferSec.toFixed(1) + 's' : '--') +
        '\nModo leve: ' + (lowEnd ? 'ligado' : 'desligado') +
        '\nMotor HLS: ' + (TV.hlsAvailable() ? 'disponivel' : 'indisponivel');
      if (win.alert) { win.alert(msg); } else { toast(msg.replace(/\n/g, ' | '), '', 9000); }
    }

    /* ---------------- ligacao de eventos ---------------- */

    function on(id, evt, fn) {
      if (el[id] && el[id].addEventListener) { el[id].addEventListener(evt, fn, false); }
    }

    function bind() {
      on('search', 'keyup', TV.debounce(function () {
        query = el['search'].value;
        applyFilter();
      }, 180));
      on('group-filter', 'change', function () { groupFilter = el['group-filter'].value; applyFilter(); });
      on('only-fav', 'change', function () { onlyFav = el['only-fav'].checked; applyFilter(); });
      on('only-playable', 'change', function () { onlyPlayable = el['only-playable'].checked; applyFilter(); });
      on('link-fav', 'click', function (e) {
        if (e.preventDefault) { e.preventDefault(); }
        el['only-fav'].checked = true; onlyFav = true; applyFilter();
      });
      on('link-history', 'click', function (e) {
        if (e.preventDefault) { e.preventDefault(); }
        var h = TV.Store.loadHistory();
        if (!h.length) { toast('Ainda nao ha canais vistos.', 'warn'); return; }
        var list = [];
        for (var i = 0; i < h.length; i++) {
          list.push({
            id: h[i].id + '-hist' + i, name: h[i].name, group: 'Recentes', logo: h[i].logo || '',
            url: (byId(h[i].id) || {}).url || '', kind: (byId(h[i].id) || {}).kind || 'unknown'
          });
        }
        allChannels = list;
        refreshGroups();
        applyFilter();
        toast('A mostrar ' + list.length + ' canais recentes (a lista principal volta a carregar ao importar).', '', 5000);
      });

      if (el['list']) {
        el['list'].addEventListener('scroll', TV.throttle(function () { renderList(false); }, 90), false);
        el['list'].addEventListener('click', function (e) {
          var node = e.target;
          while (node && node !== el['list'] && !node.getAttribute) { node = node.parentNode; }
          if (!node || node === el['list']) { return; }
          var favId = node.getAttribute ? node.getAttribute('data-fav') : null;
          if (favId) {
            if (e.preventDefault) { e.preventDefault(); }
            toggleFav(favId);
            return;
          }
          var row = node;
          while (row && row !== el['list'] && !(row.className && String(row.className).indexOf('row') >= 0 && row.getAttribute('data-id'))) {
            row = row.parentNode;
          }
          if (row && row !== el['list']) {
            var ch = byId(row.getAttribute('data-id'));
            if (ch) { playChannel(ch); }
          }
        }, false);
      }

      on('btn-prev', 'click', function () { playDelta(-1); });
      on('btn-next', 'click', function () { playDelta(1); });
      on('btn-play', 'click', function () {
        if (!player) { return; }
        if (player.state() === 'a-reproduzir') { player.pause(); } else { player.resume(); }
      });
      on('btn-mute', 'click', toggleMute);
      on('volume', 'change', function () { setVolumeAbs(el['volume'].value); });
      on('volume', 'input', function () {
        if (el['vol-label']) { el['vol-label'].innerHTML = el['volume'].value + '%'; }
      });
      on('quality', 'change', function () {
        settings.maxBitrate = parseInt(el['quality'].value, 10) || 0;
        if (el['set-bitrate']) { el['set-bitrate'].value = settings.maxBitrate; }
        TV.Store.saveSettings(settings);
        if (player) { player.setMaxBitrate(settings.maxBitrate); }
        toast(settings.maxBitrate ? 'Limite de qualidade: ' + TV.formatBitrate(settings.maxBitrate) : 'Qualidade automatica.', '', 2500);
      });
      on('aspect', 'change', function () {
        settings.aspect = el['aspect'].value;
        TV.Store.saveSettings(settings);
        if (player) { player.setAspect(settings.aspect); }
      });
      on('btn-full', 'click', fullscreen);
      on('btn-pip', 'click', tryPip);
      on('btn-fav', 'click', function () { toggleFav(); });
      on('btn-rec', 'click', toggleRecord);
      on('btn-sleep', 'click', function () { openModal('modal-sleep'); });
      on('btn-retry', 'click', function () {
        var ch = player ? player.current() : null;
        if (ch) { player.load(ch); }
      });
      on('btn-next-err', 'click', function () { playDelta(1); });

      on('btn-settings', 'click', function () { openModal('modal-settings'); });
      on('btn-import', 'click', function () { openModal('modal-import'); });
      on('btn-empty-import', 'click', function () { openModal('modal-import'); });
      on('btn-empty-test', 'click', function () { startTest('smpte'); });
      on('btn-proxy', 'click', probeProxy);
      on('btn-lowend', 'click', function () { setLowEnd(!lowEnd, true); });
      on('btn-perf', 'click', showPerf);

      on('imp-url-go', 'click', function () {
        var u = TV.trim(el['imp-url'].value);
        if (!u) { setImportStatus('Escreva um endereco.', 'err'); return; }
        loadFromUrl(u);
      });
      on('imp-text-go', 'click', function () {
        importText(el['imp-text'].value, 'Texto colado');
      });
      on('imp-file', 'change', function () {
        var f = el['imp-file'].files && el['imp-file'].files[0];
        if (!f) { return; }
        TV.readTextFile(f, function (err, text) {
          if (err) { setImportStatus(err.message, 'err'); return; }
          importText(text, f.name);
        });
      });
      if (el['imp-samples']) {
        el['imp-samples'].addEventListener('click', function (e) {
          var node = e.target;
          if (!node || !node.getAttribute) { return; }
          var src = node.getAttribute('data-src');
          var pattern = node.getAttribute('data-pattern');
          if (src) { loadFromUrl(src); }
          else if (pattern) { startTest(pattern); closeModal('modal-import'); }
        }, false);
      }
      if (el['imp-saved']) {
        el['imp-saved'].addEventListener('click', function (e) {
          var node = e.target;
          if (!node || !node.getAttribute) { return; }
          var name = node.getAttribute('data-name');
          if (!name) { return; }
          var isDel = String(node.className).indexOf('saved-del') >= 0;
          if (isDel) {
            TV.Store.deletePlaylist(name);
            renderSavedLists();
            toast('Lista "' + name + '" apagada.', '', 2500);
            return;
          }
          var lists = TV.Store.loadPlaylists();
          for (var i = 0; i < lists.length; i++) {
            if (lists[i].name === name) { setChannels(lists[i].channels, name); return; }
          }
        }, false);
      }

      on('set-proxy-test', 'click', probeProxy);
      on('set-export', 'click', exportData);
      on('set-reset', 'click', function () {
        if (win.confirm && !win.confirm('Apagar listas, favoritos e definicoes guardadas?')) { return; }
        TV.Store.clearAll();
        settings = TV.Store.loadSettings();
        favourites = {};
        allChannels = [];
        applyFilter();
        fillSettingsForm();
        toast('Dados apagados.', 'ok');
      });

      var closes = doc.querySelectorAll ? doc.querySelectorAll('[data-close]') : [];
      for (var i = 0; i < closes.length; i++) {
        (function (btn) {
          btn.addEventListener('click', function () { closeModal(btn.getAttribute('data-close')); }, false);
        })(closes[i]);
      }

      var sleepBtns = doc.querySelectorAll ? doc.querySelectorAll('.sleep-opt') : [];
      for (var j = 0; j < sleepBtns.length; j++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            setSleep(parseInt(btn.getAttribute('data-min'), 10) || 0);
          }, false);
        })(sleepBtns[j]);
      }

      if (doc.addEventListener) {
        doc.addEventListener('keydown', onKey, false);
      } else if (doc.attachEvent) {
        doc.attachEvent('onkeydown', onKey);
      }
    }

    function exportData() {
      var data = {
        app: 'TVmakina',
        version: TV.VERSION,
        exportedAt: new Date().toString(),
        favourites: favourites,
        settings: settings,
        playlists: TV.Store.loadPlaylists(),
        history: TV.Store.loadHistory()
      };
      var text = '';
      try { text = JSON.stringify(data, null, 2); } catch (e) { toast('Falha ao exportar.', 'err'); return; }
      try {
        var blob = new win.Blob([text], { type: 'application/json' });
        var a = doc.createElement('a');
        a.href = win.URL.createObjectURL(blob);
        a.download = 'tvmakina-dados.json';
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        toast('Dados exportados.', 'ok');
      } catch (e2) {
        toast('Este browser nao permite exportar ficheiros.', 'err');
      }
    }

    function showPerf() {
      var mem = '';
      try {
        if (win.performance && win.performance.memory) {
          mem = ' | JS ' + Math.round(win.performance.memory.usedJSHeapSize / 1048576) + ' MB de ' +
            Math.round(win.performance.memory.jsHeapSizeLimit / 1048576) + ' MB';
        }
      } catch (e) { mem = ''; }
      toast(fps + ' fps na lista | ' + channels.length + ' linhas visiveis de ' + channels.length +
        ' canais | motor HLS: ' + (TV.hlsAvailable() ? 'sim' : 'nao') + mem, '', 6000);
    }

    function startTest(pattern) {
      playChannel({
        id: 'test-' + pattern,
        name: 'Sinal de teste (' + pattern + ')',
        group: 'Testes',
        url: 'test:' + pattern,
        kind: 'test',
        logo: ''
      });
    }

    /* ---------------- ciclo de vida ---------------- */

    function clockTick() {
      var d = new Date();
      var p = function (x) { return (x < 10 ? '0' : '') + x; };
      if (el['st-clock']) { el['st-clock'].innerHTML = p(d.getHours()) + ':' + p(d.getMinutes()); }
    }

    function fpsLoop() {
      frames++;
      if (win.requestAnimationFrame) { win.requestAnimationFrame(fpsLoop); }
      else { setTimeout(fpsLoop, 50); }
    }

    function init(playerInstance) {
      player = playerInstance;
      ids(['toasts', 'list', 'list-empty', 'count-info', 'search', 'group-filter', 'only-fav', 'only-playable',
        'link-fav', 'link-history', 'storage-info', 'video', 'test-canvas', 'player-overlay', 'overlay-title',
        'overlay-msg', 'btn-retry', 'btn-next-err', 'now-name', 'now-meta', 'btn-fav', 'btn-rec', 'btn-sleep',
        'btn-prev', 'btn-play', 'btn-next', 'btn-mute', 'volume', 'vol-label', 'quality', 'aspect', 'btn-pip',
        'btn-full', 'st-state', 'st-res', 'st-bitrate', 'st-buffer', 'st-dropped', 'st-src', 'st-rec', 'st-clock',
        'btn-settings', 'btn-import', 'btn-empty-import', 'btn-empty-test', 'btn-proxy', 'btn-lowend', 'btn-perf',
        'machine-info', 'imp-url', 'imp-url-go', 'imp-file', 'imp-text', 'imp-text-go', 'imp-samples', 'imp-saved',
        'imp-status', 'set-lowend', 'set-hwaccel', 'set-buffer', 'set-bitrate', 'set-autonext', 'set-retry',
        'set-proxy', 'set-proxy-test', 'set-proxy-result', 'set-logos', 'set-theme', 'set-remember',
        'set-recformat', 'set-export', 'set-reset', 'set-storage', 'set-backend', 'sleep-state', 'player-wrap',
        'brand-sub']);

      settings = TV.Store.loadSettings();
      favourites = TV.Store.loadFavourites();
      info = TV.detectLowEnd();
      lowEnd = (settings.lowEnd === null || settings.lowEnd === undefined) ? info.lowEnd : !!settings.lowEnd;
      if (lowEnd) { settings = TV.lowEndSettings(settings); }
      rowH = rowHeight();

      applyTheme();
      if (el['btn-lowend']) { el['btn-lowend'].className = 'btn btn-ghost' + (lowEnd ? ' btn-on' : ''); }
      if (el['machine-info']) {
        el['machine-info'].innerHTML = TV.escapeHtml(TV.describeMachine(info)) +
          (lowEnd ? ' · modo leve' : '');
        el['machine-info'].title = info.reasons.length ? info.reasons.join('; ') : 'maquina com recursos suficientes';
      }
      if (el['st-src']) {
        el['st-src'].innerHTML = 'HLS: ' + (TV.hlsAvailable() ? 'sim' : 'nao') +
          ' · MSE: ' + (TV.mseSupported() ? 'sim' : 'nao');
      }

      bind();
      renderSamples();
      renderSavedLists();
      applyFilter();
      fillSettingsForm();
      updateStorageInfo();

      if (player) {
        player.setVolume(settings.volume);
        player.setMuted(settings.muted);
        player.setAspect(settings.aspect);
      }

      clockTick();
      setInterval(clockTick, 15000);
      setInterval(function () {
        fps = frames; frames = 0;
        if (el['btn-perf']) { el['btn-perf'].innerHTML = fps + ' fps'; }
      }, 1000);
      if (win.requestAnimationFrame) { win.requestAnimationFrame(fpsLoop); }

      probeProxy();
      showOverlay('TVmakina', 'Escolha um canal na lista, ou importe uma lista M3U.', '');

      var last = TV.Store.get('last', null);
      return { lowEnd: lowEnd, info: info, lastChannel: last };
    }

    function onLoading(data) {
      if (el['st-src']) {
        el['st-src'].innerHTML = 'fonte: ' + TV.escapeHtml(String(data.url || '').replace(/^https?:\/\//, '').substring(0, 46));
      }
    }

    return {
      init: init,
      onState: onState,
      onStats: onStats,
      onLoading: onLoading,
      setPlayer: function (p) {
        player = p;
        if (player) {
          player.setVolume(settings.volume);
          player.setMuted(settings.muted);
          player.setAspect(settings.aspect);
        }
      },
      setVolumeAbs: setVolumeAbs,
      showChannelInfo: showChannelInfo,
      setChannels: setChannels,
      playChannel: playChannel,
      playDelta: playDelta,
      toast: toast,
      startTest: startTest,
      setLowEnd: setLowEnd,
      probeProxy: probeProxy,
      renderList: renderList,
      applyFilter: applyFilter,
      settings: function () { return settings; },
      channels: function () { return channels; },
      allChannels: function () { return allChannels; },
      state: {
        get currentId() { return currentId; },
        get query() { return query; },
        get group() { return groupFilter; }
      }
    };
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = TV; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
