/**
 * FONHINCAS — Cliente del backend (Apps Script Web App)
 * Con reintento automático: la primera petición al Web App a veces devuelve
 * una página HTML intermedia mientras el contenedor de Apps Script arranca,
 * en vez del JSON esperado. Se reintenta un par de veces antes de fallar.
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

  return { fetchJson: fetchJson };
})();
