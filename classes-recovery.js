/* إصلاح الفصول والطلاب — 2026-11-01. لا مفاتيح خاصة أو بيانات طلاب مضمنة. */
(function () {
  'use strict';
  if (window.__MX_MODE || typeof state !== 'object' || !state) return;
  var restoring = false;
  var recoveryPending = localStorage.getItem('mashati_class_recovery_pending_cloud') === '1';
  var recoveryVersion = 0;
  var message = '';
  var relatedFields = ['attendance', 'attHistory', 'behavior', 'studentGrades',
    'studentSettings', 'groups', 'groupScores', 'finalExams', 'research',
    'worksheets', 'chapterAttempts', 'lastLogin', 'studentPoints', 'followups',
    'followupDone', 'followupCleared', 'followupCriteria', 'followupLevels',
    'learningStyles', 'notes', 'classStreak', 'yearWorkWeights'];

  function studentCount(s) {
    return Object.keys((s && s.classes) || {}).reduce(function (n, k) {
      return n + (Array.isArray(s.classes[k]) ? s.classes[k].length : 0);
    }, 0);
  }
  function normalizeSections(s) {
    var changed = false;
    Object.keys((s && s.sections) || {}).forEach(function (group) {
      if (!Array.isArray(s.sections[group])) return;
      var seen = new Set();
      var clean = s.sections[group].filter(function (section) {
        var key = String(section);
        if (seen.has(key)) { changed = true; return false; }
        seen.add(key);
        return true;
      });
      if (clean.length !== s.sections[group].length) s.sections[group] = clean;
    });
    return changed;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function safeKey(key) { return key !== '__proto__' && key !== 'constructor' && key !== 'prototype'; }
  function arrayIdentity(row) {
    if (object(row) && row.id != null) return 'id:' + row.id;
    if (object(row) && (row.at != null || row.ts != null)) {
      return 'event:' + (row.studentId || row.student_id || '') + ':' +
        (row.at == null ? row.ts : row.at) + ':' + (row.type || '');
    }
    return JSON.stringify(row);
  }
  function mergeArray(target, source) {
    // Legacy groups are positional arrays of student IDs. Keep every existing membership.
    if (source.length && source.every(Array.isArray) && target.every(Array.isArray)) {
      var assigned = new Set();
      target.forEach(function (group) { group.forEach(function (id) { assigned.add(String(id)); }); });
      source.forEach(function (group, index) {
        if (!target[index]) target[index] = [];
        group.forEach(function (id) {
          if (!assigned.has(String(id))) { target[index].push(clone(id)); assigned.add(String(id)); }
        });
      });
      return;
    }
    var existing = new Set(target.map(arrayIdentity));
    source.forEach(function (row) {
      var key = arrayIdentity(row);
      if (!existing.has(key)) { target.push(clone(row)); existing.add(key); }
    });
  }
  // Existing records win; add only missing records, including inside non-empty arrays.
  function fillMissing(target, source) {
    if (!object(target) || !object(source)) return;
    Object.keys(source).forEach(function (key) {
      if (!safeKey(key)) return;
      if (!Object.prototype.hasOwnProperty.call(target, key) || target[key] == null) {
        target[key] = clone(source[key]);
      } else if (object(target[key]) && object(source[key])) {
        fillMissing(target[key], source[key]);
      } else if (Array.isArray(target[key]) && Array.isArray(source[key])) {
        mergeArray(target[key], source[key]);
      }
    });
  }
  function mergeRoster(current, recovered) {
    var next = clone(current), added = 0;
    next.classes = object(next.classes) ? next.classes : {};
    next.sections = object(next.sections) ? next.sections : {};
    Object.keys(recovered.classes || {}).forEach(function (key) {
      if (!safeKey(key) || !Array.isArray(recovered.classes[key])) return;
      var rows = Array.isArray(next.classes[key]) ? next.classes[key] : [];
      if (next.classes[key] != null && !Array.isArray(next.classes[key])) return;
      next.classes[key] = rows;
      var existing = new Set(rows.map(function (row) { return String(row.id || row.student_id || ''); }));
      recovered.classes[key].forEach(function (row) {
        if (!object(row)) return;
        var id = row.id || row.student_id;
        if (!id || existing.has(String(id))) return;
        var restored = clone(row);
        if (!restored.id) restored.id = String(id);
        rows.push(restored); existing.add(String(id)); added++;
      });
      // Make a recovered class reachable, without disabling or deleting any local class.
      if (rows.length) {
        var parts = key.split('_');
        if (parts.length >= 3) {
          var group = parts.slice(0, 2).join('_'), section = parts.slice(2).join('_');
          if (next.sections[group] != null && !Array.isArray(next.sections[group])) return;
          next.sections[group] = next.sections[group] || [];
          if (next.sections[group].indexOf(section) < 0) next.sections[group].push(section);
        }
      }
    });
    relatedFields.forEach(function (key) {
      if (recovered[key] == null) return;
      if (next[key] == null) next[key] = clone(recovered[key]);
      else if (object(next[key]) && object(recovered[key])) fillMissing(next[key], recovered[key]);
    });
    normalizeSections(next);
    return { state: next, added: added, changed: JSON.stringify(next) !== JSON.stringify(current) };
  }
  function exportRoster(exported) {
    if (!exported || !Array.isArray(exported.students)) throw new Error('لم تتوفر قوائم طلاب لهذا الحساب');
    var result = { classes: {} };
    exported.students.forEach(function (row) {
      if (!row.class_key || !row.student_id || !safeKey(row.class_key)) return;
      var student = { id: row.student_id, name: row.name || '', username: row.username || '',
        code: row.username || '', status: row.active === false ? 'suspended' : 'active' };
      (result.classes[row.class_key] = result.classes[row.class_key] || []).push(student);
    });
    return result;
  }
  async function decodeSnapshot(record) {
    if (record.error) throw new Error(record.error);
    var data = record.data;
    if (record.encoding === 'gzip-b64') {
      if (typeof DecompressionStream !== 'function') throw new Error('استخدم متصفحًا حديثًا لفك النسخة السحابية');
      var raw = atob(data), bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      data = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else if (record.encoding && record.encoding !== 'json') {
      throw new Error('ترميز النسخة السحابية غير مدعوم');
    }
    var recovered = typeof data === 'string' ? JSON.parse(data) : data;
    if (!recovered || !object(recovered.classes)) throw new Error('النسخة السحابية غير صالحة');
    return recovered;
  }
  async function readRoster(X) {
    // Both calls are authenticated read-only RPCs. No restore/save/sync RPC is used here.
    var record = await X.rpc('mx_t_state_get', {});
    if (record && record.error) throw new Error(record.error);
    if (record && record.data) {
      var snapshot = await decodeSnapshot(record);
      if (studentCount(snapshot)) return snapshot;
    }
    return exportRoster(await X.rpc('mx_t_export', {}));
  }
  function paintHint(host, id) {
    if (!host) return;
    var hint = document.getElementById(id);
    if (!hint) {
      hint = document.createElement('div'); hint.id = id; hint.className = 'card';
      hint.style.cssText = 'margin-bottom:14px;border-right:4px solid #f59e0b';
      var title = document.createElement('b'); title.textContent = 'استعادة بيانات الفصول والطلاب';
      var text = document.createElement('p'); text.className = 'mx-class-recovery-text';
      text.style.cssText = 'font-size:13px;color:#64748b;margin:6px 0 10px;line-height:1.8';
      text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite');
      var button = document.createElement('button'); button.className = 'btn btn-primary btn-sm';
      button.setAttribute('data-class-recovery', 'true'); button.onclick = restore;
      hint.appendChild(title); hint.appendChild(text); hint.appendChild(button);
      host.insertBefore(hint, host.firstChild);
    }
    hint.querySelector('.mx-class-recovery-text').textContent = message ||
      'القائمة المحلية فارغة. استعد البيانات الناقصة من حساب المعلم؛ تُحفظ نسخة من بيانات الجهاز ولا يُحذف أو يُستبدل أي سجل موجود.';
    var button = hint.querySelector('button'); button.disabled = restoring;
    button.textContent = restoring ? 'جارٍ الاستعادة…' : 'استعادة البيانات الناقصة';
  }
  function paint() {
    if (window.__MX_MODE) return;
    var empty = studentCount(state) === 0;
    var selectedEmpty = typeof stuOpenClass === 'string' &&
      (!Array.isArray(state.classes[stuOpenClass]) || state.classes[stuOpenClass].length === 0);
    if (empty || message) paintHint(document.getElementById('classesView'), 'mxClassRecoveryHint');
    else { var hint = document.getElementById('mxClassRecoveryHint'); if (hint) hint.remove(); }
    if (selectedEmpty || (message && typeof stuOpenClass === 'string')) {
      paintHint(document.querySelector('#classDetail .classes-integrated-body'), 'mxClassRecoveryDetail');
    } else { var detail = document.getElementById('mxClassRecoveryDetail'); if (detail) detail.remove(); }
  }
  async function restore() {
    if (restoring) return false;
    var X = window.__mx;
    if (!X || !X.isOn || !X.isOn()) {
      message = 'سجّل دخول حساب المعلم في إعدادات الخادم أولًا؛ لن تُطلب أو تُعرض بيانات الطلاب دون جلسة مصرح بها.';
      paint();
      if (window.mxOpenServer) window.mxOpenServer();
      return false;
    }
    var owner = X.sess && X.sess() && X.sess().uid;
    if (!owner) { message = 'تعذر التحقق من هوية حساب المعلم؛ أعد تسجيل الدخول.'; paint(); return false; }
    recoveryVersion++;
    restoring = true; message = 'جارٍ قراءة القوائم من حساب المعلم…'; paint();
    try {
      var recovered = await readRoster(X);
      if (!studentCount(recovered)) throw new Error('لا توجد قوائم طلاب محفوظة لهذا الحساب');
      if (!X.isOn() || !X.sess() || X.sess().uid !== owner) throw new Error('تغيّر حساب المعلم؛ أعد الاستعادة من الحساب المطلوب');
      // Merge against the latest state after the request, not a snapshot taken before it.
      var merged = mergeRoster(state, recovered);
      if (merged.changed) {
        var json = JSON.stringify(merged.state);
        var backup = 'mashati_before_class_recovery_' + Date.now();
        localStorage.setItem(backup, JSON.stringify(state));
        localStorage.setItem('mashati_class_recovery_pending_cloud', '1');
        recoveryPending = true;
        localStorage.setItem('mashati_v1', json);
        if (localStorage.getItem('mashati_v1') !== json) throw new Error('تعذر التحقق من الحفظ المحلي');
        Object.assign(state, merged.state);
        if (typeof CD === 'object' && CD) { CD.state = state; CD.students = state.classes[CD.classKey] || []; }
      }
      message = merged.changed ? 'اكتملت الاستعادة محليًا: أضيف ' + merged.added + ' طالبًا واستُكملت البيانات المرتبطة الناقصة. للحفظ السحابي اختر «حفظ البيانات» بنفسك.' :
        'قوائم هذا الحساب موجودة بالفعل؛ لم تُستبدل بياناتك المحلية.';
      if (typeof renderClasses === 'function') renderClasses();
      if (typeof stuOpenClass === 'string' && typeof renderStudentSection === 'function') renderStudentSection();
      paint(); return true;
    } catch (error) {
      message = 'تعذرت الاستعادة: ' + (error.message || 'تحقق من الاتصال وحساب المعلم');
      paint(); return false;
    } finally { restoring = false; paint(); }
  }
  window.mxPaintClassRecovery = paint;
  window.mxClassRecoveryVersion = function () { return recoveryVersion; };
  window.mxClassRecoveryBlockCloudSave = function (silent) { return restoring || (recoveryPending && !!silent); };
  window.mxClassRecoveryCloudSaved = function (version) {
    if (!restoring && version === recoveryVersion) {
      recoveryPending = false;
      localStorage.removeItem('mashati_class_recovery_pending_cloud');
    }
  };
  window.mxRestoreMissingClassData = restore;
  var originalRender = renderClasses;
  renderClasses = function () {
    normalizeSections(state);
    var result = originalRender.apply(this, arguments);
    paint(); return result;
  };
  window.renderClasses = renderClasses;
  normalizeSections(state);
  if (state.page === 'classes') renderClasses();
})();
