/* Testes do analisador de listas e da construcao de URLs (codigo real, sem DOM). */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* Os modulos da aplicacao sao ES5 e detectam o ambiente: em Node devolvem-se a si proprios. */
const TV = require(path.join(ROOT, 'app', 'core.js'));
require(path.join(ROOT, 'app', 'parser.js'));

test('M3U com atributos EXTINF e opcoes VLC', () => {
  const texto = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="rtp1.pt" tvg-logo="http://logo/rtp1.png" group-title="Portugal",RTP 1 (720p) [Not 24/7]',
    '#EXTVLCOPT:http-user-agent=Mozilla/5.0 (Windows NT 7)',
    '#EXTVLCOPT:http-referrer=http://exemplo.test/',
    'https://exemplo.test/rtp1.m3u8',
    '#EXTINF:-1 tvg-id="udp" group-title="Rede",Canal UDP',
    'udp://@239.1.1.1:5000',
    '#EXTINF:-1,Camara antiga',
    'rtsp://10.0.0.5:554/s1',
    'http://sem-extinf.test/directo.ts'
  ].join('\r\n');

  const res = TV.parseM3U(texto, 'teste.m3u');
  assert.equal(res.channels.length, 4);

  const rtp = res.channels[0];
  assert.equal(rtp.name, 'RTP 1 (720p)', 'o sufixo [Not 24/7] sai do nome');
  assert.equal(rtp.group, 'Portugal');
  assert.equal(rtp.logo, 'http://logo/rtp1.png');
  assert.equal(rtp.tvgId, 'rtp1.pt');
  assert.equal(rtp.kind, 'hls');
  assert.equal(rtp.resolution, 720);
  assert.equal(rtp.userAgent, 'Mozilla/5.0 (Windows NT 7)');
  assert.equal(rtp.httpReferer, 'http://exemplo.test/');

  assert.equal(res.channels[1].kind, 'udp');
  assert.equal(res.channels[2].kind, 'unsupported', 'RTSP nao e reproduzivel no browser');
  assert.equal(res.channels[3].kind, 'native', 'URL sem EXTINF tambem entra');
  assert.equal(res.channels[3].name, 'directo.ts');
});

test('M3U real do repositorio: catalogo PT', () => {
  const texto = fs.readFileSync(path.join(ROOT, 'channels', 'catalogo', 'pt.m3u'), 'utf8');
  const res = TV.parsePlaylist(texto, 'pt.m3u');
  assert.ok(res.channels.length > 20, 'esperava dezenas de canais, obtive ' + res.channels.length);
  /* o catalogo iptv-org nao usa group-title: tudo cai em "Sem grupo" e e esperado */
  const comId = res.channels.filter((c) => !!c.tvgId).length;
  assert.ok(comId > 10, 'a maioria traz tvg-id, obtive ' + comId);
  const hls = res.channels.filter((c) => c.kind === 'hls').length;
  assert.ok(hls > 10, 'ha canais HLS, obtive ' + hls);
  assert.ok(res.channels.every((c) => !!c.url), 'todos os canais tem URL');
  assert.ok(res.channels.every((c) => !!c.id), 'todos os canais tem id unico');
  const ids = {};
  res.channels.forEach((c) => { ids[c.id] = (ids[c.id] || 0) + 1; });
  assert.ok(Object.keys(ids).every((k) => ids[k] === 1), 'os ids nao se repetem');
});

test('a lista de arranque incluida e valida e traz testes, HLS, UDP e ficheiros', () => {
  const texto = fs.readFileSync(path.join(ROOT, 'channels', 'canais-inicial.m3u'), 'utf8');
  const res = TV.parsePlaylist(texto, 'canais-inicial.m3u');
  const tipos = {};
  res.channels.forEach((c) => { tipos[c.kind] = (tipos[c.kind] || 0) + 1; });
  assert.ok(tipos.test >= 4, 'quatro sinais de teste: ' + JSON.stringify(tipos));
  assert.ok(tipos.hls >= 10, 'canais HLS: ' + JSON.stringify(tipos));
  assert.ok(tipos.udp >= 2, 'exemplos UDP: ' + JSON.stringify(tipos));
  assert.ok(tipos.native >= 1, 'exemplo de ficheiro local: ' + JSON.stringify(tipos));
});

test('XSPF (VLC)', () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<playlist xmlns="http://xspf.org/ns/0/" version="1">',
    '<trackList>',
    '<track><location>http://exemplo.test/a.m3u8</location><title>Canal A</title>',
    '<album>Grupo A</album><image>http://logo/a.png</image></track>',
    '<track><location><![CDATA[http://exemplo.test/b.ts]]></location><title>Canal B</title></track>',
    '<track><title>sem location</title></track>',
    '</trackList></playlist>'
  ].join('\n');
  const res = TV.parsePlaylist(xml, 'lista.xspf');
  assert.equal(res.format, 'xspf');
  assert.equal(res.channels.length, 2, 'a faixa sem <location> e ignorada');
  assert.equal(res.channels[0].name, 'Canal A');
  assert.equal(res.channels[0].group, 'Grupo A');
  assert.equal(res.channels[0].logo, 'http://logo/a.png');
  assert.equal(res.channels[1].kind, 'native');
});

test('JSON', () => {
  const json = JSON.stringify({
    channels: [
      { name: 'Um', url: 'http://a.test/1.m3u8', group: 'G1' },
      { title: 'Dois', src: 'http://a.test/2.ts' },
      { name: 'sem url' }
    ]
  });
  const res = TV.parsePlaylist(json, 'lista.json');
  assert.equal(res.format, 'json');
  assert.equal(res.channels.length, 2);
  assert.equal(res.channels[1].name, 'Dois');
  assert.equal(res.channels[1].group, 'Sem grupo');
});

test('texto simples: um URL por linha', () => {
  const res = TV.parsePlaylist('http://a.test/1.ts\n\n# comentario\nudp://@239.9.9.9:1234\n', 'urls.txt');
  assert.equal(res.format, 'texto');
  assert.equal(res.channels.length, 2);
});

test('duplicados sao removidos', () => {
  const texto = [
    '#EXTM3U',
    '#EXTINF:-1,Canal', 'http://a.test/x.m3u8',
    '#EXTINF:-1,Canal', 'http://a.test/x.m3u8'
  ].join('\n');
  assert.equal(TV.parsePlaylist(texto, 'd').channels.length, 1);
});

test('agrupamento e filtro', () => {
  const canais = TV.parsePlaylist([
    '#EXTM3U',
    '#EXTINF:-1 group-title="Zebra",B canal', 'http://a.test/2.ts',
    '#EXTINF:-1 group-title="Abc",A canal', 'http://a.test/1.ts',
    '#EXTINF:-1 group-title="Abc",C canal', 'http://a.test/3.ts',
    '#EXTINF:-1 group-title="Abc",Camara antiga', 'rtsp://x/y'
  ].join('\n'), 'g').channels;

  const grupos = TV.groupChannels(canais);
  assert.deepEqual(grupos.map((g) => g.name), ['Abc', 'Zebra'], 'ordem alfabetica');
  assert.deepEqual(grupos[0].channels.map((c) => c.name), ['A canal', 'C canal', 'Camara antiga']);

  const soAbc = TV.filterChannels(canais, '', { group: 'Abc' });
  assert.equal(soAbc.length, 3);

  const reproduziveis = TV.filterChannels(canais, '', { onlyPlayable: true });
  assert.equal(reproduziveis.length, 3, 'o RTSP fica de fora');

  const procura = TV.filterChannels(canais, 'camara');
  assert.equal(procura.length, 1);
  assert.equal(procura[0].name, 'Camara antiga');
});

test('deteccao de tipo de stream', () => {
  const casos = [
    ['http://a/x.m3u8', 'hls'],
    ['https://a/x.M3U8?token=1', 'hls'],
    ['http://a/x.ts', 'native'],
    ['http://a/x.mp4', 'native'],
    ['http://a/stream', 'native'],
    ['udp://@239.1.1.1:1234', 'udp'],
    ['rtp://@239.1.1.1:1234', 'udp'],
    ['rtsp://a/b', 'unsupported'],
    ['rtmp://a/b', 'unsupported'],
    ['mms://a/b', 'unsupported'],
    ['test:smpte', 'test'],
    ['file:///C:/v/x.mp4', 'native'],
    ['', 'none']
  ];
  casos.forEach((c) => assert.equal(TV.detectStreamType(c[0]), c[1], c[0]));
});

test('multicast e enderecos', () => {
  assert.equal(TV.isMulticast('239.1.1.1'), true);
  assert.equal(TV.isMulticast('224.0.0.1'), true);
  assert.equal(TV.isMulticast('232.255.255.255'), true);
  assert.equal(TV.isMulticast('192.168.1.1'), false);
  assert.equal(TV.isMulticast('240.0.0.1'), false);
  assert.equal(TV.isValidIpv4('192.168.1.10'), true);
  assert.equal(TV.isValidIpv4('999.1.1.1'), false);
});

test('parseUdpTarget aceita as formas todas', () => {
  let t = TV.parseUdpTarget('udp://@239.1.1.1:1234');
  assert.equal(t.group, '239.1.1.1');
  assert.equal(t.port, 1234);

  t = TV.parseUdpTarget('239.1.1.1:5000');
  assert.equal(t.port, 5000);

  t = TV.parseUdpTarget('udp://@239.1.1.1:5000?interface=192.168.1.10');
  assert.equal(t.iface, '192.168.1.10');

  t = TV.parseUdpTarget('udp://192.168.1.10@239.1.1.1:5000');
  assert.equal(t.iface, '192.168.1.10');
  assert.equal(t.group, '239.1.1.1');
});

test('buildStreamUrl: UDP passa pelo proxy, o resto nao', () => {
  const settings = { proxy: '127.0.0.1:4022' };
  const udp = { url: 'udp://@239.10.20.30:1234', kind: 'udp' };
  assert.equal(TV.buildStreamUrl(udp, settings), 'http://127.0.0.1:4022/udp/239.10.20.30:1234');

  const udpIface = { url: 'udp://@239.10.20.30:1234?interface=192.168.1.5', kind: 'udp' };
  assert.equal(
    TV.buildStreamUrl(udpIface, settings),
    'http://127.0.0.1:4022/udp/239.10.20.30:1234?interface=192.168.1.5'
  );

  const hls = { url: 'https://a.test/x.m3u8', kind: 'hls' };
  assert.equal(TV.buildStreamUrl(hls, settings), 'https://a.test/x.m3u8');

  const semProxy = TV.buildStreamUrl(udp, { proxy: '10.0.0.9:8080' });
  assert.equal(semProxy, 'http://10.0.0.9:8080/udp/239.10.20.30:1234');
});

test('formatacoes usadas na barra de estado', () => {
  assert.equal(TV.formatBitrate(0), '--');
  assert.equal(TV.formatBitrate(850000), '850 kb/s');
  assert.equal(TV.formatBitrate(2500000), '2.5 Mb/s');
  assert.equal(TV.formatBytes(2048), '2 KB');
  assert.equal(TV.formatDuration(75), '01:15');
  assert.equal(TV.formatDuration(3671), '1:01:11');
  assert.equal(TV.fold('AÇÃO Televisão'), 'acao televisao');
});
