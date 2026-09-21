/* Gera os icones do TVmakina (PNG + ICO multi-tamanho) sem dependencias externas.
 * Escreve PNG e ICO "a mao": o electron-builder aceita PNG dentro de ICO desde o Windows Vista.
 *
 * Uso: node build/make-icons.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var outDir = path.resolve(__dirname, '..', 'icons');

/* ---------------- PNG ---------------- */

var CRC_TABLE = (function () {
  var table = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  var sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    /* profundidade */
  ihdr[9] = 6;    /* RGBA */
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  var stride = width * 4;
  var raw = Buffer.alloc((stride + 1) * height);
  for (var y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;              /* filtro "none" */
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- desenho ---------------- */

function Canvas(size) {
  this.size = size;
  this.data = Buffer.alloc(size * size * 4);
}

Canvas.prototype.set = function (x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= this.size || y >= this.size) { return; }
  var i = (y * this.size + x) * 4;
  var alpha = (a === undefined ? 255 : a) / 255;
  var old = this.data;
  old[i] = Math.round(old[i] * (1 - alpha) + r * alpha);
  old[i + 1] = Math.round(old[i + 1] * (1 - alpha) + g * alpha);
  old[i + 2] = Math.round(old[i + 2] * (1 - alpha) + b * alpha);
  old[i + 3] = Math.min(255, Math.round(old[i + 3] + a));
};

Canvas.prototype.rect = function (x, y, w, h, c, a) {
  for (var j = y; j < y + h; j++) {
    for (var i = x; i < x + w; i++) { this.set(i, j, c[0], c[1], c[2], a); }
  }
};

Canvas.prototype.roundRect = function (x, y, w, h, radius, c, a) {
  for (var j = y; j < y + h; j++) {
    for (var i = x; i < x + w; i++) {
      var inside = true;
      var corners = [
        [x + radius, y + radius],
        [x + w - radius - 1, y + radius],
        [x + radius, y + h - radius - 1],
        [x + w - radius - 1, y + h - radius - 1]
      ];
      var inCornerZone = (i < x + radius || i > x + w - radius - 1) &&
        (j < y + radius || j > y + h - radius - 1);
      if (inCornerZone) {
        inside = false;
        for (var k = 0; k < 4; k++) {
          var dx = i - corners[k][0];
          var dy = j - corners[k][1];
          if (dx * dx + dy * dy <= radius * radius) { inside = true; break; }
        }
      }
      if (inside) { this.set(i, j, c[0], c[1], c[2], a); }
    }
  }
};

Canvas.prototype.line = function (x0, y0, x1, y1, thickness, c, a) {
  var steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
  var half = thickness / 2;
  for (var s = 0; s <= steps; s++) {
    var t = s / steps;
    var cx = x0 + (x1 - x0) * t;
    var cy = y0 + (y1 - y0) * t;
    for (var dy = -half; dy <= half; dy++) {
      for (var dx = -half; dx <= half; dx++) {
        if (dx * dx + dy * dy <= half * half) {
          this.set(cx + dx, cy + dy, c[0], c[1], c[2], a);
        }
      }
    }
  }
};

/* fonte 5x7 para desenhar "TV" */
var GLYPHS = {
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100']
};

Canvas.prototype.text = function (str, x, y, scale, c, a) {
  var cx = x;
  for (var s = 0; s < str.length; s++) {
    var g = GLYPHS[str.charAt(s)];
    if (!g) { cx += 6 * scale; continue; }
    for (var row = 0; row < 7; row++) {
      for (var col = 0; col < 5; col++) {
        if (g[row].charAt(col) === '1') {
          this.rect(cx + col * scale, y + row * scale, scale, scale, c, a);
        }
      }
    }
    cx += 6 * scale;
  }
};

function drawIcon(size) {
  var c = new Canvas(size);
  var u = size / 64;                       /* unidade de desenho */
  var bg = [5, 7, 13];
  var frame = [11, 16, 32];
  var green = [57, 217, 138];
  var dark = [5, 7, 13];

  /* fundo */
  c.roundRect(0, 0, size, size, 10 * u, bg, 255);

  /* antenas */
  c.line(22 * u, 14 * u, 32 * u, 19 * u, Math.max(1, 2 * u), green, 255);
  c.line(42 * u, 14 * u, 32 * u, 19 * u, Math.max(1, 2 * u), green, 255);

  /* corpo do televisor */
  c.roundRect(10 * u, 18 * u, 44 * u, 30 * u, 4 * u, frame, 255);
  c.roundRect(11 * u, 19 * u, 42 * u, 28 * u, 3 * u, green, 90);

  /* ecra */
  c.rect(15 * u, 23 * u, 34 * u, 20 * u, green, 255);

  /* linhas de varredura (o aspecto "CRT") */
  for (var y = 23 * u; y < 43 * u; y += Math.max(2, 2 * u)) {
    c.rect(15 * u, y, 34 * u, Math.max(1, u), dark, 40);
  }

  /* letras */
  var scale = Math.max(1, Math.round(2.2 * u));
  var textW = 11 * scale;
  c.text('TV', Math.round((size - textW) / 2), Math.round(27 * u), scale, dark, 255);

  /* pe */
  c.rect(26 * u, 49 * u, 12 * u, Math.max(1, 3 * u), frame, 255);
  c.rect(22 * u, 52 * u, 20 * u, Math.max(1, 2 * u), green, 200);

  return c.data;
}

/* ---------------- ICO ---------------- */

function buildIco(pngBuffers) {
  var count = pngBuffers.length;
  var header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);      /* tipo: icone */
  header.writeUInt16LE(count, 4);

  var entries = [];
  var offset = 6 + count * 16;
  pngBuffers.forEach(function (item) {
    var e = Buffer.alloc(16);
    e[0] = item.size >= 256 ? 0 : item.size;
    e[1] = item.size >= 256 ? 0 : item.size;
    e[2] = 0;                       /* paleta */
    e[3] = 0;                       /* reservado */
    e.writeUInt16LE(1, 4);          /* planos */
    e.writeUInt16LE(32, 6);         /* bits por pixel */
    e.writeUInt32LE(item.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += item.data.length;
    entries.push(e);
  });

  return Buffer.concat([header].concat(entries, pngBuffers.map(function (i) { return i.data; })));
}

/* ---------------- main ---------------- */

if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }

var sizes = [16, 24, 32, 48, 64, 128, 256];
var forIco = [];

sizes.forEach(function (s) {
  var png = encodePng(s, s, drawIcon(s));
  var file = path.join(outDir, 'icon-' + s + '.png');
  fs.writeFileSync(file, png);
  console.log('  icons/icon-' + s + '.png  ' + png.length + ' bytes');
  if (s <= 256) { forIco.push({ size: s, data: png }); }
});

var ico = buildIco(forIco.filter(function (i) { return [16, 32, 48, 64, 128, 256].indexOf(i.size) >= 0; }));
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('  icons/icon.ico  ' + ico.length + ' bytes (multi-tamanho)');

module.exports = { encodePng: encodePng, drawIcon: drawIcon, buildIco: buildIco };
