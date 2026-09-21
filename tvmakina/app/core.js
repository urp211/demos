/* TVmakina - nucleo (ES5 puro: corre em Chrome 49+, Firefox 52+, IE11, Electron 22)
 * Sem dependencias, sem transpilador, sem frameworks.
 * Este ficheiro e lido por: browser (tag <script>), testes (node --test) e build (node build/*.js).
 */
(function (root) {
  'use strict';

  var TV = root.TVmakina || (root.TVmakina = {});
  TV.VERSION = '1.0.0';
  TV.NAME = 'TVmakina';

  /* ---------------- utilitarios ---------------- */

  TV.trim = function (s) {
    if (s === null || s === undefined) { return ''; }
    return String(s).replace(/^\s+|\s+$/g, '');
  };

  TV.toLowerCase = function (s) {
    if (s === null || s === undefined) { return ''; }
    try {
      return String(s).toLocaleLowerCase();
    } catch (e) {
      return String(s).toLowerCase();
    }
  };

  /* remove acentos para a pesquisa funcionar com ou sem acentuacao */
  TV.fold = function (s) {
    var str = TV.toLowerCase(s);
    var map = {
      '\u00e1': 'a', '\u00e0': 'a', '\u00e2': 'a', '\u00e3': 'a', '\u00e4': 'a',
      '\u00e9': 'e', '\u00e8': 'e', '\u00ea': 'e', '\u00eb': 'e',
      '\u00ed': 'i', '\u00ec': 'i', '\u00ee': 'i', '\u00ef': 'i',
      '\u00f3': 'o', '\u00f2': 'o', '\u00f4': 'o', '\u00f5': 'o', '\u00f6': 'o',
      '\u00fa': 'u', '\u00f9': 'u', '\u00fb': 'u', '\u00fc': 'u',
      '\u00e7': 'c', '\u00f1': 'n', '\u00aa': 'a', '\u00ba': 'o'
    };
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      out += map[ch] || ch;
    }
    return out;
  };

  TV.escapeHtml = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  TV.escapeAttr = TV.escapeHtml;

  TV.has = function (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  };

  TV.assign = function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) { continue; }
      for (var k in src) {
        if (TV.has(src, k)) { target[k] = src[k]; }
      }
    }
    return target;
  };

  TV.keys = function (obj) {
    var out = [];
    for (var k in obj) {
      if (TV.has(obj, k)) { out.push(k); }
    }
    return out;
  };

  /* ordenacao estavel e barata (necessaria em maquinas fracas) */
  TV.sortBy = function (arr, fn) {
    var decorated = [];
    for (var i = 0; i < arr.length; i++) { decorated.push([fn(arr[i], i), i, arr[i]]); }
    decorated.sort(function (a, b) {
      if (a[0] < b[0]) { return -1; }
      if (a[0] > b[0]) { return 1; }
      return a[1] - b[1];
    });
    var out = [];
    for (var j = 0; j < decorated.length; j++) { out.push(decorated[j][2]); }
    return out;
  };

  TV.unique = function (arr) {
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (!TV.has(seen, v)) { seen[v] = 1; out.push(v); }
    }
    return out;
  };

  TV.parseBool = function (v, dflt) {
    if (v === undefined || v === null || v === '') { return !!dflt; }
    if (v === true || v === false) { return v; }
    var s = TV.toLowerCase(v);
    if (s === '1' || s === 'true' || s === 'yes' || s === 'sim' || s === 'on') { return true; }
    if (s === '0' || s === 'false' || s === 'no' || s === 'nao' || s === 'off') { return false; }
    return !!dflt;
  };

  TV.parseIntSafe = function (v, dflt) {
    var n = parseInt(v, 10);
    if (isNaN(n)) { return dflt; }
    return n;
  };

  TV.clamp = function (n, min, max) {
    if (n < min) { return min; }
    if (n > max) { return max; }
    return n;
  };

  TV.formatBytes = function (n) {
    if (!n || n < 0) { return '0 B'; }
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    var v = n;
    while (v >= 1024 && i < units.length - 1) { v = v / 1024; i++; }
    return (i === 0 ? v : Math.round(v * 10) / 10) + ' ' + units[i];
  };

  TV.formatBitrate = function (bps) {
    if (!bps || bps <= 0) { return '--'; }
    if (bps < 1000000) { return Math.round(bps / 1000) + ' kb/s'; }
    return (Math.round(bps / 100000) / 10) + ' Mb/s';
  };

  TV.formatDuration = function (sec) {
    if (!sec || sec < 0 || !isFinite(sec)) { return '00:00'; }
    var s = Math.floor(sec % 60);
    var m = Math.floor((sec / 60) % 60);
    var h = Math.floor(sec / 3600);
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
  };

  TV.now = function () {
    return (root.Date && Date.now) ? Date.now() : new Date().getTime();
  };

  TV.throttle = function (fn, wait) {
    var last = 0;
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      var t = TV.now();
      var remaining = wait - (t - last);
      if (remaining <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        last = t;
        fn.apply(self, args);
      } else if (!timer) {
        timer = setTimeout(function () {
          timer = null;
          last = TV.now();
          fn.apply(self, args);
        }, remaining);
      }
    };
  };

  TV.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(function () { timer = null; fn.apply(self, args); }, wait);
    };
  };

  /* ---------------- URLs / streams ---------------- */

  var RE_MULTICAST = /^2(?:2[4-9]|3\d)\./;
  var RE_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d+))?$/;

  TV.isMulticast = function (ip) {
    return RE_MULTICAST.test(TV.trim(ip));
  };

  TV.isValidIpv4 = function (ip) {
    var m = RE_IPV4.exec(TV.trim(ip));
    if (!m) { return false; }
    for (var i = 1; i <= 4; i++) {
      var n = parseInt(m[i], 10);
      if (n < 0 || n > 255) { return false; }
    }
    return true;
  };

  TV.splitHostPort = function (value, defPort) {
    var s = TV.trim(value);
    var m = RE_IPV4.exec(s);
    if (m && m[5]) { return { host: s.substring(0, s.lastIndexOf(':')), port: parseInt(m[5], 10) }; }
    var idx = s.indexOf(':');
    if (idx > 0 && s.indexOf(':', idx + 1) === -1) {
      var port = parseInt(s.substring(idx + 1), 10);
      if (!isNaN(port)) { return { host: s.substring(0, idx), port: port }; }
    }
    return { host: s, port: defPort };
  };

  /* Normaliza "239.1.1.1:1234" ou "udp://@239.1.1.1:1234" para {group, port, iface} */
  TV.parseUdpTarget = function (raw) {
    var s = TV.trim(raw);
    s = s.replace(/^udp:\/\/(@)?/i, '');
    s = s.replace(/^rtp:\/\/(@)?/i, '');
    var iface = null;
    var q = s.indexOf('?');
    if (q >= 0) {
      var params = s.substring(q + 1).split('&');
      for (var i = 0; i < params.length; i++) {
        var kv = params[i].split('=');
        if (TV.toLowerCase(kv[0]) === 'interface' || TV.toLowerCase(kv[0]) === 'iface') {
          iface = decodeURIComponent(kv[1] || '');
        }
      }
      s = s.substring(0, q);
    }
    var at = s.indexOf('@');
    if (at >= 0) {
      var left = s.substring(0, at);
      if (left) { iface = left.replace(/^:*$/, '') || iface; }
      s = s.substring(at + 1);
    }
    var hp = TV.splitHostPort(s, 1234);
    return { group: hp.host, port: hp.port, iface: iface, raw: raw };
  };

  TV.isUdpUrl = function (url) {
    return /^(udp|rtp):\/\//i.test(TV.trim(url));
  };

  /* tipos: hls | native | udp | unsupported | test */
  TV.detectStreamType = function (url) {
    var s = TV.trim(url);
    if (!s) { return 'none'; }
    if (s === 'test:' || s.indexOf('test:') === 0) { return 'test'; }
    if (TV.isUdpUrl(s)) { return 'udp'; }
    if (/^(rtsp|rtmp|mms|mmsh|mmst|srt|dvb):\/\//i.test(s)) { return 'unsupported'; }
    var path = s.split('?')[0].split('#')[0];
    if (/\.m3u8?$/i.test(path)) { return 'hls'; }
    if (/\.(mp4|m4v|mov|webm|ogv|ogg|mp3|m4a|aac|wav|ts|m2ts|mpg|mpeg|mkv)$/i.test(path)) { return 'native'; }
    if (/^https?:\/\//i.test(s)) { return 'native'; }
    if (/^(file|blob|data|mediasource):/i.test(s)) { return 'native'; }
    return 'unknown';
  };

  TV.needsProxy = function (type) { return type === 'udp'; };

  TV.unsupportedReason = function (type) {
    if (type === 'unsupported') {
      return 'Este protocolo (RTSP/RTMP/MMS) nao e suportado pelo motor de video do sistema. ' +
        'Use um stream HTTP/HLS ou converta com um servidor local (udpxy/ffmpeg).';
    }
    return '';
  };

  /* Constroi o URL final a entregar ao elemento <video>.
   * settings.proxy = "127.0.0.1:4022" | "" (vazio = tentar udpxy na porta 4022)
   */
  TV.buildStreamUrl = function (channel, settings) {
    settings = settings || {};
    var url = channel && channel.url ? TV.trim(channel.url) : '';
    var type = channel && channel.kind ? channel.kind : TV.detectStreamType(url);
    if (type !== 'udp') { return url; }
    var target = TV.parseUdpTarget(url);
    var proxy = TV.trim(settings.proxy || '');
    if (!proxy) {
      var host = (root.location && root.location.hostname) ? root.location.hostname : '127.0.0.1';
      proxy = host + ':4022';
    }
    if (proxy.indexOf('://') === -1) { proxy = 'http://' + proxy; }
    proxy = proxy.replace(/\/+$/, '');
    var suffix = target.iface ? '?interface=' + encodeURIComponent(target.iface) : '';
    return proxy + '/udp/' + target.group + ':' + target.port + suffix;
  };

  TV.describeChannel = function (channel) {
    if (!channel) { return ''; }
    var type = channel.kind || TV.detectStreamType(channel.url);
    if (type === 'test') { return 'Sinal de teste interno (nao usa rede)'; }
    if (type === 'udp') {
      var t = TV.parseUdpTarget(channel.url);
      return 'Multicast UDP ' + t.group + ':' + t.port + ' via proxy HTTP local';
    }
    if (type === 'hls') { return 'HLS (HTTP Live Streaming)'; }
    if (type === 'unsupported') { return TV.unsupportedReason(type); }
    return 'Stream HTTP direto';
  };

  /* ---------------- export para Node (testes / build) ---------------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TV;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
