// Service worker del recetario.
// Siempre va primero a la red: nunca te deja con una version vieja.
// La cache es solo el paracaidas para cuando no hay senal en la cocina.
const CACHE = "mastercusine-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(["./", "./index.html", "./recetas.json", "./idiomas.json"]).catch(() => {})
    )
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                    // el chef va siempre a la red
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // fuentes y API, sin tocar

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
  );
});
