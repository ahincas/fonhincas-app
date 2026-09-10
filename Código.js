/**
 * FONHINCAS — Simulador de préstamo
 * Backend Apps Script: expone doGet() como API JSON para el front-end estático.
 */

var SPREADSHEET_ID = '19eegTaeEZt9USJ8UVBuCHpp0uGqXKWvFGvK1RM_c5mU';
var MAX_PLAZO_MESES = 36;
var CORREO_NOTIFICACION = 'ahincapiecpersonal@gmail.com';
var HOJA_SOLICITUDES = 'SOLICITUD';
var ZONA_HORARIA = 'America/Bogota';
var HORA_RECORDATORIO = '20:30:00-05:00';

/** Ejecuta esta función manualmente una vez desde el editor para autorizar los permisos (hoja de cálculo, correo y calendario). */
function autorizarPermisos() {
  getServiciosDisponibles_();
  MailApp.getRemainingDailyQuota();
  CalendarApp.getDefaultCalendar().getName();
}

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

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (body.accion === 'guardarSolicitud') {
      return jsonResponse_({ ok: true, data: guardarSolicitud_(body) });
    }

    throw new Error('Acción inválida.');
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

/** Valida y guarda una solicitud de préstamo en la hoja SOLICITUD, y notifica por correo. */
function guardarSolicitud_(body) {
  var nombre = String(body.nombre || '').trim();
  var fecha = String(body.fecha || '').trim();
  var servicio = String(body.servicio || '').trim();
  var monto = parseFloat(body.monto);
  var cuotas = parseInt(body.cuotas, 10);
  var linkPago = body.linkPago ? String(body.linkPago).trim() : '';
  var consignacion = body.consignacion || null;
  var banco = consignacion ? String(consignacion.banco || '').trim() : '';
  var cuentaLlave = consignacion ? String(consignacion.cuentaLlave || '').trim() : '';

  if (!nombre) throw new Error('El nombre es obligatorio.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('La fecha no es válida.');

  var hoy = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  if (fecha < hoy) throw new Error('La fecha no puede ser anterior a hoy.');

  if (getServiciosDisponibles_().indexOf(servicio) === -1) throw new Error('El servicio seleccionado no es válido.');
  if (!(monto > 0)) throw new Error('El monto debe ser mayor a 0.');
  if (!(cuotas >= 1 && cuotas <= MAX_PLAZO_MESES)) throw new Error('El número de cuotas debe estar entre 1 y ' + MAX_PLAZO_MESES + '.');

  var sheet = getOCrearHojaSolicitudes_();
  var estado = 'PENDIENTE';
  sheet.appendRow([new Date(), nombre, fecha, servicio, monto, cuotas, linkPago, banco, cuentaLlave, estado]);

  try {
    notificarSolicitud_({
      nombre: nombre, fecha: fecha, servicio: servicio, monto: monto, cuotas: cuotas,
      linkPago: linkPago, banco: banco, cuentaLlave: cuentaLlave
    });
  } catch (err) {
    // La solicitud ya quedó guardada; un fallo al notificar no debe reportarse como error de guardado.
  }

  try {
    crearRecordatorioCalendario_(nombre);
  } catch (err) {
    // Igual que con el correo: un fallo al crear el evento no debe invalidar el guardado.
  }

  return { fila: sheet.getLastRow(), estado: estado };
}

/** Obtiene la hoja SOLICITUD, creándola con encabezados si todavía no existe. */
function getOCrearHojaSolicitudes_() {
  var libro = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = libro.getSheetByName(HOJA_SOLICITUDES);
  if (!sheet) {
    sheet = libro.insertSheet(HOJA_SOLICITUDES);
    sheet.appendRow(['Marca temporal', 'Nombre', 'Fecha', 'Servicio', 'Monto', 'Cuotas', 'Link de pago', 'Banco', 'Cuenta o llave', 'Estado']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Crea un evento a las 8:30 p. m. (hora Bogotá) para revisar la solicitud: hoy si aún no ha pasado esa hora, si no, mañana. */
function crearRecordatorioCalendario_(nombreSolicitante) {
  var hoyStr = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  var inicio = new Date(hoyStr + 'T' + HORA_RECORDATORIO);

  if (new Date() > inicio) {
    inicio = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  }

  var fin = new Date(inicio.getTime() + 30 * 60 * 1000);
  CalendarApp.getDefaultCalendar().createEvent(
    'Revisar nueva solicitud de préstamo — ' + nombreSolicitante,
    inicio,
    fin
  );
}

function notificarSolicitud_(datos) {
  var asunto = 'Nueva solicitud de préstamo — ' + datos.nombre;
  var cuerpo = 'Se registró una nueva solicitud en FONHINCAS:\n\n' +
    'Nombre: ' + datos.nombre + '\n' +
    'Fecha: ' + datos.fecha + '\n' +
    'Servicio: ' + datos.servicio + '\n' +
    'Monto: ' + datos.monto + '\n' +
    'Cuotas: ' + datos.cuotas + '\n' +
    (datos.linkPago ? 'Link de pago: ' + datos.linkPago + '\n' : '') +
    (datos.banco ? 'Banco: ' + datos.banco + '\nCuenta o llave: ' + datos.cuentaLlave + '\n' : '') +
    '\nEstado: PENDIENTE';

  MailApp.sendEmail(CORREO_NOTIFICACION, asunto, cuerpo);
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
  if (!(plazo > 0 && plazo <= MAX_PLAZO_MESES)) throw new Error('El plazo debe estar entre 1 y ' + MAX_PLAZO_MESES + ' meses.');

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

  if (plazo > MAX_PLAZO_MESES) throw new Error('Con esa cuota el plazo supera el máximo de ' + MAX_PLAZO_MESES + ' meses. Aumenta el valor de la cuota.');

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

