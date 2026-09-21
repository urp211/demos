/* Teste de ponta a ponta da interface real (index.html + app/*.js) dentro de um DOM. */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './env.mjs';

const M3U = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="rtp1" tvg-logo="http://exemplo/rtp1.png" group-title="Portugal",RTP 1 (720p) [Not 24/7]',
  'https://exemplo.test/rtp1.m3u8',
  '#EXTINF:-1 tvg-id="camara" group-title="Brasil",TV Camara',
  'https://exemplo.test/camara/index.m3u8',
  '#EXTINF:-1 tvg-id="udp1" group-title="Rede local",Canal Multicast',
  'udp://@239.10.20.30:1234',
  '#EXTINF:-1 tvg-id="rtsp1" group-title="Antigos",Camera RTSP',
  'rtsp://192.168.1.50:554/stream1',
  '#EXTINF:-1 group-title="Ficheiros",Video local',
  'file:///C:/Videos/demo.mp4'
].join('\n');

test('a aplicacao arranca no DOM e fica em modo leve nesta maquina de teste', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  assert.equal(typeof env.TV.VERSION, 'string');
  assert.ok(env.app.ui, 'a interface foi criada');
  assert.ok(env.app.player, 'o leitor foi criado');

  /* 2 nucleos + 3 GB declarados => modo leve automatico */
  assert.equal(env.document.documentElement.className.indexOf('modo-leve') >= 0, true,
    'o modo leve devia estar ligado');
  assert.equal(env.el('btn-lowend').className.indexOf('btn-on') >= 0, true);
  assert.ok(/modo leve/.test(env.text('machine-info')), env.text('machine-info'));
});

test('arranque sem listas: mostra o sinal de teste SMPTE', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  assert.equal(env.player.state(), 'a-reproduzir');
  assert.equal(env.text('now-name'), 'Sinal de teste (smpte)');
  assert.equal(env.el('test-canvas').style.display, 'block');
  assert.equal(env.text('st-state'), 'a reproduzir');
  /* o sinal de teste desenhou no canvas atraves do codigo real */
  assert.ok(env.ctxCalls.length > 5, 'esperava desenhos no canvas, obtive ' + env.ctxCalls.length);
  assert.ok(env.ctxCalls.some((c) => c[0] === 'fillRect'), 'esperava fillRect');
});

test('importar M3U pela caixa de texto preenche a lista virtualizada', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  env.click('btn-import');
  assert.equal(env.el('modal-import').className, 'modal');

  env.el('imp-text').value = M3U;
  env.click('imp-text-go');
  await env.tick(30);

  assert.equal(env.ui.allChannels().length, 5, 'devia ter importado 5 canais');
  assert.ok(/5 canais importados/.test(env.text('imp-status')), env.text('imp-status'));
  assert.equal(env.ui.channels().length, 4, 'o filtro "so reproduziveis" esconde o RTSP');
  assert.ok(/4 de 5 canais/.test(env.html('count-info')), env.html('count-info'));

  /* a lista e virtualizada: existem linhas no DOM */
  const rows = env.document.querySelectorAll('#list .row');
  assert.ok(rows.length >= 4, 'esperava linhas desenhadas, obtive ' + rows.length);
  assert.equal(rows[0].getAttribute('data-id'), 'rtp1-1');
});

test('clicar numa linha sintoniza o canal certo', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  env.ui.setChannels(env.TV.parsePlaylist(M3U, 'teste').channels, 'teste');
  await env.tick(20);

  const row = env.document.querySelector('#list .row[data-id="camara-2"]');
  assert.ok(row, 'a linha do canal TV Camara devia existir');
  row.dispatchEvent(new env.window.Event('click', { bubbles: true }));
  await env.tick(20);

  assert.equal(env.player.current().name, 'TV Camara');
  assert.equal(env.text('now-name'), 'TV Camara');
  assert.equal(env.text('now-meta'), 'HLS (HTTP Live Streaming)');
  assert.ok(env.document.querySelector('#list .row[data-id="camara-2"]').className.indexOf('active') >= 0,
    'a linha activa devia estar marcada');
  /* o URL real vai para o motor de video (aqui: HLS, que o jsdom nao tem) */
  assert.equal(env.TV.buildStreamUrl(env.player.current(), env.ui.settings()),
    'https://exemplo.test/camara/index.m3u8');
});

test('procura ignora acentos e maiusculas', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  env.ui.setChannels(env.TV.parsePlaylist(M3U, 'teste').channels, 'teste');
  env.el('search').value = 'camara';
  env.el('search').dispatchEvent(new env.window.Event('keyup', { bubbles: true }));
  await env.tick(260);
  assert.equal(env.ui.channels().length, 1);
  assert.equal(env.ui.channels()[0].name, 'TV Camara');

  env.el('search').value = 'PORTUGAL';
  env.el('search').dispatchEvent(new env.window.Event('keyup', { bubbles: true }));
  await env.tick(260);
  assert.equal(env.ui.channels().length, 1);
  assert.equal(env.ui.channels()[0].name, 'RTP 1 (720p)');
});

test('favoritos: tecla F marca o canal e fica guardado', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  env.ui.setChannels(env.TV.parsePlaylist(M3U, 'teste').channels, 'teste');
  env.ui.playChannel(env.ui.allChannels()[0]);
  await env.tick(20);

  env.key(70); /* F */
  await env.tick(10);
  assert.equal(env.TV.Store.loadFavourites()[env.ui.allChannels()[0].id], 1);
  assert.equal(env.html('btn-fav'), '\u2605', 'estrela cheia');

  env.key(70);
  await env.tick(10);
  assert.equal(env.TV.Store.loadFavourites()[env.ui.allChannels()[0].id], undefined);
});

test('Page Down passa ao canal seguinte', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  env.ui.setChannels(env.TV.parsePlaylist(M3U, 'teste').channels, 'teste');
  env.ui.playChannel(env.ui.channels()[0]);
  await env.tick(20);
  assert.equal(env.player.current().name, 'RTP 1 (720p)');

  env.key(34); /* PageDown */
  await env.tick(20);
  assert.equal(env.player.current().name, 'TV Camara');

  env.key(33); /* PageUp */
  await env.tick(20);
  assert.equal(env.player.current().name, 'RTP 1 (720p)');
});

test('teclas 0-9 sintonizam por numero', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  env.ui.setChannels(env.TV.parsePlaylist(M3U, 'teste').channels, 'teste');
  env.key(50); /* "2" */
  await env.tick(1000);
  assert.equal(env.player.current().name, 'TV Camara');
});

test('gravacao usa o MediaRecorder real da pagina e cria o ficheiro', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  env.ui.setChannels(env.TV.parsePlaylist(M3U, 'teste').channels, 'teste');
  env.ui.playChannel(env.ui.allChannels()[0]);
  await env.tick(20);

  env.click('btn-rec');
  await env.tick(40);
  assert.equal(env.el('btn-rec').className.indexOf('rec-on') >= 0, true, 'botao em gravacao');
  assert.equal(env.el('st-rec').className.indexOf('hidden') >= 0, false, 'indicador visivel');

  env.click('btn-rec');
  await env.tick(60);
  assert.equal(env.el('btn-rec').className.indexOf('rec-on') >= 0, false, 'gravacao parada');
  assert.equal(env.window.__createdUrls.length, 1, 'um ficheiro foi criado para descarga');
  assert.ok(env.window.__createdUrls[0].size > 0, 'o ficheiro tem dados');
});

test('modo leve pode ser desligado e volta a guardar a preferencia', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  assert.equal(env.document.documentElement.className.indexOf('modo-leve') >= 0, true);
  env.click('btn-lowend');
  await env.tick(20);
  assert.equal(env.document.documentElement.className.indexOf('modo-leve') >= 0, false);
  assert.equal(env.ui.settings().lowEnd, false);
  assert.equal(env.TV.Store.loadSettings().lowEnd, false, 'preferencia guardada');

  env.click('btn-lowend');
  await env.tick(20);
  assert.equal(env.document.documentElement.className.indexOf('modo-leve') >= 0, true);
});

test('o ultimo canal fica guardado para retomar no proximo arranque', async (t) => {
  const env = await loadApp();
  env.ui.setChannels(env.TV.parsePlaylist(M3U, 'teste').channels, 'teste');
  env.ui.playChannel(env.ui.allChannels()[1]);
  await env.tick(20);
  const guardado = env.TV.Store.get('last', null);
  assert.equal(guardado.name, 'TV Camara');
  assert.equal(guardado.url, 'https://exemplo.test/camara/index.m3u8');
  env.close();
});

test('canal HLS sem MSE no browser: avisa em vez de ficar em silencio', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  /* o jsdom nao tem MediaSource, tal como um browser antigo sem MSE */
  assert.equal(env.TV.mseSupported(), false);
  const hls = env.TV.parsePlaylist('https://exemplo.test/a/index.m3u8', 'x').channels[0];
  assert.equal(hls.kind, 'hls');
  env.ui.playChannel(hls);
  await env.tick(20);

  assert.equal(env.player.state(), 'erro');
  assert.ok(/Firefox 115 ESR/.test(env.text('overlay-msg')), env.text('overlay-msg'));
  assert.equal(env.el('st-state').textContent, 'ERRO');
});

test('o estado de erro mostra a razao e oferece o canal seguinte', async (t) => {
  const env = await loadApp();
  t.after(() => env.close());

  env.ui.setChannels(env.TV.parsePlaylist(M3U, 'teste').channels, 'teste');
  const rtsp = env.TV.parsePlaylist('rtsp://192.168.1.50:554/s1', 'x').channels[0];
  assert.equal(rtsp.kind, 'unsupported');
  env.ui.playChannel(rtsp);
  await env.tick(20);

  assert.equal(env.player.state(), 'erro');
  assert.equal(env.el('player-overlay').className.indexOf('hidden') >= 0, false, 'aviso visivel');
  assert.ok(/RTSP/.test(env.text('overlay-msg')), env.text('overlay-msg'));
  assert.equal(env.el('btn-next-err').className.indexOf('hidden') >= 0, false, 'botao "seguinte" visivel');
});
