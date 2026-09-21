#!/usr/bin/env node
/* TVmakina Proxy - converte multicast UDP (239.x.x.x) em HTTP para o browser
 *
 * Necessario porque um browser nunca consegue receber UDP directamente.
 * Compativel com o udpxy:  GET /udp/<grupo>:<porta>  devolve o fluxo MPEG-TS.
 *
 * Extra do TVmakina (o udpxy nao tem):
 *   GET /status                 estado em JSON (clientes, bytes, sockets)
 *   GET /scan                   procura servidores de media na rede (SSDP)
 *   GET /proxy?url=<http://..>  reencaminha um stream HTTP que bloqueia o browser
 *                               (certificados errados, falta de CORS, http em pagina https)
 *   serve tambem a pagina do TVmakina em  http://127.0.0.1:4022/
 *
 * Sem dependencias externas. Testado em Node 13+ (Node 14 LTS corre no Windows 7 SP1).
 *
 * Utilizacao:
 *   node server/proxy.js                 (porta 4022, todas as interfaces)
 *   node server/proxy.js --port 4023 --iface 192.168.1.20
 */
'use strict';

var http = require('http');
var dgram = require('dgram');
var fs = require('fs');
var net = require('net');
var path = require('path');
var os = require('os');
var url = require('url');

var DEFAULT_PORT = 4022;
var BUFFER_SIZE = 1024 * 1024;     /* 1 MB por socket: chega para TS e poupa RAM */
var IDLE_TIMEOUT_MS = 20000;

function argOf(name, dflt) {
  var flag = '--' + name;
  for (var i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === flag) { return process.argv[i + 1]; }
    if (process.argv[i].indexOf(flag + '=') === 0) { return process.argv[i].split('=')[1]; }
  }
  return dflt;
}

var CONFIG = {
  port: parseInt(argOf('port', DEFAULT_PORT), 10) || DEFAULT_PORT,
  host: argOf('host', '0.0.0.0'),
  iface: argOf('iface', ''),
  maxBuffer: parseInt(argOf('max-buffer', BUFFER_SIZE), 10) || BUFFER_SIZE,
  root: path.resolve(__dirname, '..'),
  quiet: process.argv.indexOf('--quiet') >= 0
};

function log() {
  if (CONFIG.quiet) { return; }
  var args = [new Date().toISOString().substring(11, 19)].concat(Array.prototype.slice.call(arguments));
  console.log.apply(console, args);
}

function parseArgs(argv) {
  var out = {
    port: DEFAULT_PORT,
    host: '0.0.0.0',
    iface: '',
    maxBuffer: BUFFER_SIZE,
    quiet: false
  };
  var list = argv || [];
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    if (a === '--port') { out.port = parseInt(list[++i], 10) || DEFAULT_PORT; }
    else if (a === '--host') { out.host = list[++i] || out.host; }
    else if (a === '--iface') { out.iface = list[++i] || ''; }
    else if (a === '--max-buffer') { out.maxBuffer = parseInt(list[++i], 10) || BUFFER_SIZE; }
    else if (a === '--quiet') { out.quiet = true; }
  }
  return out;
}

function isMulticast(group) {
  var m = /^(\d{1,3})\./.exec(group || '');
  if (!m) { return false; }
  var first = parseInt(m[1], 10);
  return first >= 224 && first <= 239;
}

function guessInterface(group) {
  /* Escolhe uma interface IPv4 privada para o IGMP join. */
  if (CONFIG.iface) { return CONFIG.iface; }
  try {
    var ifaces = os.networkInterfaces();
    for (var name in ifaces) {
      if (!Object.prototype.hasOwnProperty.call(ifaces, name)) { continue; }
      var list = ifaces[name] || [];
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a.family === 'IPv4' && !a.internal) { return a.address; }
      }
    }
  } catch (e) { /* ignorar */ }
  return '0.0.0.0';
}

/* ---------------- nucleo do proxy ---------------- */

function createProxy(options) {
  var opts = options || {};
  var sockets = {};          /* chave "grupo:porta" -> socket partilhado */
  var totalBytes = 0;
  var totalClients = 0;
  var startedAt = Date.now();

  function keyOf(group, port) { return group + ':' + port; }

  function addMembership(socket, group, iface) {
    var tried = [];
    var candidates = [];
    if (iface) { candidates.push(iface); }
    candidates.push('0.0.0.0');
    try {
      var ifaces = os.networkInterfaces();
      for (var name in ifaces) {
        if (!Object.prototype.hasOwnProperty.call(ifaces, name)) { continue; }
        var list = ifaces[name] || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].family === 'IPv4' && !list[i].internal) { candidates.push(list[i].address); }
        }
      }
    } catch (e) { /* ignorar */ }

    for (var c = 0; c < candidates.length; c++) {
      var cand = candidates[c];
      if (tried.indexOf(cand) >= 0) { continue; }
      tried.push(cand);
      try {
        socket.addMembership(group, cand);
        log('IGMP join', group, 'em', cand);
        return cand;
      } catch (e) { /* tentar a interface seguinte */ }
    }
    return '';
  }

  function getSocket(group, port, iface) {
    var key = keyOf(group, port);
    if (sockets[key]) { return sockets[key]; }

    var socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    var entry = {
      key: key,
      group: group,
      port: port,
      socket: socket,
      clients: [],
      bytes: 0,
      startedAt: Date.now(),
      joinedOn: '',
      idleTimer: null,
      pending: []
    };
    sockets[key] = entry;

    socket.on('message', function (msg) {
      entry.bytes += msg.length;
      totalBytes += msg.length;
      var alive = [];
      for (var i = 0; i < entry.clients.length; i++) {
        var res = entry.clients[i];
        if (res.destroyed || !res.writable) { continue; }
        /* se o cliente for mais lento do que a rede, nao encher a memoria: descartar */
        if (res.socket && res.socket.bufferSize > opts.maxBuffer) { continue; }
        try { res.write(msg); alive.push(res); } catch (e) { /* cliente desapareceu */ }
      }
      entry.clients = alive;
      if (!entry.clients.length) { scheduleClose(entry); }
    });

    socket.on('error', function (err) {
      log('erro no socket', key, err.message);
      closeEntry(entry);
    });

    try {
      socket.bind(port, function () {
        if (isMulticast(group)) {
          try { socket.setMulticastLoopback(true); } catch (e) { /* ignorar */ }
          try { socket.setMulticastTTL(2); } catch (e2) { /* ignorar */ }
          entry.joinedOn = addMembership(socket, group, iface);
        }
      });
    } catch (e3) {
      log('falha ao abrir UDP', key, e3.message);
    }

    return entry;
  }

  function scheduleClose(entry) {
    if (entry.idleTimer) { return; }
    entry.idleTimer = setTimeout(function () {
      if (!entry.clients.length) { closeEntry(entry); }
      entry.idleTimer = null;
    }, IDLE_TIMEOUT_MS);
  }

  function closeEntry(entry) {
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
    try {
      if (isMulticast(entry.group) && entry.joinedOn) {
        entry.socket.dropMembership(entry.group, entry.joinedOn);
      }
    } catch (e) { /* ignorar */ }
    try { entry.socket.close(); } catch (e2) { /* ignorar */ }
    for (var i = 0; i < entry.clients.length; i++) {
      try { entry.clients[i].end(); } catch (e3) { /* ignorar */ }
    }
    entry.clients = [];
    if (sockets[entry.key]) { delete sockets[entry.key]; }
    log('socket fechado', entry.key);
  }

  function serveUdp(req, res, group, port, iface) {
    var entry = getSocket(group, port, iface);
    if (!entry) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('nao foi possivel abrir o socket UDP');
      return;
    }
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }

    res.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'no-store',
      'Connection': 'close',
      'Access-Control-Allow-Origin': '*'
    });
    entry.clients.push(res);
    totalClients++;
    log('cliente', req.socket.remoteAddress, '->', entry.key, '(' + entry.clients.length + ' ligado(s))');

    var cleanup = function () {
      var idx = entry.clients.indexOf(res);
      if (idx >= 0) { entry.clients.splice(idx, 1); }
      totalClients = Math.max(0, totalClients - 1);
      log('cliente saiu de', entry.key, '(' + entry.clients.length + ' ligado(s))');
      if (!entry.clients.length) { scheduleClose(entry); }
    };
    res.on('close', cleanup);
    res.on('error', cleanup);
    req.on('close', cleanup);
  }

  function status() {
    var list = [];
    for (var key in sockets) {
      if (!Object.prototype.hasOwnProperty.call(sockets, key)) { continue; }
      var s = sockets[key];
      list.push({
        grupo: s.group,
        porta: s.port,
        clientes: s.clients.length,
        bytes: s.bytes,
        interface: s.joinedOn,
        multicast: isMulticast(s.group),
        segundos: Math.round((Date.now() - s.startedAt) / 1000)
      });
    }
    return {
      app: 'TVmakina Proxy',
      versao: '1.0.0',
      porta: opts.port,
      interfacePadrao: opts.iface || guessInterface(''),
      uptimeSegundos: Math.round((Date.now() - startedAt) / 1000),
      bytesTotais: totalBytes,
      clientesTotais: totalClients,
      sockets: list,
      node: process.version
    };
  }

  /* reencaminhador HTTP: contorna CORS / certificados / mixed content */
  function serveHttpProxy(req, res, target) {
    var parsed;
    try { parsed = url.parse(target); } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('url invalido');
      return;
    }
    var mod = parsed.protocol === 'https:' ? require('https') : http;
    var options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: (parsed.path || '/'),
      method: 'GET',
      headers: { 'User-Agent': 'TVmakina/1.0' },
      rejectUnauthorized: false
    };
    var upstream;
    try {
      upstream = mod.request(options, function (up) {
        res.writeHead(up.statusCode || 200, {
          'Content-Type': up.headers['content-type'] || 'video/mp2t',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        });
        up.pipe(res);
      });
    } catch (e2) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('pedido falhou: ' + e2.message);
      return;
    }
    upstream.on('error', function (err) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('erro: ' + err.message);
    });
    upstream.setTimeout(15000, function () { upstream.abort(); });
    upstream.end();
    res.on('close', function () { try { upstream.abort(); } catch (e) { /* ignorar */ } });
  }

  /* descoberta SSDP de servidores de media na rede local */
  function scan(callback) {
    var found = {};
    var socket;
    try { socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) {
      return callback(e, []);
    }
    var msg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: ssdp:all\r\n\r\n', 'utf8');

    var timer = setTimeout(function () {
      var out = [];
      for (var k in found) {
        if (Object.prototype.hasOwnProperty.call(found, k)) { out.push(found[k]); }
      }
      try { socket.close(); } catch (e2) { /* ignorar */ }
      callback(null, out);
    }, 3000);

    socket.on('message', function (buf, rinfo) {
      var text = buf.toString('utf8');
      var loc = /LOCATION:\s*([^\r\n]+)/i.exec(text);
      var st = /ST:\s*([^\r\n]+)/i.exec(text);
      var key = rinfo.address + '|' + (loc ? loc[1] : '');
      if (found[key]) { return; }
      found[key] = { ip: rinfo.address, tipo: st ? st[1].trim() : '', location: loc ? loc[1].trim() : '' };
    });
    socket.on('error', function (err) {
      clearTimeout(timer);
      try { socket.close(); } catch (e) { /* ignorar */ }
      callback(err, []);
    });
    try {
      socket.bind(0, function () {
        try {
          socket.setMulticastTTL(2);
          socket.addMembership('239.255.255.250');
        } catch (e) { /* alguns sistemas bloqueiam; o M-SEARCH ainda pode funcionar */ }
        socket.send(msg, 0, msg.length, 1900, '239.255.255.250', function (err) {
          if (err) { log('SSDP falhou:', err.message); }
        });
      });
    } catch (e3) {
      clearTimeout(timer);
      callback(e3, []);
    }
  }

  return {
    serveUdp: serveUdp,
    serveHttpProxy: serveHttpProxy,
    status: status,
    scan: scan,
    getSocket: getSocket,
    sockets: function () { return sockets; },
    closeAll: function () {
      for (var key in sockets) {
        if (Object.prototype.hasOwnProperty.call(sockets, key)) { closeEntry(sockets[key]); }
      }
    }
  };
}

/* ---------------- servidor HTTP + ficheiros estaticos ---------------- */

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m3u': 'audio/x-mpegurl; charset=utf-8',
  '.m3u8': 'audio/x-mpegurl; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ts': 'video/mp2t'
};

function serveStatic(req, res, rootDir, pathname) {
  var rel = decodeURIComponent(pathname || '/');
  if (rel === '/') {
    /* a pagina de desenvolvimento tem prioridade; o ficheiro unico e o recurso */
    rel = fs.existsSync(path.join(rootDir, 'index.html')) ? '/index.html' : '/dist/TVmakina.html';
  }
  var full = path.join(rootDir, rel);
  if (full.indexOf(rootDir) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('acesso negado');
    return;
  }
  fs.stat(full, function (err, st) {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('nao encontrado: ' + rel);
      return;
    }
    var ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    });
    var stream = fs.createReadStream(full);
    stream.pipe(res);
    stream.on('error', function () { try { res.end(); } catch (e) { /* ignorar */ } });
  });
}

function createServer(options) {
  var opts = options || {};
  var proxy = createProxy(opts);
  var rootDir = opts.root || path.resolve(__dirname, '..');

  var server = http.createServer(function (req, res) {
    var parsed;
    try { parsed = url.parse(req.url, true); } catch (e) {
      res.writeHead(400); res.end('pedido invalido'); return;
    }
    var pathname = parsed.pathname || '/';
    var query = parsed.query || {};

    if (pathname === '/status' || pathname === '/status/') {
      var body = JSON.stringify(proxy.status(), null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    if (pathname === '/scan') {
      proxy.scan(function (err, list) {
        var out = JSON.stringify({ erro: err ? err.message : '', dispositivos: list || [] }, null, 2);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(out);
      });
      return;
    }

    if (pathname === '/proxy') {
      if (!query.url) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('use /proxy?url=http://servidor/stream.ts');
        return;
      }
      proxy.serveHttpProxy(req, res, query.url);
      return;
    }

    if (pathname === '/udp' || pathname === '/udp/') {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('use /udp/239.1.1.1:1234');
      return;
    }

    if (pathname.indexOf('/udp/') === 0) {
      var rest = pathname.substring(5);
      var qIdx = rest.indexOf('?');
      if (qIdx >= 0) { rest = rest.substring(0, qIdx); }
      var iface = query['interface'] || opts.iface || '';
      var atIdx = rest.indexOf('@');
      if (atIdx >= 0) {
        if (rest.substring(0, atIdx)) { iface = rest.substring(0, atIdx); }
        rest = rest.substring(atIdx + 1);
      }
      var colon = rest.lastIndexOf(':');
      var group = colon > 0 ? rest.substring(0, colon) : rest;
      var port = colon > 0 ? parseInt(rest.substring(colon + 1), 10) : 1234;
      if (!group || isNaN(port) || port <= 0 || port > 65535) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('formato esperado: /udp/<ip-multicast>:<porta>');
        return;
      }
      proxy.serveUdp(req, res, group, port, iface);
      return;
    }

    serveStatic(req, res, rootDir, pathname);
  });

  server.on('error', function (err) {
    log('ERRO no servidor HTTP:', err.message);
  });

  return { server: server, proxy: proxy };
}

/* ---------------- entrada ---------------- */

function main() {
  var created = createServer(CONFIG);
  created.server.listen(CONFIG.port, CONFIG.host, function () {
    var ips = [];
    try {
      var ifaces = os.networkInterfaces();
      for (var name in ifaces) {
        if (!Object.prototype.hasOwnProperty.call(ifaces, name)) { continue; }
        var list = ifaces[name] || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].family === 'IPv4' && !list[i].internal) { ips.push(list[i].address); }
        }
      }
    } catch (e) { /* ignorar */ }

    log('==============================================');
    log(' TVmakina Proxy 1.0.0  (Node ' + process.version + ')');
    log(' Interface: http://127.0.0.1:' + CONFIG.port + '/');
    for (var k = 0; k < ips.length; k++) {
      log(' Na rede:   http://' + ips[k] + ':' + CONFIG.port + '/');
    }
    log(' Estado:    http://127.0.0.1:' + CONFIG.port + '/status');
    log(' UDP->HTTP: http://127.0.0.1:' + CONFIG.port + '/udp/239.1.1.1:1234');
    log('==============================================');
  });

  process.on('SIGINT', function () {
    log('a terminar...');
    created.proxy.closeAll();
    try { created.server.close(); } catch (e) { /* ignorar */ }
    process.exit(0);
  });
}

if (require.main === module) { main(); }

module.exports = {
  createProxy: createProxy,
  createServer: createServer,
  parseArgs: parseArgs,
  isMulticast: isMulticast,
  serveStatic: serveStatic,
  CONFIG: CONFIG
};
