/* Teste real do proxy UDP->HTTP: abre o servidor do ficheiro server/proxy.js,
 * envia datagramas UDP e confirma que chegam ao cliente HTTP.
 */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dgram from 'node:dgram';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const proxy = require(path.join(ROOT, 'server', 'proxy.js'));

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(4000, () => req.destroy(new Error('tempo esgotado')));
  });
}

function readBytes(res, n, timeoutMs) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    const timer = setTimeout(() => {
      cleanup();
      resolve(Buffer.concat(partes));
    }, timeoutMs || 1500);
    function cleanup() {
      clearTimeout(timer);
      res.removeListener('data', onData);
    }
    function onData(chunk) {
      partes.push(chunk);
      total += chunk.length;
      if (total >= n) {
        cleanup();
        resolve(Buffer.concat(partes));
      }
    }
    res.on('data', onData);
    res.on('error', () => { cleanup(); resolve(Buffer.concat(partes)); });
  });
}

test('parseArgs le as opcoes da linha de comandos', () => {
  const a = proxy.parseArgs(['--port', '5100', '--iface', '192.168.1.7', '--quiet']);
  assert.equal(a.port, 5100);
  assert.equal(a.iface, '192.168.1.7');
  assert.equal(a.quiet, true);

  const b = proxy.parseArgs([]);
  assert.equal(b.port, 4022);
  assert.equal(b.host, '0.0.0.0');
  assert.equal(b.quiet, false);
});

test('deteccao de multicast', () => {
  assert.equal(proxy.isMulticast('239.1.1.1'), true);
  assert.equal(proxy.isMulticast('224.0.0.251'), true);
  assert.equal(proxy.isMulticast('192.168.1.1'), false);
  assert.equal(proxy.isMulticast('exemplo.test'), false);
});

test('UDP -> HTTP: os datagramas chegam ao cliente e o estado conta-os', async (t) => {
  const created = proxy.createServer({ port: 0, host: '127.0.0.1', quiet: true, root: ROOT });
  await new Promise((resolve) => created.server.listen(0, '127.0.0.1', resolve));
  const port = created.server.address().port;
  t.after(() => {
    created.proxy.closeAll();
    created.server.close();
  });

  /* 1) cliente HTTP liga-se ao "canal" 127.0.0.1:45678 (unicast: o sandbox nao deixa multicast) */
  const resposta = new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/udp/127.0.0.1:45678' }, resolve);
    req.on('error', reject);
  });

  /* 2) esperar que o proxy tenha o socket UDP aberto antes de emitir */
  let tentativas = 0;
  while (Object.keys(created.proxy.sockets()).length === 0 && tentativas < 100) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    tentativas++;
  }
  assert.ok(Object.keys(created.proxy.sockets()).length > 0, 'o proxy abriu o socket UDP');

  /* 3) um "emissor" envia dois pacotes (um TS de 188 bytes e uma marca) */
  const sender = dgram.createSocket('udp4');
  const pacote1 = Buffer.alloc(188, 0x47);
  const pacote2 = Buffer.from('TVMAKINA-TESTE-0123456789');
  const envia = (buf) => new Promise((resolve, reject) => {
    sender.send(buf, 45678, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  await envia(pacote1);
  await envia(pacote2);

  const res = await resposta;
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'video/mp2t');
  assert.equal(res.headers['access-control-allow-origin'], '*', 'CORS aberto para o leitor');

  const recebido = await readBytes(res, 190, 3000);
  sender.close();
  res.destroy();

  assert.ok(recebido.length >= 188, 'esperava pelo menos um pacote TS, recebi ' + recebido.length);
  assert.equal(recebido[0], 0x47, 'sincronismo MPEG-TS no primeiro byte');
  assert.ok(recebido.includes(pacote2), 'o segundo pacote chegou ao cliente HTTP');

  /* 4) o estado reflete o que aconteceu */
  const stRes = await httpGet(port, '/status');
  const corpo = await readBytes(stRes, 100000, 1000);
  const estado = JSON.parse(corpo.toString('utf8'));
  assert.equal(estado.app, 'TVmakina Proxy');
  assert.ok(estado.bytesTotais >= 188, 'bytes contados: ' + estado.bytesTotais);
  assert.ok(estado.sockets.length >= 1, 'ha um socket registado');
  assert.equal(estado.sockets[0].porta, 45678);
  assert.equal(estado.sockets[0].multicast, false);
});

test('/status responde sempre, mesmo sem canais activos', async (t) => {
  const created = proxy.createServer({ port: 0, host: '127.0.0.1', quiet: true, root: ROOT });
  await new Promise((resolve) => created.server.listen(0, '127.0.0.1', resolve));
  const port = created.server.address().port;
  t.after(() => created.server.close());

  const res = await httpGet(port, '/status');
  assert.equal(res.statusCode, 200);
  const corpo = await readBytes(res, 100000, 500);
  const estado = JSON.parse(corpo.toString('utf8'));
  assert.deepEqual(estado.sockets, []);
  assert.equal(typeof estado.uptimeSegundos, 'number');
});

test('o indice serve a pagina do TVmakina', async (t) => {
  const created = proxy.createServer({ port: 0, host: '127.0.0.1', quiet: true, root: ROOT });
  await new Promise((resolve) => created.server.listen(0, '127.0.0.1', resolve));
  const port = created.server.address().port;
  t.after(() => created.server.close());

  const res = await httpGet(port, '/index.html');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const corpo = (await readBytes(res, 1000000, 1000)).toString('utf8');
  assert.ok(corpo.includes('TVmakina'), 'e a pagina do TVmakina');

  const lista = await httpGet(port, '/channels/canais-inicial.m3u');
  assert.equal(lista.statusCode, 200);
  const corpoLista = (await readBytes(lista, 1000000, 1000)).toString('utf8');
  assert.ok(corpoLista.startsWith('#EXTM3U'), 'a lista tambem e servida');

  const falta = await httpGet(port, '/nao-existe.html');
  assert.equal(falta.statusCode, 404);
  await readBytes(falta, 1000, 300);
});

test('/udp sem endereco devolve 400 com explicacao', async (t) => {
  const created = proxy.createServer({ port: 0, host: '127.0.0.1', quiet: true, root: ROOT });
  await new Promise((resolve) => created.server.listen(0, '127.0.0.1', resolve));
  const port = created.server.address().port;
  t.after(() => created.server.close());

  const res = await httpGet(port, '/udp/');
  assert.equal(res.statusCode, 400);
  const corpo = (await readBytes(res, 1000, 400)).toString('utf8');
  assert.match(corpo, /239\.1\.1\.1:1234/);
});
