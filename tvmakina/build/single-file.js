/* Gera o TVmakina num unico ficheiro HTML.
 *
 * dist/TVmakina.html          -> leve (~40 KB): HTML + CSS + JS, sem bibliotecas
 * dist/TVmakina-completo.html -> tudo incluido, com o motor HLS (~460 KB)
 *
 * O ficheiro leve pode ser aberto com duplo clique em qualquer browser e tambem
 * pode ser enviado por correio ou posto numa pen USB. Sem instalacao, sem Node.
 *
 * Uso: node build/single-file.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var outDir = path.join(root, 'dist');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function inlineHtml(html, opts) {
  var css = read('styles/tvmakina.css');
  var files = ['core', 'parser', 'store', 'net', 'lowend', 'player', 'ui', 'main'];
  var js = files.map(function (f) {
    return '/* ---- app/' + f + '.js ---- */\n' + read('app/' + f + '.js');
  }).join('\n');

  var out = html;

  /* CSS */
  out = out.replace(
    /<link rel="stylesheet" href="styles\/tvmakina\.css" \/>/,
    '<style>\n' + css + '\n</style>'
  );

  /* scripts da aplicacao */
  out = out.replace(
    /<script src="app\/core\.js"><\/script>[\s\S]*?<script src="app\/main\.js"><\/script>/,
    '<script>\n' + js + '\n</script>'
  );

  /* motor HLS */
  if (opts.withHls) {
    var hls = read('vendor/hls.min.js');
    out = out.replace(
      /<script src="vendor\/hls\.min\.js"><\/script>/,
      '<script>\n' + hls + '\n</script>'
    );
  } else {
    out = out.replace(
      /<script src="vendor\/hls\.min\.js"><\/script>/,
      '<!-- motor HLS nao incluido nesta versao: canais .m3u8 precisam de um browser com MSE\n' +
      '     ou do ficheiro TVmakina-completo.html -->'
    );
  }

  /* icone em linha (o ficheiro unico nao tem pasta icons/) */
  out = out.replace(
    /<link rel="icon" href="icons\/icon-64\.png" \/>/,
    '<link rel="icon" href="data:image/svg+xml,' + encodeURIComponent(ICON_SVG) + '" />'
  );

  return out;
}

var ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="10" fill="#05070d"/>' +
  '<rect x="10" y="18" width="44" height="30" rx="4" fill="#0b1020" stroke="#39d98a" stroke-width="2"/>' +
  '<rect x="15" y="23" width="34" height="20" fill="#39d98a"/>' +
  '<text x="32" y="39" font-family="monospace" font-size="16" font-weight="bold" ' +
  'text-anchor="middle" fill="#05070d">TV</text>' +
  '<path d="M22 14 L32 18 L42 14" stroke="#39d98a" stroke-width="2" fill="none"/>' +
  '</svg>';

function assertInlined(html, name) {
  var problems = [];
  var refs = html.match(/(?:src|href)="([^"#:][^"]*)"/g) || [];
  refs.forEach(function (r) {
    var value = r.replace(/^(?:src|href)="/, '').replace(/"$/, '');
    if (/^(https?:)?\/\//.test(value)) { return; }         /* exterior: aceitavel */
    if (/^data:/.test(value)) { return; }
    if (/^(app|styles|vendor|icons)\//.test(value)) {
      problems.push(name + ' ainda referencia ' + value);
    }
  });
  if (problems.length) {
    throw new Error('Ficheiro unico incompleto:\n  ' + problems.join('\n  '));
  }
}

function write(name, content) {
  if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }
  var full = path.join(outDir, name);
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

var html = read('index.html');

var leve = inlineHtml(html, { withHls: false });
assertInlined(leve, 'TVmakina.html');
var p1 = write('TVmakina.html', leve);

var completo = inlineHtml(html, { withHls: true });
assertInlined(completo, 'TVmakina-completo.html');
var p2 = write('TVmakina-completo.html', completo);

function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

console.log('TVmakina: ficheiro unico gerado');
console.log('  ' + path.relative(root, p1) + '   ' + kb(fs.statSync(p1).size) + '  (sem motor HLS)');
console.log('  ' + path.relative(root, p2) + '   ' + kb(fs.statSync(p2).size) + '  (com motor HLS)');
