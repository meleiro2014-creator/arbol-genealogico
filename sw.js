/* ===== SERVICE WORKER — El Libro de los Ancestros (Tarea 2: PWA) =====
   Deliberadamente sencillo: solo cachea el "shell" estático de la aplicación
   (el HTML, el manifest, este mismo sw.js y los iconos) para que la app pueda
   arrancar sin conexión. NO gestiona IndexedDB, NO cachea Google Drive, OAuth,
   fotos ni documentos, y NO implementa sincronización de datos: eso sigue
   siendo responsabilidad exclusiva del código de la aplicación (IndexedDB +
   Google Drive), que este archivo no toca en absoluto.

   Actualizar CACHE_NAME (ej. 'libro-ancestros-v2') cuando haya un cambio
   estructural del propio PWA que deba forzar una limpieza de caché.

   ===== MEJORA (informe de usabilidad): se sube a v3 porque cambian el HTML,
   el manifest y se añaden los iconos "maskable". Sin este cambio de versión,
   quien ya tuviera la app instalada podría seguir viendo copias en caché de
   los archivos antiguos (index.html, manifest.json, iconos) durante más
   tiempo del necesario.

   ===== MEJORA (aviso de actualización en móvil): se sube a v4 porque cambia
   la estrategia de caché para index.html (ver más abajo, en el listener de
   'fetch'). Antes se servía "caché primero" igual que el resto del shell, lo
   que hacía casi inútil el aviso de "hay una versión nueva" de la propia
   aplicación: esa comprobación pide index.html con cache:'no-store', pero al
   pasar por este Service Worker se le devolvía igualmente la copia guardada,
   sin llegar a mirar la red primero, así que casi siempre se comparaba
   consigo misma. Ahora index.html se sirve "red primero, caché como
   respaldo sin conexión", que es la estrategia recomendada para el propio
   documento HTML en cualquier PWA. */
const CACHE_NAME = 'libro-ancestros-v4';

/* Rutas relativas al lugar donde vive este sw.js (mismo directorio que el
   HTML), para no asumir que la aplicación está publicada en la raíz del
   dominio (ej. GitHub Pages con subcarpeta de proyecto).

   ===== MEJORA: se añaden los dos iconos "maskable" nuevos (icon-maskable-192.png
   e icon-maskable-512.png) para que también queden precacheados y disponibles
   sin conexión, igual que los iconos "any" que ya estaban. ===== */
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(APP_SHELL);
      })
      .catch(function (err) {
        /* Si algún recurso del shell no se pudo precachear (ej. primera
           publicación con rutas distintas), no se bloquea la instalación:
           el resto de la aplicación sigue funcionando por red normalmente. */
        console.warn('Service Worker: no se pudo precachear todo el shell inicial', err);
      })
  );
  /* No se llama a self.skipWaiting() aquí a propósito: así una pestaña que
     esté a mitad de una edición no se ve interrumpida por la activación
     inmediata de una versión nueva del Service Worker. La nueva versión
     tomará el control cuando el usuario cierre y reabra la aplicación. */
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

/* Conjunto de recursos que este Service Worker está autorizado a servir desde
   caché. Cualquier otra petición (Google Drive, OAuth, Google Fonts,
   Font Awesome/cdnjs, etc.) se ignora aquí y sigue su camino normal de red,
   sin pasar por ninguna lógica offline inventada. */
function esRecursoDelShell(pathname) {
  return APP_SHELL.some(function (ruta) {
    var nombre = ruta.replace('./', '/');
    return pathname.slice(-nombre.length) === nombre;
  });
}

/* El propio documento HTML (index.html, y cualquier navegación normal del
   navegador hacia la app) se identifica aparte del resto del shell, porque
   necesita una estrategia de caché distinta: ver el porqué en el listener
   de 'fetch', más abajo. */
function esIndexHTML(pathname) {
  return pathname.slice(-11) === '/index.html';
}

self.addEventListener('fetch', function (event) {
  var req = event.request;

  /* Solo se intercepta GET. Cualquier otro método (POST/PATCH/etc., como los
     que usa la sincronización con Drive) pasa siempre por red. */
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Nunca interceptar peticiones de otro origen: Google Drive, OAuth de
     Google, Google Fonts, Font Awesome/cdnjs, etc. siguen usando red normal,
     tal y como exige la Tarea 2. */
  if (url.origin !== self.location.origin) return;

  if (!esRecursoDelShell(url.pathname)) return;

  /* ===== index.html (y cualquier navegación hacia la app): "red primero,
     caché como respaldo sin conexión" =====
     Es el único archivo del shell que se sirve así, a propósito: es el que
     lleva el número de versión (APP_VERSION) y el que la propia aplicación
     vuelve a pedir en segundo plano para comprobar si hay una versión más
     reciente publicada. Si aquí se sirviera "caché primero" (como el resto
     del shell), esa comprobación de versión casi nunca vería la copia real
     del servidor, y el aviso de "hay una actualización disponible" dejaría
     de funcionar de forma fiable, sobre todo en móvil. Si no hay red (modo
     sin conexión), se cae de vuelta a la copia en caché para que la app
     siga arrancando igualmente. */
  if (req.mode === 'navigate' || esIndexHTML(url.pathname)) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copia = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(req, copia);
          });
        }
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  /* Resto del shell (manifest, iconos): estrategia conservadora "cache-first
     con revalidación en segundo plano", como antes. Estos archivos no
     necesitan estar siempre al segundo porque no llevan información de
     versión ni afectan a la detección de actualizaciones. */
  event.respondWith(
    caches.match(req).then(function (cached) {
      var actualizarCache = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copia = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(req, copia);
          });
        }
        return res;
      }).catch(function () {
        return cached;
      });
      return cached || actualizarCache;
    })
  );
});
