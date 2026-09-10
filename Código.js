/**
 * FONHINCAS — Simulador de préstamo
 * Backend Apps Script: expone doGet() como API JSON para el front-end estático.
 */

var SPREADSHEET_ID = '19eegTaeEZt9USJ8UVBuCHpp0uGqXKWvFGvK1RM_c5mU';

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};

    if (params.accion === 'servicios') {
      return jsonResponse_({ ok: true, data: { servicios: getServiciosDisponibles_() } });
    }

    var monto = parseFloat(params.monto);
    var tasa = getTasaMensual_();
    var resultado;

    if (params.modo === 'plazo') {
      resultado = simularPorPlazo_(monto, tasa, parseInt(params.plazo, 10));
    } else if (params.modo === 'cuota') {
      resultado = simularPorCuota_(monto, tasa, parseFloat(params.cuota));
    } else {
      throw new Error('Modo inválido. Usa modo=plazo o modo=cuota.');
    }

    return jsonResponse_({ ok: true, data: resultado });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

/** Lee la lista de servicios válidos: todos los valores bajo la columna NOMBRE_SERVICIO en CONFIGURACION. */
function getServiciosDisponibles_() {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('CONFIGURACION');
  if (!sheet) throw new Error('No se encontró la hoja CONFIGURACION.');

  var data = sheet.getDataRange().getValues();
  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      if (String(data[r][c]).trim().toUpperCase() === 'NOMBRE_SERVICIO') {
        var servicios = [];
        for (var i = r + 1; i < data.length; i++) {
          var valor = String(data[i][c]).trim();
          if (!valor) break;
          servicios.push(valor);
        }
        return servicios;
      }
    }
  }
  throw new Error('No se encontró la columna NOMBRE_SERVICIO en CONFIGURACION.');
}

/** Lee el valor en la celda inmediatamente debajo de la etiqueta TASA_MENSUAL, en la hoja CONFIGURACION. */
function getTasaMensual_() {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('CONFIGURACION');
  if (!sheet) throw new Error('No se encontró la hoja CONFIGURACION.');

  var data = sheet.getDataRange().getValues();
  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      if (String(data[r][c]).trim().toUpperCase() === 'TASA_MENSUAL') {
        var valor = data[r + 1] && data[r + 1][c];
        var tasa = Number(valor);
        if (!(tasa > 0)) throw new Error('TASA_MENSUAL no tiene un valor numérico válido.');
        return tasa;
      }
    }
  }
  throw new Error('No se encontró la etiqueta TASA_MENSUAL en CONFIGURACION.');
}

/** Modo 1: conocido el monto y el plazo, calcula la cuota fija (sistema de amortización francés). */
function simularPorPlazo_(monto, tasa, plazo) {
  if (!(monto > 0)) throw new Error('El monto debe ser mayor a 0.');
  if (!(plazo > 0)) throw new Error('El plazo debe ser mayor a 0.');

  var cuota = tasa === 0
    ? monto / plazo
    : (monto * tasa) / (1 - Math.pow(1 + tasa, -plazo));
  cuota = redondear_(cuota);

  return {
    monto: monto,
    plazo: plazo,
    cuota: cuota,
    tabla: generarTabla_(monto, tasa, plazo, cuota)
  };
}

/** Modo 2: conocido el monto y la cuota deseada, calcula el plazo necesario (meses). */
function simularPorCuota_(monto, tasa, cuota) {
  if (!(monto > 0)) throw new Error('El monto debe ser mayor a 0.');
  if (!(cuota > 0)) throw new Error('La cuota debe ser mayor a 0.');

  var interesMinimo = monto * tasa;
  if (tasa > 0 && cuota <= interesMinimo) {
    throw new Error('La cuota es muy baja para cubrir el interés mensual. Debe ser mayor a $' + Math.ceil(interesMinimo) + '.');
  }

  var plazo = tasa === 0
    ? Math.ceil(monto / cuota)
    : Math.ceil(-Math.log(1 - (tasa * monto) / cuota) / Math.log(1 + tasa));

  if (plazo > 600) throw new Error('El plazo resultante es demasiado largo. Aumenta el valor de la cuota.');

  return {
    monto: monto,
    plazo: plazo,
    cuota: cuota,
    tabla: generarTabla_(monto, tasa, plazo, cuota)
  };
}

/** Genera la tabla de amortización mes a mes. El último mes ajusta el pago para saldar el préstamo exacto. */
function generarTabla_(monto, tasa, plazo, cuota) {
  var saldo = monto;
  var tabla = [];

  for (var mes = 1; mes <= plazo; mes++) {
    var saldoInicial = saldo;
    var interes = redondear_(saldoInicial * tasa);
    var cuotaMes, abonoCapital, saldoFinal;

    if (mes === plazo) {
      cuotaMes = redondear_(saldoInicial + interes);
      abonoCapital = saldoInicial;
      saldoFinal = 0;
    } else {
      cuotaMes = cuota;
      abonoCapital = redondear_(cuotaMes - interes);
      saldoFinal = redondear_(saldoInicial - abonoCapital);
    }

    tabla.push({
      mes: mes,
      saldoInicial: saldoInicial,
      cuota: cuotaMes,
      interes: interes,
      abonoCapital: abonoCapital,
      saldoFinal: saldoFinal
    });

    saldo = saldoFinal;
  }

  return tabla;
}

function redondear_(n) {
  return Math.round(n * 100) / 100;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

