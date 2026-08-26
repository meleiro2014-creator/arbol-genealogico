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
   tiempo del necesario. */
const CACHE_NAME = 'libro-ancestros-v3';

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

  /* Estrategia conservadora "cache-first con revalidación en segundo plano":
     responde al instante con la copia en caché si existe (permite abrir la
     app sin conexión), y en paralelo intenta traer la versión de red para
     dejar la caché al día de cara a la próxima carga. Si no hay copia en
     caché (primera visita) y tampoco hay red, la petición simplemente falla,
     como sin Service Worker. */
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
