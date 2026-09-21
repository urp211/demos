/* Verifica que o codigo da aplicacao continua a ser ES5 puro.
 *
 * Por que isto importa: no Windows 7 o browser mais recente possivel e o
 * Chromium 109 / Firefox 115 ESR, e o Electron compativel traz o Chromium 108.
 * Uma unica seta "=>" ou um "const" parte tudo nesses motores.
 *
 * Uso: node build/check-es5.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var acorn = require('acorn');

var root = path.resolve(__dirname, '..');

var TARGETS = [
  { dir: 'app', ecmaVersion: 5, descricao: 'codigo da aplicacao (tem de ser ES5)' },
  { dir: 'vendor', ecmaVersion: 2017, descricao: 'bibliotecas de terceiros' }
];

var EXTRA_FILES = [
  { file: 'build/single-file.js', ecmaVersion: 2019 },
  { file: 'build/check-es5.js', ecmaVersion: 2019 },
  { file: 'build/make-icons.js', ecmaVersion: 2019 },
  { file: 'server/proxy.js', ecmaVersion: 2019 },
  { file: 'electron.cjs', ecmaVersion: 2019 },
  { file: 'electron/config.cjs', ecmaVersion: 2019 },
  { file: 'electron/preload.cjs', ecmaVersion: 2019 }
];

function listJs(dir) {
  var full = path.join(root, dir);
  if (!fs.existsSync(full)) { return []; }
  return fs.readdirSync(full).filter(function (f) { return /\.js$/.test(f); }).sort();
}

var errors = 0;
var checked = 0;

function check(relPath, ecmaVersion) {
  var full = path.join(root, relPath);
  if (!fs.existsSync(full)) {
    console.log('  AVISO  ' + relPath + ' nao existe');
    return;
  }
  var code = fs.readFileSync(full, 'utf8');
  checked++;
  try {
    acorn.parse(code, {
      ecmaVersion: ecmaVersion,
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowHashBang: true
    });
    console.log('  OK     ' + relPath + '  (ES' + ecmaVersion + ', ' + code.length + ' bytes)');
  } catch (e) {
    errors++;
    console.log('  ERRO   ' + relPath + '  ->  ' + e.message);
  }
}

console.log('TVmakina: verificacao de compatibilidade de sintaxe');
TARGETS.forEach(function (t) {
  console.log('\n' + t.dir + '/ - ' + t.descricao);
  listJs(t.dir).forEach(function (f) { check(t.dir + '/' + f, t.ecmaVersion); });
});

console.log('\nficheiros de ferramenta (Node moderno)');
EXTRA_FILES.forEach(function (t) { check(t.file, t.ecmaVersion); });

console.log('\n' + checked + ' ficheiros verificados, ' + errors + ' erro(s).');
if (errors) {
  console.log('O codigo da aplicacao tem de continuar em ES5 para correr em PCs fracos.');
  process.exit(1);
}
