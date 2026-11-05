/* منصة المشاطي — السبورة العائمة والكتابة فوق الصفحة
 * طبقة مستقلة: لا تعدل المصدر الأصلي للدرس أو PDF أو الصورة.
 */
(function () {
  'use strict';
  if (window.__MXFloatingBoard) return;
  window.__MXFloatingBoard = true;

  var KEY = 'mushati_floating_ink_v1';
  var target = null, canvas = null, ctx = null, panel = null, dock = null;
  var strokes = [], history = [], historyIndex = -1;
  var drawing = false, active = null, mode = 'pen', color = '#0f766e', pageZoom = 1;
  var width = 4, opacity = 1, shape = 'free', saveTimer = null, resizeTimer = null;
  var html2canvasPromise = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]; }); }
  function q(s) { return document.querySelector(s); }
  function visible(e) { return !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length)); }
  function toast(t) { try { if (typeof window.cdToast === 'function') { window.cdToast(t); return; } if (typeof window.toast === 'function') { window.toast(t); return; } } catch (e) {} try { console.info(t); } catch (e2) {} }
  function targetId(e) { return e.id || e.getAttribute('data-page-id') || e.className || 'page'; }
  function storageKey() { return KEY + ':' + location.pathname + ':' + targetId(target); }
  function currentTarget() {
    var app = q('.app');
    var lesson = q('#mxEmbeddedLessons') || q('#lessonDetail') || q('#eduLessonsContent');
    if (!visible(app) && !visible(lesson)) return null;
    var list = ['#mxEmbeddedLessons', '#lessonDetail', '#eduLessonsContent', '.content'];
    for (var i = 0; i < list.length; i++) { var e = q(list[i]); if (visible(e)) return e; }
    return visible(app) ? app : (visible(lesson) ? lesson : null);
  }
  function setRelative(e) {
    if (!e || e === document.body || e === document.documentElement) return;
    var cs = getComputedStyle(e);
    if (cs.position === 'static') e.style.position = 'relative';
  }
  function bounds() {
    if (!target) return { w: 1, h: 1 };
    var w = Math.max(target.clientWidth || 1, target.scrollWidth || 1);
    var h = Math.max(target.clientHeight || 1, target.scrollHeight || 1);
    return { w: Math.min(Math.max(w, 1), 8000), h: Math.min(Math.max(h, 1), 12000) };
  }
  function resizeCanvas() {
    if (!canvas || !target) return;
    var b = bounds(), old = canvas.style.visibility;
    canvas.style.visibility = 'hidden';
    canvas.width = b.w; canvas.height = b.h;
    canvas.style.width = b.w + 'px'; canvas.style.height = b.h + 'px';
    canvas.style.visibility = old || 'visible';
    drawAll();
  }
  function point(e) {
    var r = target.getBoundingClientRect();
    var scrollX = target === document.body ? window.scrollX : target.scrollLeft;
    var scrollY = target === document.body ? window.scrollY : target.scrollTop;
    var t = e.touches && e.touches[0] ? e.touches[0] : e;
    return { x: t.clientX - r.left + scrollX, y: t.clientY - r.top + scrollY };
  }
  function hexAlpha(a) { return Math.max(0, Math.min(1, Number(a || 0))).toFixed(3); }
  function drawStroke(s) {
    if (!ctx || !s || !s.points || !s.points.length) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (s.mode === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1; ctx.strokeStyle = '#000'; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = s.alpha == null ? 1 : s.alpha; ctx.strokeStyle = s.color || color; }
    ctx.lineWidth = s.mode === 'highlighter' ? (s.width || 4) * 4 : (s.width || 4);
    if (s.type === 'circle' || s.type === 'rect' || s.type === 'line' || s.type === 'arrow') {
      var a = s.points[0], z = s.points[s.points.length - 1];
      ctx.beginPath();
      if (s.type === 'circle') { var dx = z.x - a.x, dy = z.y - a.y; ctx.arc(a.x, a.y, Math.sqrt(dx * dx + dy * dy), 0, Math.PI * 2); }
      else if (s.type === 'rect') ctx.rect(a.x, a.y, z.x - a.x, z.y - a.y);
      else { ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); if (s.type === 'arrow') { var ang = Math.atan2(z.y - a.y, z.x - a.x); var len = Math.max(10, (s.width || 4) * 4); ctx.moveTo(z.x, z.y); ctx.lineTo(z.x - len * Math.cos(ang - Math.PI / 6), z.y - len * Math.sin(ang - Math.PI / 6)); ctx.moveTo(z.x, z.y); ctx.lineTo(z.x - len * Math.cos(ang + Math.PI / 6), z.y - len * Math.sin(ang + Math.PI / 6)); } }
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y);
      for (var i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawAll() { if (!ctx) return; ctx.clearRect(0, 0, canvas.width, canvas.height); strokes.forEach(drawStroke); if (active) drawStroke(active); }
  function save() {
    if (!target) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(storageKey(), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), strokes: strokes })); setStatus('✅ محفوظ تلقائياً'); } catch (e) { setStatus('⚠️ تعذر الحفظ المحلي'); }
    }, 180);
  }
  function load() {
    strokes = []; history = []; historyIndex = -1;
    try { var x = JSON.parse(localStorage.getItem(storageKey()) || 'null'); if (x && Array.isArray(x.strokes)) strokes = x.strokes; } catch (e) {}
    pushHistory(false); drawAll();
  }
  function pushHistory(doSave) {
    history = history.slice(0, historyIndex + 1); history.push(JSON.stringify(strokes));
    if (history.length > 40) history.shift(); historyIndex = history.length - 1; updateButtons(); if (doSave) save();
  }
  function restoreHistory(i) { if (i < 0 || i >= history.length) return; historyIndex = i; try { strokes = JSON.parse(history[i]); } catch (e) { strokes = []; } drawAll(); save(); updateButtons(); }
  function updateButtons() {
    var u = q('#mxInkUndo'), r = q('#mxInkRedo'); if (u) u.disabled = historyIndex <= 0; if (r) r.disabled = historyIndex >= history.length - 1;
  }
  function setStatus(t) { var e = q('#mxInkStatus'); if (e) e.textContent = t; }
  function applyPageZoom() {
    var app = q('.app') || q('#app') || q('.shell');
    if (app) app.style.zoom = pageZoom;
    var z = q('#mxInkZoomValue'); if (z) z.textContent = Math.round(pageZoom * 100) + '%';
  }
  function changePageZoom(delta) {
    pageZoom = Math.max(0.7, Math.min(1.6, Math.round((pageZoom + delta) * 10) / 10));
    applyPageZoom();
    setStatus('🔍 تكبير الصفحة: ' + Math.round(pageZoom * 100) + '%');
    setTimeout(sync, 80);
  }
  function resetPageZoom() { pageZoom = 1; applyPageZoom(); setStatus('🔍 حجم الصفحة الأصلي 100%'); setTimeout(sync, 80); }
  function start(e) { if (!canvas || canvas.style.pointerEvents === 'none') return; e.preventDefault(); drawing = true; var p = point(e); active = { mode: mode, color: color, alpha: opacity * (mode === 'highlighter' ? 0.28 : 1), width: width, type: mode === 'pen' || mode === 'highlighter' || mode === 'eraser' ? 'free' : mode, points: [p] }; if (canvas.setPointerCapture && e.pointerId != null) canvas.setPointerCapture(e.pointerId); drawAll(); }
  function move(e) { if (!drawing || !active) return; e.preventDefault(); active.points.push(point(e)); drawAll(); }
  function end(e) { if (!drawing || !active) return; if (e && e.preventDefault) e.preventDefault(); drawing = false; strokes.push(active); active = null; pushHistory(true); }
  function enableWriting(on) { if (!canvas) return; canvas.style.pointerEvents = on ? 'auto' : 'none'; canvas.classList.toggle('active', on); var b = q('#mxInkWrite'); if (b) { b.textContent = on ? '🖱️ تمرير الصفحة' : '✍️ الكتابة فوق الصفحة'; b.classList.toggle('on', on); } if (on) toast('✍️ وضع الكتابة مفعّل — عطّله للتمرير'); }
  function attach() {
    var next = currentTarget(); if (!next) return;
    if (target !== next) { if (target) save(); target = next; setRelative(target); if (canvas && canvas.parentNode !== target) target.appendChild(canvas); load(); resizeCanvas(); }
  }
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas'); canvas.id = 'mxInkCanvas'; canvas.setAttribute('aria-label', 'طبقة الكتابة فوق الصفحة');
    canvas.style.cssText = 'position:absolute;inset:0;z-index:80;pointer-events:none;touch-action:none;background:transparent;';
    canvas.addEventListener('pointerdown', start); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', function (e) { if (drawing) end(e); });
    attach();
  }
  function setTool(v) { mode = v; if (v === 'pen' || v === 'highlighter' || v === 'eraser') shape = 'free'; setStatus(v === 'highlighter' ? 'قلم تمييز' : v === 'eraser' ? 'ممحاة' : v === 'pen' ? 'قلم' : 'شكل: ' + v); }
  function makePanel() {
    if (panel) return;
    panel = document.createElement('div'); panel.id = 'mxInkPanel'; panel.innerHTML = '<div class="mx-ink-head"><b>🧩 السبورة المدمجة فوق المحتوى</b><button id="mxInkMin" title="تصغير">—</button><button id="mxInkHide" title="إخفاء">×</button></div><div class="mx-ink-tools"><button id="mxInkWrite">✍️ الكتابة فوق الصفحة</button><select id="mxInkTool" title="الأداة"><option value="pen">قلم</option><option value="highlighter">تمييز</option><option value="eraser">ممحاة</option><option value="line">خط</option><option value="arrow">سهم</option><option value="circle">دائرة</option><option value="rect">مربع</option></select><input id="mxInkColor" type="color" value="#0f766e" title="اللون"><label>السماكة <input id="mxInkWidth" type="range" min="1" max="24" value="4"></label><label>الشفافية <input id="mxInkOpacity" type="range" min="0" max="100" value="100"></label><button id="mxInkUndo">↩</button><button id="mxInkRedo">↪</button><button id="mxInkClear">مسح الكل</button></div><div class="mx-ink-foot"><span id="mxInkStatus">طبقة مستقلة عن الدرس والملف الأصلي</span><span class="mx-ink-zoom">🔍 <button id="mxInkZoomOut">−</button><b id="mxInkZoomValue">100%</b><button id="mxInkZoomIn">＋</button><button id="mxInkZoomReset">100%</button></span><button id="mxInkSave">💾 حفظ</button><button id="mxInkExport">📥 تصدير الصفحة</button><button id="mxInkPrint">🖨️ طباعة/PDF</button></div>';
    document.body.appendChild(panel);
    dock = document.createElement('button'); dock.id = 'mxInkDock'; dock.innerHTML = '<span>✍️</span><b>السبورة</b>'; dock.title = 'فتح السبورة العائمة والكتابة فوق الصفحة'; document.body.appendChild(dock);
    q('#mxInkWrite').onclick = function () { enableWriting(canvas.style.pointerEvents !== 'auto'); };
    q('#mxInkTool').onchange = function () { setTool(this.value); };
    q('#mxInkColor').oninput = function () { color = this.value; if (mode === 'eraser') setTool('pen'); };
    q('#mxInkWidth').oninput = function () { width = Number(this.value) || 4; };
    q('#mxInkOpacity').oninput = function () { opacity = Number(this.value) / 100; };
    q('#mxInkUndo').onclick = function () { restoreHistory(historyIndex - 1); };
    q('#mxInkRedo').onclick = function () { restoreHistory(historyIndex + 1); };
    q('#mxInkClear').onclick = function () { if (confirm('مسح كل الكتابات من هذه الصفحة؟')) { strokes = []; pushHistory(true); drawAll(); } };
    q('#mxInkSave').onclick = function () { save(); setStatus('✅ تم حفظ التعليقات مستقلة عن المصدر'); };
    q('#mxInkExport').onclick = function () { exportPage('png'); };
    q('#mxInkPrint').onclick = function () { exportPage('print'); };
    q('#mxInkZoomOut').onclick = function () { changePageZoom(-0.1); };
    q('#mxInkZoomIn').onclick = function () { changePageZoom(0.1); };
    q('#mxInkZoomReset').onclick = resetPageZoom;
    q('#mxInkMin').onclick = function () { panel.classList.toggle('min'); };
    q('#mxInkHide').onclick = function () { panel.classList.remove('show'); dock.classList.add('show'); enableWriting(false); };
    dock.onclick = function () { panel.classList.add('show'); attach(); };
    makeDraggable(panel.querySelector('.mx-ink-head'), panel);
    panel.classList.add('show');
  }
  function makeDraggable(handle, box) {
    var down = false, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', function (e) { if (e.target.tagName === 'BUTTON') return; down = true; ox = e.clientX - box.offsetLeft; oy = e.clientY - box.offsetTop; handle.setPointerCapture(e.pointerId); });
    handle.addEventListener('pointermove', function (e) { if (!down) return; box.style.left = Math.max(4, e.clientX - ox) + 'px'; box.style.top = Math.max(4, e.clientY - oy) + 'px'; box.style.right = 'auto'; });
    handle.addEventListener('pointerup', function () { down = false; });
  }
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = new Promise(function (resolve, reject) { var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; s.onload = function () { resolve(window.html2canvas); }; s.onerror = reject; document.head.appendChild(s); });
    return html2canvasPromise;
  }
  function composite() {
    return loadHtml2Canvas().then(function (shot) {
      if (!target || !canvas) throw new Error('لا توجد صفحة مفتوحة');
      var old = canvas.style.visibility; canvas.style.visibility = 'hidden';
      return shot(target, { useCORS: true, allowTaint: false, backgroundColor: '#ffffff', scale: 1, logging: false }).then(function (base) { canvas.style.visibility = old || 'visible'; var out = document.createElement('canvas'); out.width = base.width; out.height = base.height; var c = out.getContext('2d'); c.drawImage(base, 0, 0); var r = target.getBoundingClientRect(), sx = target === document.body ? window.scrollX : target.scrollLeft, sy = target === document.body ? window.scrollY : target.scrollTop; c.drawImage(canvas, sx, sy, base.width, base.height, 0, 0, base.width, base.height); return out; }, function (e) { canvas.style.visibility = old || 'visible'; throw e; });
    });
  }
  function exportPage(kind) {
    setStatus('⏳ تجهيز نسخة الصفحة مع الكتابة…'); composite().then(function (out) { if (kind === 'png') { var a = document.createElement('a'); a.href = out.toDataURL('image/png'); a.download = 'mushati-page-ink-' + Date.now() + '.png'; a.click(); setStatus('✅ تم تصدير الصفحة PNG'); } else { var w = window.open('', '_blank'); if (!w) throw new Error('اسمح بالنوافذ المنبثقة للطباعة'); w.document.write('<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>صفحة المشاطي مع التعليقات</title><style>@page{size:A4;margin:8mm}body{text-align:center;font-family:Arial}img{max-width:100%;max-height:270mm}</style></head><body><h3>منصة المشاطي — الصفحة مع التعليقات</h3><img src="' + out.toDataURL('image/png') + '"></body></html>'); w.document.close(); setTimeout(function () { w.focus(); w.print(); }, 300); setStatus('✅ تم تجهيز الطباعة / PDF'); } }).catch(function (e) { setStatus('⚠️ تعذر دمج الصفحة: ' + (e.message || 'تعذر الالتقاط')); toast('يمكنك تصدير طبقة الكتابة من خلال حفظها محلياً'); });
  }
  function sync() { if (!panel) return; var hasPage = !!currentTarget(); panel.style.display = hasPage ? '' : 'none'; dock.style.display = hasPage ? '' : 'none'; if (hasPage) { ensureCanvas(); attach(); resizeCanvas(); } }
  function openUnified() { makePanel(); sync(); if (!canvas) ensureCanvas(); attach(); if (panel) { panel.style.display = ''; panel.classList.add('show'); } if (dock) dock.classList.remove('show'); setTimeout(function () { applyPageZoom(); sync(); if (!canvas) ensureCanvas(); }, 50); }
  window.mxFloatingBoard = { open: openUnified, close: function () { if (panel) panel.classList.remove('show'); }, attach: attach, exportPage: exportPage, enableWriting: enableWriting, zoomIn: function () { changePageZoom(0.1); }, zoomOut: function () { changePageZoom(-0.1); }, zoomReset: resetPageZoom };
  var css = document.createElement('style'); css.textContent = '#mxInkPanel{position:fixed;z-index:10001;top:76px;left:18px;width:min(620px,calc(100vw - 36px));background:#fff;border:1px solid #b8d8d3;border-top:4px solid #0f766e;border-radius:14px;box-shadow:0 18px 46px rgba(15,23,42,.22);display:none;font-family:inherit;color:#0f172a}#mxInkPanel.show{display:block}#mxInkPanel.min .mx-ink-tools,#mxInkPanel.min .mx-ink-foot{display:none}.mx-ink-head{display:flex;align-items:center;gap:6px;padding:9px 11px;background:linear-gradient(120deg,#f0fdfa,#f8fafc);cursor:move}.mx-ink-head b{margin-inline-end:auto;color:#0f766e;font-size:13px}.mx-ink-head button,.mx-ink-tools button,.mx-ink-foot button{border:1px solid #d8e5e8;background:#fff;color:#164e63;border-radius:8px;padding:5px 8px;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.mx-ink-head button{padding:2px 8px;font-size:16px}.mx-ink-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px;border-bottom:1px solid #edf2f4}.mx-ink-tools button.on{background:#0f766e;color:#fff}.mx-ink-tools select{border:1px solid #d8e5e8;border-radius:8px;padding:5px;font:inherit;font-size:11px}.mx-ink-tools input[type=color]{width:28px;height:28px;border:0;background:none;padding:0}.mx-ink-tools label{display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#475569;font-weight:800}.mx-ink-tools input[type=range]{width:70px;accent-color:#0f766e}.mx-ink-tools button:disabled{opacity:.4;cursor:not-allowed}.mx-ink-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px}.mx-ink-foot>span:first-child{margin-inline-end:auto;font-size:10px;color:#0f766e}.mx-ink-zoom{display:inline-flex;align-items:center;gap:3px;color:#0f766e;font-size:10px}.mx-ink-zoom button{padding:3px 6px}.mx-ink-foot button{font-size:10px}.mx-ink-foot button:first-of-type{background:#0f766e;color:#fff}#mxInkDock{position:fixed;z-index:10000;right:0;left:auto;top:50%;transform:translateY(-50%);min-width:82px;height:48px;padding:0 10px;border:1px solid #99f6e4;border-left:0;border-radius:12px 0 0 12px;background:linear-gradient(180deg,#0f766e,#0d9488);color:#fff;box-shadow:0 8px 22px rgba(15,118,110,.35);font:inherit;font-size:12px;font-weight:900;cursor:pointer;display:none}#mxInkDock span{font-size:19px;display:block;line-height:1.1}#mxInkDock b{font-size:10px;display:block}#mxInkCanvas.active{cursor:crosshair}@media(max-width:650px){#mxInkPanel{left:8px;top:62px;width:calc(100vw - 16px)}.mx-ink-tools{max-height:112px;overflow:auto}.mx-ink-foot>span:first-child{width:100%;margin:0}#mxInkDock{min-width:64px;padding:0 7px}}'; document.head.appendChild(css);
  function boot() { makePanel(); sync(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 300);
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(sync, 180); });
  window.addEventListener('scroll', function () { if (canvas && target) { /* canvas absolute داخل نفس المحتوى، لذلك يبقى موضعه متزامناً */ } }, { passive: true });
  setInterval(sync, 1200);
  var mo = new MutationObserver(function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(sync, 100); });
  mo.observe(document.body, { childList: true, subtree: true });
})();
