/**
 * BitChat Web - Service Worker
 * Обеспечивает офлайн-режим и кэширование
 */

const CACHE_NAME = 'bitchat-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/src/styles/main.css',
  '/src/components/app.js',
  '/src/lib/mesh.js',
  '/src/lib/crypto.js',
  '/manifest.json'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Установка Service Worker...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Кэширование статических файлов');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Активация — очистка старых кэшей
self.addEventListener('activate', (event) => {
  console.log('[SW] Активация Service Worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Удаление старого кэша:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Не кэшируем WebSocket и API запросы
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // Не кэшируем запросы к signaling серверу
  if (url.port === '3001') {
    return;
  }

  // Стратегия: сначала сеть, потом кэш (для HTML)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Кэшируем успешный ответ
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Офлайн — берём из кэша
          return caches.match(request).then((response) => {
            return response || caches.match('/');
          });
        })
    );
    return;
  }

  // Стратегия: сначала кэш, потом сеть (для статики)
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Обновляем кэш в фоне
          fetch(request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, response);
              });
            }
          }).catch(() => {});

          return cachedResponse;
        }

        // Нет в кэше — загружаем
        return fetch(request).then((response) => {
          if (response.ok && request.method === 'GET') {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
  );
});

// Обработка push-уведомлений (на будущее)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title || 'BitChat', {
      body: data.body || 'Новое сообщение',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: 'bitchat-message',
      renotify: true,
      data: data
    })
  );
});

// Клик по уведомлению
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Если приложение открыто — фокусируемся на нём
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        // Иначе открываем новое окно
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

// Синхронизация в фоне (для отложенных сообщений)
self.addEventListener('sync', (event) => {
  if (event.tag === 'send-pending-messages') {
    event.waitUntil(sendPendingMessages());
  }
});

async function sendPendingMessages() {
  // Будет использоваться для отправки сообщений, которые были созданы офлайн
  console.log('[SW] Синхронизация отложенных сообщений...');
}

console.log('[SW] Service Worker загружен');
