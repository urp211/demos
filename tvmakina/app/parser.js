/* TVmakina - analisador de listas (M3U / M3U8 / XSPF / JSON / texto simples)
 * ES5 puro. Corre no browser e em Node (testes).
 */
(function (root) {
  'use strict';

  var TV = root.TVmakina || (root.TVmakina = {});
  var trim = TV.trim;
  var has = TV.has;

  function readAttr(attrs, name) {
    var re = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i');
    var m = re.exec(attrs);
    if (m) { return m[1]; }
    var re2 = new RegExp(name + "\\s*=\\s*'([^']*)'", 'i');
    var m2 = re2.exec(attrs);
    return m2 ? m2[1] : '';
  }

  function cleanName(name) {
    var n = trim(name);
    /* remove sufixos tecnicos comuns das listas publicas: "(720p) [Not 24/7]" */
    n = n.replace(/\s*\[[^\]]*\]\s*$/g, '');
    return trim(n);
  }

  function readResolution(name) {
    var m = /\((\d{3,4})p\)/.exec(name || '');
    return m ? parseInt(m[1], 10) : 0;
  }

  function baseChannel(extra) {
    var ch = {
      id: '',
      name: '',
      group: 'Sem grupo',
      logo: '',
      url: '',
      tvgId: '',
      epgUrl: '',
      kind: 'unknown',
      httpReferer: '',
      userAgent: '',
      resolution: 0,
      quality: '',
      favourite: false,
      source: ''
    };
    return TV.assign(ch, extra || {});
  }

  /* ---------------- M3U / M3U8 ---------------- */

  TV.parseM3U = function (text, source) {
    var lines = String(text === null || text === undefined ? '' : text).split(/\r\n|\r|\n/);
    var out = [];
    var warnings = [];
    var current = null;
    var lastOpts = null;
    var n = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = trim(lines[i]);
      if (!line) { continue; }

      if (/^#EXTINF/i.test(line)) {
        var m = /^#EXTINF\s*:?\s*(-?\d+)\s*(.*?)\s*,\s*(.*)$/i.exec(line);
        var attrs = m ? m[2] : '';
        var name = m ? m[3] : line.replace(/^#EXTINF\s*:?\s*-?\d*\s*,?\s*/i, '');
        var group = readAttr(attrs, 'group-title');
        current = baseChannel({
          name: cleanName(name) || ('Canal ' + (out.length + 1)),
          group: trim(group) || 'Sem grupo',
          logo: readAttr(attrs, 'tvg-logo'),
          tvgId: readAttr(attrs, 'tvg-id'),
          epgUrl: readAttr(attrs, 'tvg-url') || readAttr(attrs, 'url-tvg'),
          quality: trim(readAttr(attrs, 'tvg-rec')),
          resolution: readResolution(name),
          source: source || ''
        });
        lastOpts = null;
        continue;
      }

      if (/^#EXTVLCOPT/i.test(line) || /^#KODIPROP/i.test(line)) {
        var opt = line.split(':').slice(1).join(':');
        var eq = opt.indexOf('=');
        if (eq > 0) {
          var key = trim(opt.substring(0, eq)).toLowerCase();
          var val = trim(opt.substring(eq + 1));
          if (!lastOpts) { lastOpts = {}; }
          lastOpts[key] = val;
          if (current) {
            if (key === 'http-referrer' || key === 'http-referer') { current.httpReferer = val; }
            if (key === 'http-user-agent') { current.userAgent = val; }
          }
        }
        continue;
      }

      if (line.charAt(0) === '#') { continue; }

      /* linha de URL */
      var url = line;
      if (!current) {
        current = baseChannel({
          name: url.replace(/^.*\//, '').substring(0, 48) || ('Canal ' + (out.length + 1)),
          source: source || ''
        });
      }
      current.url = url;
      current.kind = TV.detectStreamType(url);
      if (!current.id) {
        n += 1;
        current.id = (current.tvgId || 'ch') + '-' + n;
      }
      out.push(current);
      current = null;
      lastOpts = null;
    }

    if (!out.length && trim(text)) {
      warnings.push('A lista foi lida mas nao continha nenhum canal com endereco.');
    }
    return { channels: out, warnings: warnings, format: 'm3u' };
  };

  /* ---------------- XSPF (VLC) ---------------- */

  function xmlText(block, tag) {
    var re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i');
    var m = re.exec(block);
    if (!m) { return ''; }
    return trim(m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"));
  }

  TV.parseXSPF = function (text, source) {
    var out = [];
    var warnings = [];
    var re = /<track(?:\s[^>]*)?>([\s\S]*?)<\/track>/gi;
    var m;
    var n = 0;
    while ((m = re.exec(text)) !== null) {
      var block = m[1];
      var url = xmlText(block, 'location');
      if (!url) { continue; }
      n += 1;
      var name = xmlText(block, 'title') || ('Canal ' + n);
      out.push(baseChannel({
        id: 'xspf-' + n,
        name: cleanName(name),
        group: xmlText(block, 'album') || 'Sem grupo',
        logo: xmlText(block, 'image'),
        url: url,
        kind: TV.detectStreamType(url),
        source: source || ''
      }));
    }
    if (!out.length) { warnings.push('XSPF sem faixas com <location>.'); }
    return { channels: out, warnings: warnings, format: 'xspf' };
  };

  /* ---------------- JSON ---------------- */

  TV.parseJSONList = function (text, source) {
    var warnings = [];
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { channels: [], warnings: ['JSON invalido: ' + e.message], format: 'json' };
    }
    var arr = data;
    if (data && typeof data === 'object' && !(data instanceof Array)) {
      arr = data.channels || data.items || data.list || [];
    }
    if (!(arr instanceof Array)) {
      return { channels: [], warnings: ['JSON sem lista de canais.'], format: 'json' };
    }
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i] || {};
      var url = it.url || it.stream || it.src || '';
      if (!url) { continue; }
      out.push(baseChannel({
        id: it.id || ('json-' + (i + 1)),
        name: cleanName(it.name || it.title || it.label || ('Canal ' + (i + 1))),
        group: it.group || it.category || it.groupTitle || 'Sem grupo',
        logo: it.logo || it.icon || '',
        url: url,
        kind: TV.detectStreamType(url),
        source: source || ''
      }));
    }
    return { channels: out, warnings: warnings, format: 'json' };
  };

  /* ---------------- texto simples (um URL por linha) ---------------- */

  TV.parsePlainList = function (text, source) {
    var lines = String(text).split(/\r\n|\r|\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var url = trim(lines[i]);
      if (!url || url.charAt(0) === '#') { continue; }
      if (!/:\/\//.test(url) && !/^udp/i.test(url)) { continue; }
      out.push(baseChannel({
        id: 'txt-' + (out.length + 1),
        name: url.replace(/^.*\//, '').substring(0, 48) || ('Canal ' + (out.length + 1)),
        url: url,
        kind: TV.detectStreamType(url),
        source: source || ''
      }));
    }
    return { channels: out, warnings: [], format: 'texto' };
  };

  /* ---------------- deteccao automatica ---------------- */

  TV.detectPlaylistFormat = function (text) {
    var head = String(text).substring(0, 4096);
    if (/^\s*<\?xml/i.test(head) || /<playlist/i.test(head)) {
      if (/<track/i.test(head)) { return 'xspf'; }
      return 'xml';
    }
    if (/^\s*\{/.test(head) || /^\s*\[/.test(head)) { return 'json'; }
    if (/^#EXTM3U/i.test(head) || /^#EXTINF/i.test(head)) { return 'm3u'; }
    return 'texto';
  };

  TV.parsePlaylist = function (text, source) {
    var format = TV.detectPlaylistFormat(text);
    var res;
    if (format === 'xspf') { res = TV.parseXSPF(text, source); }
    else if (format === 'json') { res = TV.parseJSONList(text, source); }
    else if (format === 'm3u') { res = TV.parseM3U(text, source); }
    else {
      res = TV.parsePlainList(text, source);
      if (!res.channels.length && trim(text)) {
        res.warnings.push('Nao foi possivel reconhecer o formato da lista.');
      }
    }
    res.channels = TV.dedupeChannels(res.channels);
    return res;
  };

  TV.dedupeChannels = function (channels) {
    var seen = {};
    var out = [];
    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      var key = ch.url + '|' + ch.name;
      if (has(seen, key)) { continue; }
      seen[key] = 1;
      out.push(ch);
    }
    return out;
  };

  /* ---------------- agrupar / filtrar / pesquisar ---------------- */

  TV.groupChannels = function (channels) {
    var groups = {};
    for (var i = 0; i < channels.length; i++) {
      var g = channels[i].group || 'Sem grupo';
      if (!has(groups, g)) { groups[g] = []; }
      groups[g].push(channels[i]);
    }
    var names = TV.keys(groups).sort(function (a, b) {
      var fa = TV.fold(a);
      var fb = TV.fold(b);
      if (fa < fb) { return -1; }
      if (fa > fb) { return 1; }
      return 0;
    });
    var out = [];
    for (var j = 0; j < names.length; j++) {
      out.push({
        name: names[j],
        channels: TV.sortBy(groups[names[j]], function (c) { return TV.fold(c.name); })
      });
    }
    return out;
  };

  TV.filterChannels = function (channels, query, opts) {
    opts = opts || {};
    var group = opts.group || '';
    var onlyFav = !!opts.onlyFavourites;
    var onlyPlayable = !!opts.onlyPlayable;
    var fav = opts.favourites || {};
    var q = TV.fold(trim(query));
    var terms = q ? q.split(/\s+/) : [];
    var out = [];
    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      if (group && ch.group !== group) { continue; }
      if (onlyFav && !fav[ch.id]) { continue; }
      if (onlyPlayable && (ch.kind === 'unsupported' || !ch.url)) { continue; }
      if (terms.length) {
        var hay = TV.fold(ch.name + ' ' + ch.group);
        var okAll = true;
        for (var t = 0; t < terms.length; t++) {
          if (hay.indexOf(terms[t]) === -1) { okAll = false; break; }
        }
        if (!okAll) { continue; }
      }
      out.push(ch);
    }
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = TV; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
