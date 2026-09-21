/* TVmakina - rede compativel com browsers antigos
 * fetch se existir; caso contrario XMLHttpRequest (IE11, Chrome 49).
 * ES5 puro.
 */
(function (root) {
  'use strict';

  var TV = root.TVmakina || (root.TVmakina = {});

  function createXhr() {
    if (root.XMLHttpRequest) { return new root.XMLHttpRequest(); }
    /* IE antigo */
    /* global ActiveXObject */
    return new ActiveXObject('Microsoft.XMLHTTP');
  }

  /* TV.request({url, method, timeout, responseType, headers}) -> callback(err, {status, text, xhr}) */
  TV.request = function (options, callback) {
    var opts = options || {};
    var done = false;
    var finish = function (err, res) {
      if (done) { return; }
      done = true;
      callback(err, res);
    };

    if (root.fetch && !opts.forceXhr) {
      var ctrl = null;
      var init = { method: opts.method || 'GET', headers: opts.headers || {}, cache: 'no-store' };
      try {
        if (root.AbortController) { ctrl = new root.AbortController(); init.signal = ctrl.signal; }
      } catch (e) { ctrl = null; }
      var timer = null;
      if (opts.timeout) {
        timer = setTimeout(function () {
          if (ctrl) { try { ctrl.abort(); } catch (e2) { /* ignorar */ } }
          finish(new Error('tempo esgotado'), null);
        }, opts.timeout);
      }
      root.fetch(opts.url, init).then(function (resp) {
        if (timer) { clearTimeout(timer); }
        return resp.text().then(function (text) {
          finish(null, { status: resp.status, text: text, ok: resp.ok !== false && resp.status < 400 });
        });
      })['catch'](function (err) {
        if (timer) { clearTimeout(timer); }
        finish(err, null);
      });
      return;
    }

    var xhr;
    try { xhr = createXhr(); } catch (e) { finish(e, null); return; }
    try {
      xhr.open(opts.method || 'GET', opts.url, true);
      if (opts.responseType) { xhr.responseType = opts.responseType; }
      if (opts.timeout) { xhr.timeout = opts.timeout; }
      var headers = opts.headers || {};
      for (var k in headers) {
        if (TV.has(headers, k)) {
          try { xhr.setRequestHeader(k, headers[k]); } catch (e3) { /* ignorar */ }
        }
      }
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) { return; }
        finish(null, {
          status: xhr.status,
          text: xhr.responseText,
          ok: xhr.status >= 200 && xhr.status < 400,
          xhr: xhr
        });
      };
      xhr.onerror = function () { finish(new Error('erro de rede'), null); };
      xhr.ontimeout = function () { finish(new Error('tempo esgotado'), null); };
      xhr.send(null);
    } catch (e4) {
      finish(e4, null);
    }
  };

  TV.getText = function (url, timeout, callback) {
    TV.request({ url: url, timeout: timeout || 15000 }, function (err, res) {
      if (err) { return callback(err, ''); }
      if (!res.ok) { return callback(new Error('HTTP ' + res.status), res.text || ''); }
      callback(null, res.text || '');
    });
  };

  TV.readTextFile = function (file, callback) {
    if (!root.FileReader) { return callback(new Error('Este browser nao suporta leitura de ficheiros.'), ''); }
    var reader = new root.FileReader();
    reader.onload = function () { callback(null, String(reader.result || '')); };
    reader.onerror = function () { callback(new Error('Falha ao ler o ficheiro.'), ''); };
    reader.readAsText(file, 'utf-8');
  };

  /* Verifica se um servidor local (proxy/udpxy) esta a responder. */
  TV.probeProxy = function (base, callback) {
    var url = String(base || '').replace(/\/+$/, '');
    if (!url) { return callback(false, 'sem endereco'); }
    if (url.indexOf('://') === -1) { url = 'http://' + url; }
    var tries = [url + '/status', url + '/status/', url + '/'];
    var i = 0;
    var next = function () {
      if (i >= tries.length) { return callback(false, 'nao respondeu'); }
      var u = tries[i++];
      TV.request({ url: u, timeout: 2500 }, function (err, res) {
        if (!err && res && res.status > 0 && res.status < 500) { return callback(true, 'HTTP ' + res.status); }
        next();
      });
    };
    next();
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = TV; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
