/**
 * Pruebas mínimas para la lógica financiera y de generación de IDs.
 * Ejecutar manualmente desde el editor de Apps Script: función ejecutarPruebas.
 * (Sin guion bajo al final a propósito: Apps Script oculta del selector de funciones
 * cualquier función cuyo nombre termine en '_', tratándola como privada.)
 * Escribe en Logger; lanza un Error con el resumen de fallos si alguna prueba no pasa.
 */
function ejecutarPruebas() {
  var resultados = [];

  function assert(nombre, condicion) {
    resultados.push({ nombre: nombre, ok: !!condicion });
  }

  function assertCerca(nombre, actual, esperado, tolerancia) {
    tolerancia = tolerancia === undefined ? 0.01 : tolerancia;
    assert(nombre + ' (actual: ' + actual + ', esperado: ' + esperado + ')', Math.abs(actual - esperado) <= tolerancia);
  }

  // ---------- redondear_ ----------
  assertCerca('redondear_ dos decimales', redondear_(10.005), 10.01);
  assertCerca('redondear_ ya redondo', redondear_(100), 100);

  // ---------- simularPorPlazo_ ----------
  (function () {
    var sim = simularPorPlazo_(1000000, 0.02, 12);
    assert('simularPorPlazo_ plazo correcto', sim.plazo === 12);
    assert('simularPorPlazo_ tabla con 12 filas', sim.tabla.length === 12);
    assert('simularPorPlazo_ última cuota deja saldo 0', sim.tabla[11].saldoFinal === 0);
    var totalAbonos = redondear_(sim.tabla.reduce(function (acc, r) { return acc + r.abonoCapital; }, 0));
    assertCerca('simularPorPlazo_ suma de abonos == monto', totalAbonos, 1000000, 1);
  })();

  (function () {
    var sim = simularPorPlazo_(500000, 0, 10);
    assertCerca('simularPorPlazo_ tasa 0 -> cuota = monto/plazo', sim.cuota, 50000);
  })();

  // ---------- simularPorCuota_ ----------
  (function () {
    var porPlazo = simularPorPlazo_(1000000, 0.02, 12);
    var porCuota = simularPorCuota_(1000000, 0.02, porPlazo.cuota);
    assert('simularPorCuota_ plazo coherente con simularPorPlazo_', porCuota.plazo === porPlazo.plazo);
  })();

  // ---------- generarTabla_ ----------
  (function () {
    var tabla = generarTabla_(300000, 0.02, 6, 53000);
    var saldosOk = true;
    for (var i = 1; i < tabla.length; i++) {
      if (tabla[i].saldoInicial !== tabla[i - 1].saldoFinal) saldosOk = false;
    }
    assert('generarTabla_ saldoInicial encadena con saldoFinal anterior', saldosOk);
  })();

  // ---------- calcularFechaPago_ ----------
  assert('calcularFechaPago_ día <=14 -> 15 del mes siguiente', calcularFechaPago_('2026-03-05') === '2026-04-15');
  assert('calcularFechaPago_ día >14 -> fin del mes siguiente', calcularFechaPago_('2026-03-20') === '2026-04-30');
  assert('calcularFechaPago_ cruza fin de año', calcularFechaPago_('2026-12-20') === '2027-01-31');

  // ---------- sumarMeses_ ----------
  assert('sumarMeses_ suma simple', sumarMeses_('2026-01-15', 2) === '2026-03-15');
  assert('sumarMeses_ cruza año', sumarMeses_('2026-11-15', 3) === '2027-02-15');
  assert('sumarMeses_ ajusta día en mes corto', sumarMeses_('2026-01-31', 1) === '2026-02-28');

  // ---------- diasEntre_ ----------
  assert('diasEntre_ diferencia positiva', diasEntre_('2026-03-01', '2026-03-10') === 9);
  assert('diasEntre_ diferencia negativa', diasEntre_('2026-03-10', '2026-03-01') === -9);
  assert('diasEntre_ misma fecha', diasEntre_('2026-03-01', '2026-03-01') === 0);

  // ---------- fechaOpcionalPasada_ ----------
  function lanza(fn) { try { fn(); return false; } catch (err) { return true; } }
  assert('fechaOpcionalPasada_ vacía = hoy', fechaOpcionalPasada_('') === hoyBogota_());
  assert('fechaOpcionalPasada_ acepta fecha pasada', fechaOpcionalPasada_('2024-05-10') === '2024-05-10');
  assert('fechaOpcionalPasada_ rechaza fecha futura', lanza(function () { fechaOpcionalPasada_('2999-01-01'); }));
  assert('fechaOpcionalPasada_ rechaza formato inválido', lanza(function () { fechaOpcionalPasada_('10/05/2024'); }));

  // ---------- siguienteIdPrestamo_ / siguienteIdMovimiento_ (con guardado/restauración de las propiedades reales) ----------
  (function () {
    var props = PropertiesService.getScriptProperties();
    var previoPrestamo = props.getProperty('PROXIMO_ID_PRESTAMO');
    var previoMovimiento = props.getProperty('PROXIMO_ID_MOVIMIENTO');

    try {
      props.deleteProperty('PROXIMO_ID_PRESTAMO');
      props.deleteProperty('PROXIMO_ID_MOVIMIENTO');

      var id1 = siguienteIdPrestamo_();
      var id2 = siguienteIdPrestamo_();
      assert('siguienteIdPrestamo_ empieza en 1', id1 === 1);
      assert('siguienteIdPrestamo_ es incremental', id2 === 2);

      var m1 = siguienteIdMovimiento_();
      var m2 = siguienteIdMovimiento_();
      assert('siguienteIdMovimiento_ empieza en 0', m1 === 0);
      assert('siguienteIdMovimiento_ es incremental', m2 === 1);
    } finally {
      if (previoPrestamo === null) props.deleteProperty('PROXIMO_ID_PRESTAMO'); else props.setProperty('PROXIMO_ID_PRESTAMO', previoPrestamo);
      if (previoMovimiento === null) props.deleteProperty('PROXIMO_ID_MOVIMIENTO'); else props.setProperty('PROXIMO_ID_MOVIMIENTO', previoMovimiento);
    }
  })();

  // ---------- Resumen ----------
  var fallos = resultados.filter(function (r) { return !r.ok; });
  resultados.forEach(function (r) {
    Logger.log((r.ok ? '✓ ' : '✗ ') + r.nombre);
  });
  Logger.log(resultados.length - fallos.length + '/' + resultados.length + ' pruebas pasaron.');

  if (fallos.length) {
    throw new Error('Fallaron ' + fallos.length + ' prueba(s): ' + fallos.map(function (f) { return f.nombre; }).join('; '));
  }

  return { total: resultados.length, fallos: fallos.length };
}
