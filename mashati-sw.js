/* منصة المشاطي — Service Worker للإشعارات فقط
 * لا يعترض طلبات index.html أو mashati-config.json، لتجنب عرض نسخة قديمة.
 */
'use strict';
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
function notificationPayload(data) {
  var d = data || {};
  return {
    title: d.title || 'منصة المشاطي',
    body: d.body || 'لديك إشعار جديد من المنصة.',
    icon: d.icon || './mashati-icon.svg',
    badge: d.badge || './mashati-icon.svg',
    tag: d.tag || 'mushati-notification',
    renotify: !!d.renotify,
    data: d.data || { url: './index.html?chat=1' }
  };
}
self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    try { data = { body: event.data ? event.data.text() : '' }; } catch (ignore) {}
  }
  var payload = notificationPayload(data);
  event.waitUntil(self.registration.showNotification(payload.title, payload));
});
self.addEventListener('message', function (event) {
  var d = event.data || {};
  if (d.type !== 'MX_SHOW_NOTIFICATION') return;
  var payload = notificationPayload(d);
  event.waitUntil(self.registration.showNotification(payload.title, payload));
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = './index.html?chat=1';
  try {
    if (event.notification.data && event.notification.data.url) target = event.notification.data.url;
  } catch (ignore) {}
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      for (var i = 0; i < clients.length; i++) {
        if ('focus' in clients[i]) {
          clients[i].navigate(target);
          return clients[i].focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
