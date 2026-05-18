// sw.js — Service Worker для Someprint

// ===== INSTALL / ACTIVATE =====
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// ===== PUSH NOTIFICATIONS =====
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Someprint';
    const options = {
        body: data.body || 'У вас новое уведомление',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200],
        data: { url: data.url || '/?tab=chat' }, // ← Запятая добавлена
        tag: 'someprint-notification',
        renotify: true
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// ===== NOTIFICATION CLICK =====
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/?tab=chat';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((windowClients) => {
                // Если уже есть открытое окно — фокусируем его
                for (const client of windowClients) {
                    if (client.url.includes(url) && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Иначе открываем новое
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});

// ===== FETCH: CACHE-STRATEGY =====
const CACHE_NAME = 'someprint-v2'; // ← версия изменена!
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/admin.html',        // ← добавь, если ещё нет
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico'        // ← добавлено
];

// Кэшируем статику при установке
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Обработка запросов
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // API-запросы — только сеть, без кэша
    if (url.pathname.startsWith('/api')) {
        event.respondWith(
            fetch(request).catch(() => 
                new Response(JSON.stringify({ error: 'Offline' }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
        return;
    }

    // Навигация (страницы) — network-first с кэш-фолбэком
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    // Статика (CSS, JS, изображения) — cache-first
    event.respondWith(
        caches.match(request)
            .then((cached) => cached || fetch(request))
    );
});

// ===== CLEANUP OLD CACHE =====
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => 
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        ).then(() => clients.claim())
    );
});
