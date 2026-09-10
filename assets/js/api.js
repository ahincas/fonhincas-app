/**
 * FONHINCAS — Cliente del backend (Apps Script Web App)
 * Con reintento automático ante dos fallas transitorias conocidas:
 * 1) la primera petición a veces devuelve una página HTML intermedia
 *    mientras el contenedor de Apps Script arranca, en vez del JSON esperado.
 * 2) ocasionalmente el navegador "degrada" la redirección interna del POST
 *    a GET y pierde el cuerpo de la petición; eso aterriza en doGet() y
 *    devuelve el error de "Modo inválido" — también se reintenta.
 */
window.FonhincasAPI = (function () {
  var API_URL = 'https://script.google.com/macros/s/AKfycbxyJw-4kRWEwFFqlJmYM2B7iuyZsNbxJHT7hRDRObfHjJReY43AE6NCdGF6sbYZXEMM/exec';

  function fetchJson(params, intentos) {
    intentos = intentos || 3;
    var url = API_URL + '?' + new URLSearchParams(params).toString();

    return fetch(url)
      .then(function (res) { return res.text(); })
      .then(function (text) {
        try {
          return JSON.parse(text);
        } catch (e) {
          if (intentos > 1) {
            return new Promise(function (resolve) { setTimeout(resolve, 900); })
              .then(function () { return fetchJson(params, intentos - 1); });
          }
          throw new Error('El servidor no respondió correctamente. Intenta de nuevo en unos segundos.');
        }
      });
  }

  var ERROR_RUTA_PERDIDA = 'Modo inválido. Usa modo=plazo o modo=cuota.';

  function postJson(payload, intentos) {
    intentos = intentos || 3;

    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.text(); })
      .then(function (text) {
        var json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          json = null;
        }

        var necesitaReintento = json === null || (!json.ok && json.error === ERROR_RUTA_PERDIDA);

        if (necesitaReintento) {
          if (intentos > 1) {
            return new Promise(function (resolve) { setTimeout(resolve, 900); })
              .then(function () { return postJson(payload, intentos - 1); });
          }
          throw new Error('El servidor no respondió correctamente. Intenta de nuevo en unos segundos.');
        }

        return json;
      });
  }

  /**
   * Evita pedir dos veces, dentro de la misma pestaña, datos que casi no cambian
   * (servicios, tipos de movimiento). Guarda la respuesta en sessionStorage con
   * un TTL; navegaciones posteriores entre páginas reutilizan la copia en caché
   * en vez de esperar otra vez al backend.
   */
  function cached(key, ttlMs, loaderFn) {
    var storageKey = 'fh_cache_' + key;
    try {
      var raw = sessionStorage.getItem(storageKey);
      if (raw) {
        var entry = JSON.parse(raw);
        if (Date.now() - entry.t < ttlMs) return Promise.resolve(entry.v);
      }
    } catch (e) {
      // sessionStorage puede no estar disponible (modo privado, etc.); seguimos sin caché.
    }

    return loaderFn().then(function (json) {
      if (json && json.ok) {
        try { sessionStorage.setItem(storageKey, JSON.stringify({ t: Date.now(), v: json })); } catch (e) {}
      }
      return json;
    });
  }

  return { fetchJson: fetchJson, postJson: postJson, cached: cached };
})();
