/* Tiny offline PDF writer for DB Board Labeller.
   Units are millimetres, origin top-left. Fonts: Helvetica / Helvetica-Bold (WinAnsi).
   Images: JPEG data URLs (embedded directly with DCTDecode). */
(function (global) {
  'use strict';
  var WIDTHS = {"R":[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,278,222,556,333,1000,556,556,333,1000,667,333,1000,278,611,278,278,222,222,333,333,350,556,1000,333,1000,500,333,944,278,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],"B":[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,278,278,556,500,1000,556,556,333,1000,667,333,1000,278,611,278,278,278,278,500,500,350,556,1000,333,1000,556,333,944,278,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556]};
  var K = 72 / 25.4; // mm -> pt
  var WIN = {0x20AC:128,0x201A:130,0x0192:131,0x201E:132,0x2026:133,0x2020:134,0x2021:135,0x02C6:136,0x2030:137,0x0160:138,0x2039:139,0x0152:140,0x017D:142,0x2018:145,0x2019:146,0x201C:147,0x201D:148,0x2022:149,0x2013:150,0x2014:151,0x02DC:152,0x2122:153,0x0161:154,0x203A:155,0x0153:156,0x017E:158,0x0178:159,0x2212:45};

  function encode(str) {
    var out = [];
    str = String(str == null ? '' : str);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) { i++; out.push(63); continue; }
      if (c >= 32 && c < 127) out.push(c);
      else if (c >= 160 && c <= 255) out.push(c);
      else if (WIN[c]) out.push(WIN[c]);
      else if (c === 9 || c === 10 || c === 13) out.push(32);
      else out.push(63);
    }
    return out;
  }
  function textWidth(str, sizePt, bold) {
    var w = WIDTHS[bold ? 'B' : 'R'], codes = encode(str), sum = 0;
    for (var i = 0; i < codes.length; i++) sum += w[codes[i] - 32] || 556;
    return sum * sizePt / 1000 / K; // mm
  }
  function escapeCodes(codes) {
    var s = '';
    for (var i = 0; i < codes.length; i++) {
      var b = codes[i];
      if (b === 40 || b === 41 || b === 92) s += '\\' + String.fromCharCode(b);
      else if (b < 32 || b > 126) s += '\\' + ('00' + b.toString(8)).slice(-3);
      else s += String.fromCharCode(b);
    }
    return s;
  }
  function n(v) { return (Math.round(v * 100) / 100).toString(); }
  function hexRgb(c) {
    if (Array.isArray(c)) return c;
    c = String(c).replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    return [parseInt(c.substr(0, 2), 16), parseInt(c.substr(2, 2), 16), parseInt(c.substr(4, 2), 16)];
  }
  function rgbOp(c, op) { var a = hexRgb(c); return n(a[0] / 255) + ' ' + n(a[1] / 255) + ' ' + n(a[2] / 255) + ' ' + op; }
  function b64ToBytes(b64) {
    var bin = atob(b64), len = bin.length, out = new Uint8Array(len);
    for (var i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function jpegInfo(b) {
    if (b[0] !== 0xFF || b[1] !== 0xD8) throw new Error('Not a JPEG image');
    var i = 2;
    while (i < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      var m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { i += 2; continue; }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], c: b[i + 9] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    throw new Error('JPEG size not found');
  }

  function Doc() {
    this.pages = [];
    this.images = [];
    this.imgByKey = {};
    this.cur = null;
    this.bold = false;
    this.size = 10;
  }
  var A4 = { p: [210, 297], l: [297, 210] };
  Doc.prototype.addPage = function (orient) {
    var d = A4[orient === 'l' ? 'l' : 'p'];
    this.cur = { w: d[0], h: d[1], ops: [] };
    this.pages.push(this.cur);
    this.pageIndex = this.pages.length - 1;
    return this;
  };
  Doc.prototype.setPage = function (i) { this.cur = this.pages[i]; this.pageIndex = i; return this; };
  Doc.prototype.get = function () { return this.cur; };
  Doc.prototype.width = function () { return this.cur.w; };
  Doc.prototype.height = function () { return this.cur.h; };
  Doc.prototype.op = function (s) { this.cur.ops.push(s); };
  Doc.prototype.font = function (bold, size) { this.bold = !!bold; if (size) this.size = size; return this; };
  Doc.prototype.fill = function (c) { this.op(rgbOp(c, 'rg')); return this; };
  Doc.prototype.stroke = function (c) { this.op(rgbOp(c, 'RG')); return this; };
  Doc.prototype.lineWidth = function (mm) { this.op(n(mm * K) + ' w'); return this; };
  Doc.prototype.textWidth = function (s, size, bold) { return textWidth(s, size == null ? this.size : size, bold == null ? this.bold : bold); };
  // y = baseline (mm from top). opts: align left|center|right, color
  Doc.prototype.text = function (str, x, y, opts) {
    opts = opts || {};
    var w = this.textWidth(str);
    if (opts.align === 'center') x -= w / 2; else if (opts.align === 'right') x -= w;
    if (opts.color) this.fill(opts.color);
    this.op('BT /' + (this.bold ? 'F2' : 'F1') + ' ' + n(this.size) + ' Tf ' + n(x * K) + ' ' + n((this.cur.h - y) * K) + ' Td (' + escapeCodes(encode(str)) + ') Tj ET');
    return this;
  };
  // Split text into lines that fit maxW (mm) at current font
  Doc.prototype.wrap = function (str, maxW, size, bold) {
    size = size == null ? this.size : size; bold = bold == null ? this.bold : bold;
    var out = [];
    String(str == null ? '' : str).split(/\r?\n/).forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (word) {
        var test = line ? line + ' ' + word : word;
        if (textWidth(test, size, bold) <= maxW) { line = test; return; }
        if (line) out.push(line);
        // break long words
        while (textWidth(word, size, bold) > maxW && word.length > 1) {
          var k = word.length - 1;
          while (k > 1 && textWidth(word.slice(0, k), size, bold) > maxW) k--;
          out.push(word.slice(0, k)); word = word.slice(k);
        }
        line = word;
      });
      out.push(line);
    });
    return out;
  };
  Doc.prototype.rect = function (x, y, w, h, mode) {
    this.op(n(x * K) + ' ' + n((this.cur.h - y - h) * K) + ' ' + n(w * K) + ' ' + n(h * K) + ' re ' + (mode === 'F' ? 'f' : mode === 'FD' ? 'B' : 'S'));
    return this;
  };
  Doc.prototype.line = function (x1, y1, x2, y2) {
    var H = this.cur.h;
    this.op(n(x1 * K) + ' ' + n((H - y1) * K) + ' m ' + n(x2 * K) + ' ' + n((H - y2) * K) + ' l S');
    return this;
  };
  Doc.prototype.dash = function (on) { this.op(on ? '[' + n(on * K) + ' ' + n(on * K) + '] 0 d' : '[] 0 d'); return this; };
  Doc.prototype.image = function (dataUrl, x, y, w, h) {
    var img = this.imgByKey[dataUrl];
    if (!img) {
      var b64 = dataUrl.slice(dataUrl.indexOf(',') + 1), bytes = b64ToBytes(b64), info = jpegInfo(bytes);
      img = { name: 'Im' + (this.images.length + 1), bytes: bytes, w: info.w, h: info.h, c: info.c };
      this.images.push(img); this.imgByKey[dataUrl] = img;
    }
    this.op('q ' + n(w * K) + ' 0 0 ' + n(h * K) + ' ' + n(x * K) + ' ' + n((this.cur.h - y - h) * K) + ' cm /' + img.name + ' Do Q');
    return this;
  };
  Doc.prototype.imageSize = function (dataUrl) {
    var b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return jpegInfo(b64ToBytes(b64.slice(0, 200000)));
  };
  Doc.prototype.output = function () {
    var chunks = [], offset = 0, offsets = [];
    var te = new TextEncoder();
    function add(x) { var b = typeof x === 'string' ? te.encode(x) : x; chunks.push(b); offset += b.length; }
    add('%PDF-1.4\n'); add(new Uint8Array([37, 226, 227, 207, 211, 10]));
    var objCount = 0;
    function begin() { objCount++; offsets[objCount] = offset; add(objCount + ' 0 obj\n'); return objCount; }
    var imgStart = 5, pageStart = imgStart + this.images.length;
    // 1 catalog
    begin(); add('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    // 2 pages
    begin();
    var kids = [];
    for (var i = 0; i < this.pages.length; i++) kids.push((pageStart + i * 2) + ' 0 R');
    add('<< /Type /Pages /Count ' + this.pages.length + ' /Kids [' + kids.join(' ') + '] >>\nendobj\n');
    // 3,4 fonts
    begin(); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
    begin(); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');
    var xo = [];
    this.images.forEach(function (img) {
      var id = begin();
      xo.push('/' + img.name + ' ' + id + ' 0 R');
      var cs = img.c === 1 ? '/DeviceGray' : img.c === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
      add('<< /Type /XObject /Subtype /Image /Width ' + img.w + ' /Height ' + img.h + ' /ColorSpace ' + cs +
        ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.bytes.length + ' >>\nstream\n');
      add(img.bytes); add('\nendstream\nendobj\n');
    });
    var res = '<< /Font << /F1 3 0 R /F2 4 0 R >>' + (xo.length ? ' /XObject << ' + xo.join(' ') + ' >>' : '') + ' >>';
    this.pages.forEach(function (p) {
      var pid = begin();
      add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + n(p.w * K) + ' ' + n(p.h * K) + '] /Resources ' + res + ' /Contents ' + (pid + 1) + ' 0 R >>\nendobj\n');
      var content = p.ops.join('\n');
      begin(); add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n');
    });
    var xref = offset;
    var x = 'xref\n0 ' + (objCount + 1) + '\n0000000000 65535 f \n';
    for (var j = 1; j <= objCount; j++) x += ('0000000000' + offsets[j]).slice(-10) + ' 00000 n \n';
    add(x + 'trailer\n<< /Size ' + (objCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(chunks, { type: 'application/pdf' });
  };

  global.MiniPDF = { Doc: Doc, textWidth: textWidth };
})(window);
