const CACHE_NAME = 'poem-trainer-v2.27'; // меняйте на v2, v3... при каждом обновлении
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// При установке сохраняем все файлы в кэш и сразу активируемся
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // не ждать закрытия вкладок — встать в работу немедленно
});

// При активации удаляем кэши прошлых версий
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// При запросе: отдаём из кэша, если есть, иначе — из сети
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
