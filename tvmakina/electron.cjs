/* TVmakina - processo principal do Electron (aplicacao para desktop)
 *
 * Electron 22.3.x = Chromium 108 = ultima versao que corre em Windows 7 / 8 / 8.1.
 * Tudo o que e "ajuste para PC fraco" esta em electron/config.cjs (testavel sem Electron).
 */
'use strict';

var path = require('path');
var os = require('os');
var electron = require('electron');

var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var shell = electron.shell;
var ipcMain = electron.ipcMain;
var Menu = electron.Menu;
var dialog = electron.dialog;

var cfg = require('./electron/config.cjs');

var win = null;
var pendingChannel = null;

/* Informacao real da maquina, lida do sistema operativo. */
function machineInfo() {
  var cores = 0;
  var ramMb = 0;
  try { cores = os.cpus().length; } catch (e) { cores = 0; }
  try { ramMb = Math.round(os.totalmem() / (1024 * 1024)); } catch (e2) { ramMb = 0; }
  var lowEnd = null;
  var argv = process.argv;
  if (argv.indexOf('--modo-leve') >= 0 || argv.indexOf('--low-end') >= 0) { lowEnd = true; }
  if (argv.indexOf('--modo-normal') >= 0) { lowEnd = false; }
  if (argv.indexOf('--gpu') >= 0) { return { cores: cores, ramMb: ramMb, lowEnd: lowEnd, hwAccel: true }; }
  /* Por omissao em Windows 7 desliga-se a GPU: drivers antigos = ecra preto. */
  var hwAccel = !(process.platform === 'win32' && parseFloat(os.release()) < 6.2);
  return { cores: cores, ramMb: ramMb, lowEnd: lowEnd, hwAccel: hwAccel };
}

function applySwitches(info) {
  var switches = cfg.buildSwitches(info);
  for (var i = 0; i < switches.length; i++) {
    var s = switches[i];
    var eq = s.indexOf('=');
    if (eq > 0) { app.commandLine.appendSwitch(s.substring(0, eq), s.substring(eq + 1)); }
    else { app.commandLine.appendSwitch(s); }
  }
}

function buildMenu() {
  var template = [
    {
      label: 'Ficheiro',
      submenu: [
        {
          label: 'Abrir lista de canais (M3U)...',
          click: function () {
            if (!win) { return; }
            dialog.showOpenDialog(win, {
              title: 'Abrir lista de canais',
              filters: [
                { name: 'Listas IPTV', extensions: ['m3u', 'm3u8', 'xspf', 'json', 'txt'] },
                { name: 'Todos os ficheiros', extensions: ['*'] }
              ]
            }).then(function (res) {
              if (res && !res.canceled && res.filePaths && res.filePaths.length) {
                win.webContents.send('tvmakina:abrir-ficheiro', res.filePaths[0]);
              }
            })['catch'](function () { /* ignorar */ });
          }
        },
        { type: 'separator' },
        { label: 'Sair', accelerator: 'Ctrl+Q', click: function () { app.quit(); } }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'togglefullscreen', label: 'Ecra inteiro' },
        { role: 'toggleDevTools', label: 'Ferramentas de programador' }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Atalhos de teclado',
          click: function () {
            var linhas = cfg.shortcuts().map(function (s) { return s.tecla + '  -  ' + s.accao; });
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'Atalhos',
              message: 'Atalhos do TVmakina',
              detail: linhas.join('\n')
            });
          }
        },
        {
          label: 'Acerca do TVmakina',
          click: function () {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'TVmakina',
              message: 'TVmakina 1.0.0',
              detail: 'Leitor IPTV leve para Windows 7 e PCs fracos.\n' +
                'Electron ' + process.versions.electron + ' / Chromium ' + process.versions.chrome +
                '\nNode ' + process.versions.node
            });
          }
        }
      ]
    }
  ];
  try { Menu.setApplicationMenu(Menu.buildFromTemplate(template)); } catch (e) { /* ignorar */ }
}

function createWindow() {
  var info = machineInfo();
  var opts = cfg.buildWindowOptions({
    preload: path.join(__dirname, 'electron', 'preload.cjs'),
    width: info.cores && info.cores <= 2 ? 1180 : 1280,
    height: info.ramMb && info.ramMb <= 3584 ? 720 : 800
  });

  win = new BrowserWindow(opts);

  win.once('ready-to-show', function () { win.show(); });

  win.webContents.setWindowOpenHandler(function (details) {
    if (/^https?:/i.test(details.url)) { shell.openExternal(details.url); }
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', function (event, code, description) {
    if (code === -3) { return; }  /* cancelado pelo utilizador */
    dialog.showErrorBox('Falha ao carregar a interface', code + ' ' + description);
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  if (pendingChannel) {
    win.webContents.once('did-finish-load', function () {
      win.webContents.send('tvmakina:abrir-canal', pendingChannel);
      pendingChannel = null;
    });
  }

  win.on('closed', function () { win = null; });
  return win;
}

/* Uma unica instancia: abrir o TVmakina outra vez sintoniza o canal na janela existente. */
function parseChannelArgv(argv) {
  for (var i = 1; i < argv.length; i++) {
    var a = argv[i];
    if (/^(https?|udp|rtp|file):/i.test(a)) {
      return { url: a, name: argv[i + 1] && argv[i + 1].charAt(0) !== '-' ? argv[i + 1] : '' };
    }
  }
  return null;
}

function registerIpc() {
  ipcMain.handle('tvmakina:info', function () {
    var info = machineInfo();
    return {
      plataforma: process.platform,
      versaoSO: os.release(),
      nucleos: info.cores,
      ramMb: info.ramMb,
      modoLeve: cfg.isLowEndMachine(info),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node
    };
  });

  ipcMain.handle('tvmakina:abrir-lista-dialogo', function () {
    if (!win) { return null; }
    return dialog.showOpenDialog(win, {
      title: 'Abrir lista de canais',
      filters: [{ name: 'Listas IPTV', extensions: ['m3u', 'm3u8', 'xspf', 'json', 'txt'] }]
    }).then(function (res) {
      return (res && !res.canceled && res.filePaths && res.filePaths.length) ? res.filePaths[0] : null;
    });
  });
}

var gotLock = true;
if (app.requestSingleInstanceLock) {
  gotLock = app.requestSingleInstanceLock();
}

if (!gotLock) {
  app.quit();
} else {
  if (app.on) {
    app.on('second-instance', function (event, argv) {
      var ch = parseChannelArgv(argv || []);
      if (win) {
        if (win.isMinimized()) { win.restore(); }
        win.focus();
        if (ch) { win.webContents.send('tvmakina:abrir-canal', ch); }
      }
    });
  }

  /* memoria do processo principal limitada ANTES de o Chromium arrancar */
  try {
    var memArgs = cfg.memoryArgv(machineInfo());
    for (var m = 0; m < memArgs.length; m++) {
      var parts = memArgs[m].split('=');
      app.commandLine.appendSwitch(parts[0].replace(/^--/, ''), parts[1]);
    }
  } catch (e) { /* ignorar */ }

  applySwitches(machineInfo());

  app.whenReady().then(function () {
    buildMenu();
    registerIpc();
    pendingChannel = parseChannelArgv(process.argv);
    createWindow();
    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) { createWindow(); }
    });
  });

  app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') { app.quit(); }
  });
}

module.exports = { machineInfo: machineInfo, parseChannelArgv: parseChannelArgv };
