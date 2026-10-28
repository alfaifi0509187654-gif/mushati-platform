/* محرك قراءة الملفات العربي — المرحلة الثانية والثالثة
 * يحفظ النص صفحة/شريحةً صفحة مع المصدر ودرجة الثقة عند استخدام OCR.
 * لا يعتمد أي سؤال تلقائيًا؛ الأسئلة الناتجة تكون مقترحة للمراجعة.
 */
(function (root) {
  'use strict';
  var OCR = {}, scripts = {};
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  var PDF_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
  var PDF_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
  var JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  function loadScript(url) {
    if (scripts[url]) return scripts[url];
    scripts[url] = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = url;
      s.onload = resolve; s.onerror = function () { reject(new Error('تعذر تحميل مكتبة قراءة الملفات')); };
      document.head.appendChild(s);
    });
    return scripts[url];
  }
  function ext(file) { return String(file.name || '').split('.').pop().toLowerCase(); }
  function progress(cb, value, label) { if (typeof cb === 'function') cb({ progress: value, status: label || '' }); }
  function decodeXml(s) { var d = document.createElement('textarea'); d.innerHTML = s; return d.value; }
  function xmlText(s) {
    /* يحافظ على فواصل الفقرات والخلايا حتى لا تتحول أسئلة DOCX إلى سطر واحد. */
    return decodeXml(String(s || '')
      .replace(/<w:tab\/?\s*>/g, '\t')
      .replace(/<w:br\/?\s*>/g, '\n')
      .replace(/<a:br\/?\s*>/g, '\n')
      .replace(/<\/w:p\s*>/g, '\n')
      .replace(/<\/w:tr\s*>/g, '\n')
      .replace(/<\/w:tc\s*>/g, '\t')
      .replace(/<p:sp\b[^>]*>/g, '\n')
      .replace(/<\/a:p\s*>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n').trim());
  }
  async function workerFor(options) {
    await loadScript(TESS_URL);
    if (!root.Tesseract || !root.Tesseract.createWorker) throw new Error('محرك OCR غير متاح');
    return root.Tesseract.createWorker('ara+eng', 1, { logger: function (m) { progress(options && options.onProgress, m.progress || 0, m.status || 'OCR'); } });
  }
  async function recognizeCanvas(canvas, pageNumber, options, worker) {
    var result = await worker.recognize(canvas), data = result && result.data || {};
    var page = { pageNumber: pageNumber, text: String(data.text || '').trim(), confidence: Number(data.confidence || 0), ocr: true };
    if (typeof options.onPage === 'function') options.onPage(page);
    return page;
  }
  OCR.extractImage = async function (file, options) {
    options = options || {}; var worker = await workerFor(options);
    try {
      var bitmap = await createImageBitmap(file), canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d').drawImage(bitmap, 0, 0);
      var page = await recognizeCanvas(canvas, 1, options, worker);
      return { fileName: file.name, pages: [page], text: page.text, ocrUsed: true, sourceType: 'image' };
    } finally { await worker.terminate(); }
  };
  OCR.extractScannedPdf = async function (file, options) {
    options = options || {}; var pdfjs = root.pdfjsLib;
    if (!pdfjs) { pdfjs = await import(PDF_URL); }
    if (pdfjs && pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    var pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    var worker = await workerFor(options), pages = [];
    try {
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i), viewport = page.getViewport({ scale: options.scale || 2 });
        var canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
        pages.push(await recognizeCanvas(canvas, i, options, worker)); progress(options.onProgress, i / pdf.numPages, 'صفحة ' + i + ' من ' + pdf.numPages);
      }
    } finally { await worker.terminate(); }
    return { fileName: file.name, pages: pages, pageCount: pdf.numPages, text: pages.map(function (p) { return p.text; }).join('\n'), ocrUsed: true, sourceType: 'scanned-pdf' };
  };
  async function extractOffice(file, kind, options) {
    await loadScript(JSZIP_URL); if (!root.JSZip) throw new Error('قارئ المستندات غير متاح');
    var zip = await root.JSZip.loadAsync(await file.arrayBuffer()), names = Object.keys(zip.files), pages = [];
    var wanted = kind === 'docx' ? names.filter(function (n) { return n === 'word/document.xml'; }) : names.filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); }).sort(function (a,b) { return a.localeCompare(b, undefined, { numeric: true }); });
    if (!wanted.length) throw new Error('لم يتم العثور على محتوى قابل للقراءة داخل الملف');
    for (var i = 0; i < wanted.length; i++) {
      var raw = await zip.files[wanted[i]].async('text'), text = xmlText(raw);
      pages.push({ pageNumber: i + 1, text: text, confidence: 100, ocr: false, label: kind === 'docx' ? 'المستند' : 'الشريحة ' + (i + 1) });
      progress(options && options.onProgress, (i + 1) / wanted.length, 'قراءة ' + (i + 1) + ' من ' + wanted.length);
    }
    return { fileName: file.name, pages: pages, text: pages.map(function (p) { return '--- ' + p.label + ' ---\n' + p.text; }).join('\n\n'), ocrUsed: false, sourceType: kind };
  }
  OCR.extractPlainText = async function (file) { var text = await file.text(); return { fileName: file.name, pages: [{ pageNumber: 1, text: text, confidence: 100, ocr: false }], text: text, ocrUsed: false, sourceType: 'text' }; };
  OCR.extractFile = async function (file, options) {
    options = options || {}; var e = ext(file);
    if (/^(png|jpe?g|webp|bmp|tiff?)$/.test(e)) return OCR.extractImage(file, options);
    if (e === 'pdf') return OCR.extractScannedPdf(file, options);
    if (e === 'docx') return extractOffice(file, 'docx', options);
    if (e === 'pptx') return extractOffice(file, 'pptx', options);
    if (/^(txt|csv|tsv|md|json|xml|html|htm|rtf)$/.test(e) || /^text\//i.test(file.type || '')) return OCR.extractPlainText(file, options);
    throw new Error('تم حفظ الملف، لكن لا يوجد قارئ آمن لهذه الصيغة بعد');
  };
  root.MushatiArabicOCR = OCR;
})(window);
