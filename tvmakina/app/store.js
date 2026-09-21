/* TVmakina - persistencia local (localStorage com reserva em memoria)
 * ES5 puro. Guarda: listas, favoritos, historico, definicoes, ultimo canal.
 */
(function (root) {
  'use strict';

  var TV = root.TVmakina || (root.TVmakina = {});
  var has = TV.has;

  var PREFIX = 'tvmakina.v1.';
  var memory = {};
  var backend = 'memoria';

  function detect() {
    try {
      var ls = root.localStorage;
      if (!ls) { return 'memoria'; }
      var k = PREFIX + '__teste__';
      ls.setItem(k, '1');
      ls.removeItem(k);
      return 'localStorage';
    } catch (e) {
      return 'memoria';
    }
  }

  var Store = TV.Store = {
    backend: function () { return backend; },

    getRaw: function (key) {
      var k = PREFIX + key;
      if (backend === 'localStorage') {
        try {
          var v = root.localStorage.getItem(k);
          return v === null ? undefined : v;
        } catch (e) { return memory[k]; }
      }
      return memory[k];
    },

    setRaw: function (key, value) {
      var k = PREFIX + key;
      memory[k] = value;
      if (backend === 'localStorage') {
        try { root.localStorage.setItem(k, value); return true; } catch (e) { backend = 'memoria'; }
      }
      return backend === 'memoria';
    },

    remove: function (key) {
      var k = PREFIX + key;
      if (has(memory, k)) { delete memory[k]; }
      if (backend === 'localStorage') {
        try { root.localStorage.removeItem(k); } catch (e) { /* ignorar */ }
      }
    },

    get: function (key, dflt) {
      var raw = Store.getRaw(key);
      if (raw === undefined || raw === null || raw === '') { return dflt; }
      try { return JSON.parse(raw); } catch (e) { return dflt; }
    },

    set: function (key, value) {
      var raw;
      try { raw = JSON.stringify(value); } catch (e) { return false; }
      return Store.setRaw(key, raw);
    },

    clearAll: function () {
      var keys = [];
      if (backend === 'localStorage') {
        try {
          var ls = root.localStorage;
          for (var i = 0; i < ls.length; i++) {
            var k = ls.key(i);
            if (k && k.indexOf(PREFIX) === 0) { keys.push(k); }
          }
        } catch (e) { /* ignorar */ }
      }
      for (var j = 0; j < keys.length; j++) {
        try { root.localStorage.removeItem(keys[j]); } catch (e2) { /* ignorar */ }
      }
      for (var mk in memory) {
        if (has(memory, mk) && mk.indexOf(PREFIX) === 0) { delete memory[mk]; }
      }
    },

    usageBytes: function () {
      var total = 0;
      for (var k in memory) {
        if (has(memory, k)) { total += memory[k].length; }
      }
      if (backend === 'localStorage') {
        try {
          var ls = root.localStorage;
          total = 0;
          for (var i = 0; i < ls.length; i++) {
            var key = ls.key(i);
            if (key && key.indexOf(PREFIX) === 0) { total += (ls.getItem(key) || '').length + key.length; }
          }
        } catch (e) { /* ignorar */ }
      }
      return total;
    }
  };

  /* ---------------- definicoes ---------------- */

  var DEFAULT_SETTINGS = {
    proxy: '127.0.0.1:4022',
    autoProxy: true,
    lowEnd: null,            /* null = detecao automatica */
    maxBufferSec: 12,
    maxStarveSec: 4,
    maxBitrate: 0,           /* 0 = automatico */
    autoNext: true,
    retryTimes: 2,
    volume: 100,
    muted: false,
    aspect: 'contain',       /* contain | cover | fill */
    theme: 'escuro',
    showLogos: true,
    rememberLast: true,
    recordFormat: 'webm',
    hwAccel: true
  };

  Store.defaultSettings = function () {
    var out = {};
    for (var k in DEFAULT_SETTINGS) {
      if (has(DEFAULT_SETTINGS, k)) { out[k] = DEFAULT_SETTINGS[k]; }
    }
    return out;
  };

  Store.loadSettings = function () {
    var saved = Store.get('settings', {}) || {};
    var out = Store.defaultSettings();
    for (var k in saved) {
      if (has(saved, k) && has(DEFAULT_SETTINGS, k)) { out[k] = saved[k]; }
    }
    out.volume = TV.clamp(TV.parseIntSafe(out.volume, 100), 0, 100);
    out.maxBufferSec = TV.clamp(TV.parseIntSafe(out.maxBufferSec, 12), 3, 120);
    return out;
  };

  Store.saveSettings = function (settings) {
    return Store.set('settings', settings);
  };

  /* ---------------- favoritos ---------------- */

  Store.loadFavourites = function () {
    var f = Store.get('favourites', {});
    return (f && typeof f === 'object') ? f : {};
  };

  Store.toggleFavourite = function (id) {
    var f = Store.loadFavourites();
    if (f[id]) { delete f[id]; } else { f[id] = 1; }
    Store.set('favourites', f);
    return !!f[id];
  };

  /* ---------------- historico ---------------- */

  Store.pushHistory = function (channel, limit) {
    if (!channel || !channel.id) { return []; }
    var h = Store.get('history', []);
    if (!(h instanceof Array)) { h = []; }
    var out = [];
    out.push({ id: channel.id, name: channel.name, group: channel.group, logo: channel.logo, at: TV.now() });
    for (var i = 0; i < h.length && out.length < (limit || 25); i++) {
      if (h[i] && h[i].id !== channel.id) { out.push(h[i]); }
    }
    Store.set('history', out);
    return out;
  };

  Store.loadHistory = function () {
    var h = Store.get('history', []);
    return (h instanceof Array) ? h : [];
  };

  /* ---------------- listas guardadas ---------------- */

  Store.savePlaylist = function (name, channels, meta) {
    var lists = Store.get('playlists', []);
    if (!(lists instanceof Array)) { lists = []; }
    var entry = {
      name: name || ('Lista ' + (lists.length + 1)),
      savedAt: TV.now(),
      count: channels.length,
      channels: channels,
      origin: (meta && meta.origin) || ''
    };
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].name === entry.name) { lists[i] = entry; Store.set('playlists', lists); return entry; }
    }
    lists.push(entry);
    Store.set('playlists', lists);
    return entry;
  };

  Store.loadPlaylists = function () {
    var l = Store.get('playlists', []);
    return (l instanceof Array) ? l : [];
  };

  Store.deletePlaylist = function (name) {
    var lists = Store.loadPlaylists();
    var out = [];
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].name !== name) { out.push(lists[i]); }
    }
    Store.set('playlists', out);
    return out;
  };

  Store.init = function () {
    backend = detect();
    return backend;
  };

  Store.init();

  if (typeof module !== 'undefined' && module.exports) { module.exports = TV; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
