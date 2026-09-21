/* TVmakina - preload do Electron
 * Corre com contextIsolation + sandbox; expoe uma superficie minima e segura.
 */
'use strict';

var fs = require('fs');
var electron = require('electron');
var contextBridge = electron.contextBridge;
var ipcRenderer = electron.ipcRenderer;

function readFileText(filePath, callback) {
  try {
    fs.readFile(filePath, 'utf8', function (err, data) {
      callback(err ? String(err.message) : null, err ? '' : String(data));
    });
  } catch (e) {
    callback(String(e.message), '');
  }
}

var api = {
  versao: '1.0.0',

  info: function () {
    return ipcRenderer.invoke('tvmakina:info');
  },

  escolherLista: function () {
    return ipcRenderer.invoke('tvmakina:abrir-lista-dialogo');
  },

  lerFicheiro: function (filePath) {
    return new Promise(function (resolve, reject) {
      readFileText(filePath, function (err, text) {
        if (err) { reject(new Error(err)); } else { resolve(text); }
      });
    });
  },

  /* recebe um canal aberto por linha de comandos ou por outra instancia */
  onOpenChannel: function (handler) {
    ipcRenderer.on('tvmakina:abrir-canal', function (event, payload) {
      try { handler(payload); } catch (e) { /* ignorar */ }
    });
  },

  onOpenFile: function (handler) {
    ipcRenderer.on('tvmakina:abrir-ficheiro', function (event, filePath) {
      readFileText(filePath, function (err, text) {
        try { handler({ path: filePath, error: err, text: text }); } catch (e) { /* ignorar */ }
      });
    });
  }
};

try {
  contextBridge.exposeInMainWorld('tvmakinaDesktop', api);
} catch (e) {
  /* Em modo de desenvolvimento sem contextIsolation */
  if (typeof window !== 'undefined') { window.tvmakinaDesktop = api; }
}
