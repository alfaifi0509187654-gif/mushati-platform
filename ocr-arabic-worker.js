/* محرك OCR عربي — المرحلة الثانية
 * الاستخدام:
 *   MushatiArabicOCR.extractFile(file, {onProgress, onPage})
 * يعيد: {fileName, pages:[{pageNumber,text,confidence}], text, ocrUsed:true}
 * يعتمد على Tesseract.js وPDF.js عند الحاجة، ولا يغيّر الاختبارات أو البيانات المنشورة.
 */
(function (root) {
  'use strict';
  var OCR = {};
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  var PDF_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
  var PDF_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
  var scripts = {};

  function loadScript(url) {
    if (scripts[url]) return scripts[url];
    scripts[url] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('تعذر تحميل مكتبة OCR')); };
      document.head.appendChild(s);
    });
    return scripts[url];
  }

  function ext(file) {
    return String(file.name || '').split('.').pop().toLowerCase();
  }

  function progress(cb, value, label) {
    if (typeof cb === 'function') cb({ progress: value, status: label || '' });
  }

  async function workerFor(options) {
    await loadScript(TESS_URL);
    if (!root.Tesseract || !root.Tesseract.createWorker) throw new Error('محرك Tesseract غير متاح');
    return root.Tesseract.createWorker('ara+eng', 1, {
      logger: function (m) { progress(options && options.onProgress, m.progress || 0, m.status || 'OCR'); }
    });
  }

  async function recognizeCanvas(canvas, pageNumber, options, worker) {
    var result = await worker.recognize(canvas);
    var text = (result && result.data && result.data.text || '').trim();
    var confidence = result && result.data ? Number(result.data.confidence || 0) : 0;
    if (typeof options.onPage === 'function') options.onPage({ pageNumber: pageNumber, text: text, confidence: confidence });
    return { pageNumber: pageNumber, text: text, confidence: confidence };
  }

  OCR.extractImage = async function (file, options) {
    options = options || {};
    var worker = await workerFor(options);
    try {
      var bitmap = await createImageBitmap(file);
      var canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      var page = await recognizeCanvas(canvas, 1, options, worker);
      return { fileName: file.name, pages: [page], text: page.text, ocrUsed: true };
    } finally {
      await worker.terminate();
    }
  };

  OCR.extractScannedPdf = async function (file, options) {
    options = options || {};
    var pdfjs = await import(PDF_URL);
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    var pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    var worker = await workerFor(options), pages = [];
    try {
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i), viewport = page.getViewport({ scale: options.scale || 2 });
        var canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
        pages.push(await recognizeCanvas(canvas, i, options, worker));
        progress(options.onProgress, i / pdf.numPages, 'صفحة ' + i + ' من ' + pdf.numPages);
      }
    } finally {
      await worker.terminate();
    }
    return { fileName: file.name, pages: pages, text: pages.map(function (p) { return '--- الصفحة ' + p.pageNumber + ' ---\n' + p.text; }).join('\n\n'), ocrUsed: true };
  };

  OCR.extractFile = async function (file, options) {
    var e = ext(file);
    if (/^(png|jpe?g|webp|bmp|tiff?)$/.test(e)) return OCR.extractImage(file, options);
    if (e === 'pdf') return OCR.extractScannedPdf(file, options);
    throw new Error('المرحلة الثانية تدعم صورًا وPDF ممسوحًا فقط؛ أضف محللات Word وPowerPoint في مرحلة لاحقة.');
  };

  root.MushatiArabicOCR = OCR;
})(window);
