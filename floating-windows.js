/* Floating tools prototype for Mashati. Keeps existing tool renderers and data flows intact. */
(function () {
  'use strict';
  if (window.__MX_FLOATING_WINDOWS__) return;
  window.__MX_FLOATING_WINDOWS__ = true;
  var windows = new Map(), hidden = new Map(), z = 1000, seq = 0, active = null;
  var originalOpen = window.cdOpenModal, originalClose = window.cdCloseModal, originalEl = window.cdEl;
  var originalGenericOpen = window.openModal, originalGenericClose = window.closeModal, originalGenericEl = window.el;
  var style = document.createElement('style');
  style.textContent = [
    '.mx-fw{position:fixed;z-index:1000;min-width:280px;min-height:180px;width:min(560px,calc(100vw - 24px));height:min(620px,calc(100vh - 100px));background:#fff;border:1px solid #dbe3ef;border-radius:16px;box-shadow:0 20px 60px rgba(15,23,42,.22);overflow:hidden;display:flex;flex-direction:column;direction:rtl}',
    '.mx-fw.is-max{inset:12px!important;width:auto!important;height:auto!important;border-radius:14px}',
    '.mx-fw.is-hidden{display:none}',
    '.mx-fw-head{height:44px;display:flex;align-items:center;gap:6px;padding:0 10px;background:linear-gradient(135deg,#0f766e,#115e59);color:#fff;cursor:move;user-select:none;touch-action:none;flex:none}',
    '.mx-fw-title{font-weight:800;font-size:13px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mx-fw-btn{width:28px;height:28px;border:0;border-radius:7px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;font-size:15px;line-height:1}',
    '.mx-fw-btn:hover{background:rgba(255,255,255,.28)}',
    '.mx-fw-body{position:relative;flex:1;min-height:0;overflow:auto;padding:14px;background:#fff}',
    '.mx-fw-foot{border-top:1px solid #e5e7eb;padding:8px 12px;background:#fafafa;flex:none}',
    '.mx-fw-resize{position:absolute;left:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 45%,#94a3b8 46%,#94a3b8 55%,transparent 56%)}',
    '.mx-fw-dock{position:fixed;z-index:2000;right:12px;top:100px;display:flex;flex-direction:column;gap:6px;max-width:180px}',
    '.mx-fw-dock button{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:10px;padding:8px 10px;box-shadow:0 5px 15px rgba(15,23,42,.12);cursor:pointer;text-align:right;font-size:12px}',
    '.mx-fw-dock button:hover{background:#f0fdfa;border-color:#0f766e}',
    '.mx-fw-toggle{position:fixed;z-index:2100;right:12px;bottom:14px;border:0;border-radius:999px;background:#0f766e;color:#fff;padding:10px 14px;font-weight:800;box-shadow:0 8px 22px rgba(15,118,110,.28);cursor:pointer}',
    '.mx-fw-count{display:inline-flex;min-width:20px;height:20px;align-items:center;justify-content:center;border-radius:999px;background:#fff;color:#0f766e;margin-right:5px}',
    '@media(max-width:700px){.mx-fw{inset:8px!important;width:auto!important;height:calc(100vh - 80px)!important;min-width:0;border-radius:12px}.mx-fw-head{height:48px}.mx-fw-btn{width:34px;height:34px}.mx-fw-dock{right:8px;top:auto;bottom:62px;max-width:calc(100vw - 16px)}}'
  ].join('');
  document.head.appendChild(style);
  var dock=document.createElement('div');dock.className='mx-fw-dock';dock.setAttribute('aria-label','الأدوات المخفية');document.body.appendChild(dock);
  var toggle=document.createElement('button');toggle.className='mx-fw-toggle';toggle.type='button';toggle.innerHTML='إخفاء الأدوات / استرجاع الأدوات <span class="mx-fw-count">0</span>';document.body.appendChild(toggle);
  function count(){return hidden.size;}
  function paintDock(){dock.innerHTML='';hidden.forEach(function(w){var b=document.createElement('button');b.type='button';b.textContent=w.title+'  ↩';b.onclick=function(){restore(w.id);};dock.appendChild(b);});toggle.querySelector('.mx-fw-count').textContent=count();toggle.style.display=windows.size||hidden.size?'block':'none';}
  function bring(w){w.el.style.zIndex=String(++z);active=w;}
  function rect(w){var r=w.el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};}
  function clamp(w){var r=rect(w),pad=8,maxL=Math.max(pad,innerWidth-r.width-pad),maxT=Math.max(pad,r.top);w.el.style.left=Math.min(Math.max(pad,r.left),maxL)+'px';w.el.style.top=Math.min(Math.max(pad,r.top),Math.max(pad,innerHeight-80))+'px';}
  function drag(w,e){if(w.max)return;var sx=e.clientX,sy=e.clientY,r=rect(w),move=function(ev){w.el.style.left=r.left+ev.clientX-sx+'px';w.el.style.top=r.top+ev.clientY-sy+'px';clamp(w);},up=function(){removeEventListener('pointermove',move);removeEventListener('pointerup',up);};addEventListener('pointermove',move);addEventListener('pointerup',up);}
  function resize(w,e){if(w.max)return;e.preventDefault();e.stopPropagation();var sx=e.clientX,sy=e.clientY,r=rect(w),move=function(ev){w.el.style.width=Math.max(280,r.width+ev.clientX-sx)+'px';w.el.style.height=Math.max(180,r.height+ev.clientY-sy)+'px';clamp(w);},up=function(){removeEventListener('pointermove',move);removeEventListener('pointerup',up);};addEventListener('pointermove',move);addEventListener('pointerup',up);}
  function close(id){var w=windows.get(id);if(!w)return;windows.delete(id);hidden.delete(id);w.el.remove();if(active===w)active=null;paintDock();}
  function hide(id){var w=windows.get(id);if(!w)return;w.was=rect(w);w.el.classList.add('is-hidden');hidden.set(id,w);windows.delete(id);if(active===w)active=null;paintDock();}
  function restore(id){var w=hidden.get(id);if(!w)return;hidden.delete(id);windows.set(id,w);w.el.classList.remove('is-hidden');if(w.was){w.el.style.left=w.was.left+'px';w.el.style.top=w.was.top+'px';w.el.style.width=w.was.width+'px';w.el.style.height=w.was.height+'px';}bring(w);paintDock();}
  function maximize(w){if(w.max){w.el.classList.remove('is-max');if(w.was){w.el.style.left=w.was.left+'px';w.el.style.top=w.was.top+'px';w.el.style.width=w.was.width+'px';w.el.style.height=w.was.height+'px';}w.max=false;}else{w.was=rect(w);w.el.classList.add('is-max');w.max=true;}bring(w);}
  function mount(title,body,foot){var id='mx-fw-'+(++seq),el=document.createElement('section');el.className='mx-fw';el.id=id;el.dataset.toolId=id;var head=document.createElement('div');head.className='mx-fw-head';var titleEl=document.createElement('div');titleEl.className='mx-fw-title';titleEl.textContent=title;var controls=[['−','إخفاء'],['□','تكبير'],['×','إغلاق']];head.appendChild(titleEl);controls.forEach(function(c,i){var b=document.createElement('button');b.className='mx-fw-btn';b.type='button';b.textContent=c[0];b.title=c[1];b.onclick=function(ev){ev.stopPropagation();if(i===0)hide(id);else if(i===1)maximize(w);else close(id);};head.appendChild(b);});var bdy=document.createElement('div');bdy.className='mx-fw-body';bdy.innerHTML=body||'';var f=document.createElement('div');f.className='mx-fw-foot';f.innerHTML=foot||'';var grip=document.createElement('div');grip.className='mx-fw-resize';el.appendChild(head);el.appendChild(bdy);if(foot)el.appendChild(f);el.appendChild(grip);document.body.appendChild(el);var w={id:id,title:title,el:el,body:bdy,head:head,max:false,was:null};windows.set(id,w);head.addEventListener('pointerdown',function(e){bring(w);drag(w,e);});grip.addEventListener('pointerdown',function(e){bring(w);resize(w,e);});el.addEventListener('pointerdown',function(){bring(w);});el.style.left=Math.max(12,Math.round((innerWidth-560)/2)+((seq%4)*18))+'px';el.style.top=Math.max(60,Math.round((innerHeight-620)/2)+((seq%3)*18))+'px';bring(w);paintDock();return w;}
  function current(){return active;}
  function scopedEl(id){var w=current();if(w&&w.body){var found=w.body.querySelector('#'+CSS.escape(id));if(found)return found;}return originalEl(id);}
  window.cdEl=scopedEl;
  window.el=function(id){var w=current();if(w&&w.body){var found=w.body.querySelector('#'+CSS.escape(id));if(found)return found;}return originalGenericEl?originalGenericEl(id):document.getElementById(id);};
  window.cdOpenModal=function(title,body,foot){var w=mount(title,body,foot);active=w;setTimeout(function(){w.body.querySelectorAll('input,textarea,select,button').forEach(function(x){x.addEventListener('focus',function(){bring(w);});});},0);return w;};
  window.cdCloseModal=function(){var w=current();if(w)close(w.id);else if(originalClose)originalClose();};
  window.openModal=function(title,body,foot){return window.cdOpenModal(title,body,foot);};
  window.closeModal=function(){var w=current();if(w)close(w.id);else if(originalGenericClose)originalGenericClose();};
  toggle.onclick=function(){if(hidden.size){Array.from(hidden.keys()).forEach(restore);}else{Array.from(windows.keys()).forEach(hide);}paintDock();};
  window.mxFloatingWindows={list:function(){return {open:Array.from(windows.keys()),hidden:Array.from(hidden.keys())};},restoreAll:function(){Array.from(hidden.keys()).forEach(restore);},hideAll:function(){Array.from(windows.keys()).forEach(hide);}};
  addEventListener('resize',function(){windows.forEach(clamp);});
})();
