/**
 * FONHINCAS — Simulador de préstamo
 * Backend Apps Script: expone doGet() como API JSON para el front-end estático.
 */

var SPREADSHEET_ID = '19eegTaeEZt9USJ8UVBuCHpp0uGqXKWvFGvK1RM_c5mU';
var MAX_PLAZO_MESES = 36;
var CORREO_NOTIFICACION = 'ahincapiecpersonal@gmail.com';
var HOJA_SOLICITUDES = 'SOLICITUD';
var HOJA_PRESTAMOS = 'PRESTAMOS_ACTIVOS';
var HOJA_HISTORIAL = 'PRESTAMOS_HISTORIAL';
var HOJA_MOVIMIENTOS = 'MOVIMIENTOS';
var ZONA_HORARIA = 'America/Bogota';
var HORA_RECORDATORIO = '20:30:00-05:00';
var MESES_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
var UMBRAL_CIERRE = 1; // "debe" en pesos por debajo del cual el préstamo se considera listo para cerrar
var PRESTAMOS_HEADERS = [
  'Fecha de revisión', 'Administrador', 'ID préstamo', 'Nombre', 'Monto', 'Cuotas', 'Valor cuota', 'Tasa interés',
  'Fecha de pago', 'Observaciones', 'PDF', 'Pagado', 'Debe', 'Cuotas faltan', 'Siguiente cuota', 'Estado'
];
var SOLICITUD_HEADERS = [
  'Marca temporal', 'Nombre', 'Correo', 'Fecha', 'Servicio', 'Monto', 'Cuotas', 'Link de pago', 'Banco', 'Cuenta o llave', 'Estado'
];

/**
 * ---------- Rendimiento ----------
 * SpreadsheetApp.openById() y la lectura de CONFIGURACION se repetían varias veces
 * por cada solicitud (hasta 4 lecturas separadas de la misma hoja de configuración
 * en una sola aprobación de préstamo). getLibro_() cachea el libro por ejecución;
 * leerConfiguracion_() lee CONFIGURACION una sola vez por ejecución y, además,
 * cachea el resultado entre ejecuciones (CacheService, 60s) ya que cambia muy poco.
 */
var _libroCache = null;
function getLibro_() {
  if (!_libroCache) _libroCache = SpreadsheetApp.openById(SPREADSHEET_ID);
  return _libroCache;
}

var _configCache = null;
function leerConfiguracion_() {
  if (_configCache) return _configCache;

  try {
    var enCache = CacheService.getScriptCache().get('config_v1');
    if (enCache) {
      _configCache = JSON.parse(enCache);
      return _configCache;
    }
  } catch (err) {
    // Si CacheService falla por cualquier razón, seguimos con la lectura normal de la hoja.
  }

  var sheet = getLibro_().getSheetByName('CONFIGURACION');
  if (!sheet) throw new Error('No se encontró la hoja CONFIGURACION.');
  var data = sheet.getDataRange().getValues();

  var config = { tasaMensual: null, servicios: [], administradores: [], tiposMovimiento: [] };

  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var etiqueta = String(data[r][c]).trim().toUpperCase();
      var siguiente = String(data[r][c + 1]).trim().toUpperCase();

      if (etiqueta === 'TASA_MENSUAL' && config.tasaMensual === null) {
        config.tasaMensual = Number(data[r + 1] && data[r + 1][c]);
      } else if (etiqueta === 'NOMBRE_SERVICIO' && !config.servicios.length) {
        for (var i1 = r + 1; i1 < data.length; i1++) {
          var svc = String(data[i1][c]).trim();
          if (!svc) break;
          config.servicios.push(svc);
        }
      } else if (etiqueta === 'USUARIO' && siguiente === 'CONTRASEÑA' && !config.administradores.length) {
        for (var i2 = r + 1; i2 < data.length; i2++) {
          var usr = String(data[i2][c]).trim();
          if (!usr) break;
          config.administradores.push({ usuario: usr, contrasena: String(data[i2][c + 1]) });
        }
      } else if (etiqueta === 'TIPO' && siguiente === 'MOVIMIENTO' && !config.tiposMovimiento.length) {
        for (var i3 = r + 1; i3 < data.length; i3++) {
          var tipo = String(data[i3][c]).trim();
          if (!tipo) break;
          var signo = String(data[i3][c + 1]).trim().toUpperCase();
          config.tiposMovimiento.push({ tipo: tipo, signo: (signo === '+' || signo === 'SUMA') ? '+' : '-' });
        }
      }
    }
  }

  if (!(config.tasaMensual > 0)) throw new Error('TASA_MENSUAL no tiene un valor numérico válido en CONFIGURACION.');
  if (!config.servicios.length) throw new Error('No se encontró la columna NOMBRE_SERVICIO en CONFIGURACION.');
  if (!config.administradores.length) throw new Error('No se encontraron las columnas Usuario/Contraseña en CONFIGURACION.');
  if (!config.tiposMovimiento.length) throw new Error('No se encontraron las columnas TIPO/MOVIMIENTO en CONFIGURACION.');

  _configCache = config;
  try {
    CacheService.getScriptCache().put('config_v1', JSON.stringify(config), 60);
  } catch (err) {
    // Sin caché entre ejecuciones no pasa nada grave; ya quedó en _configCache para esta ejecución.
  }
  return config;
}

/** Ejecuta esta función manualmente una vez desde el editor para autorizar los permisos (hoja de cálculo, correo, calendario y Drive/Docs). */
function autorizarPermisos() {
  getServiciosDisponibles_();
  MailApp.getRemainingDailyQuota();
  CalendarApp.getDefaultCalendar().getName();
  DriveApp.getRootFolder().getName();

  var doc = DocumentApp.create('tmp_autorizacion');
  DriveApp.getFileById(doc.getId()).setTrashed(true);
}

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};

    if (params.accion === 'servicios') {
      return jsonResponse_({ ok: true, data: { servicios: getServiciosDisponibles_() } });
    }

    // Consulta pública de préstamos: sin autenticación (a propósito, ver consultarPrestamos_).
    if (params.accion === 'usuariosPrestamos') {
      return jsonResponse_({ ok: true, data: { usuarios: listarUsuariosPrestamos_() } });
    }
    if (params.accion === 'consultarPrestamos') {
      return jsonResponse_({ ok: true, data: { prestamos: consultarPrestamos_(params.usuario, params.estado) } });
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

    switch (body.accion) {
      case 'guardarSolicitud':
        return jsonResponse_({ ok: true, data: guardarSolicitud_(body) });
      case 'login':
        validarAdmin_(body.usuario, body.contrasena);
        return jsonResponse_({ ok: true, data: { usuario: String(body.usuario).trim() } });
      case 'listarSolicitudes':
        validarAdmin_(body.usuario, body.contrasena);
        return jsonResponse_({ ok: true, data: { solicitudes: listarSolicitudes_() } });
      case 'detalleSolicitud':
        validarAdmin_(body.usuario, body.contrasena);
        return jsonResponse_({ ok: true, data: detalleSolicitud_(parseInt(body.fila, 10)) });
      case 'guardarPrestamo':
        return jsonResponse_({ ok: true, data: guardarPrestamo_(body) });
      case 'tiposMovimiento':
        validarAdmin_(body.usuario, body.contrasena);
        return jsonResponse_({ ok: true, data: { tipos: getTiposMovimiento_() } });
      case 'listarPrestamosActivos':
        validarAdmin_(body.usuario, body.contrasena);
        return jsonResponse_({ ok: true, data: { prestamos: listarPrestamosActivos_() } });
      case 'registrarMovimiento':
        return jsonResponse_({ ok: true, data: registrarMovimiento_(body) });
      case 'listarPrestamosPorCerrar':
        validarAdmin_(body.usuario, body.contrasena);
        return jsonResponse_({ ok: true, data: { prestamos: listarPrestamosPorCerrar_() } });
      case 'cerrarPrestamo':
        return jsonResponse_({ ok: true, data: cerrarPrestamo_(body) });
      case 'limpiarDatosPrueba':
        // SOLO para la fase de desarrollo: borra filas de datos (no encabezados) de
        // SOLICITUD, PRESTAMOS_ACTIVOS y MOVIMIENTOS, para que los ID consecutivos
        // vuelvan a empezar en 0/1. Quitar esta acción antes del primer release.
        validarAdmin_(body.usuario, body.contrasena);
        return jsonResponse_({ ok: true, data: limpiarDatosPrueba_() });
      default:
        throw new Error('Acción inválida.');
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

/** Valida y guarda una solicitud de préstamo en la hoja SOLICITUD, y notifica por correo. */
function guardarSolicitud_(body) {
  var nombre = String(body.nombre || '').trim();
  var correo = String(body.correo || '').trim();
  var fecha = String(body.fecha || '').trim();
  var servicio = String(body.servicio || '').trim();
  var monto = parseFloat(body.monto);
  var cuotas = parseInt(body.cuotas, 10);
  var linkPago = body.linkPago ? String(body.linkPago).trim() : '';
  var consignacion = body.consignacion || null;
  var banco = consignacion ? String(consignacion.banco || '').trim() : '';
  var cuentaLlave = consignacion ? String(consignacion.cuentaLlave || '').trim() : '';

  if (!nombre) throw new Error('El nombre es obligatorio.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('El correo no es válido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('La fecha no es válida.');

  var hoy = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  if (fecha < hoy) throw new Error('La fecha no puede ser anterior a hoy.');

  if (getServiciosDisponibles_().indexOf(servicio) === -1) throw new Error('El servicio seleccionado no es válido.');
  if (!(monto > 0)) throw new Error('El monto debe ser mayor a 0.');
  if (!(cuotas >= 1 && cuotas <= MAX_PLAZO_MESES)) throw new Error('El número de cuotas debe estar entre 1 y ' + MAX_PLAZO_MESES + '.');

  var sheet = getOCrearHojaSolicitudes_();
  var estado = 'PENDIENTE';
  sheet.appendRow([new Date(), nombre, correo, fecha, servicio, monto, cuotas, linkPago, banco, cuentaLlave, estado]);

  try {
    notificarSolicitud_({
      nombre: nombre, correo: correo, fecha: fecha, servicio: servicio, monto: monto, cuotas: cuotas,
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

/** Valida credenciales contra la lista Usuario/Contraseña en CONFIGURACION. Lanza error si no coinciden. */
function validarAdmin_(usuario, contrasena) {
  usuario = String(usuario || '').trim();
  contrasena = String(contrasena || '');
  if (!usuario || !contrasena) throw new Error('Usuario y contraseña son obligatorios.');

  var administradores = getAdministradores_();
  for (var i = 0; i < administradores.length; i++) {
    if (administradores[i].usuario === usuario && administradores[i].contrasena === contrasena) return true;
  }
  throw new Error('Usuario o contraseña incorrectos.');
}

/** Usuario/Contraseña configurados en CONFIGURACION (ver leerConfiguracion_). */
function getAdministradores_() {
  return leerConfiguracion_().administradores;
}

/** Lista las solicitudes pendientes (hoja SOLICITUD), con el número de fila como identificador. */
function listarSolicitudes_() {
  var data = getOCrearHojaSolicitudes_().getDataRange().getValues();
  var out = [];
  for (var r = 1; r < data.length; r++) {
    var fila = data[r];
    if (!fila[1]) continue;
    out.push({
      fila: r + 1,
      nombre: fila[1], correo: fila[2], fecha: formatearFechaCelda_(fila[3]), servicio: fila[4], monto: fila[5], cuotas: fila[6],
      linkPago: fila[7], banco: fila[8], cuentaLlave: fila[9], estado: fila[10]
    });
  }
  return out;
}

/** Calcula, para una solicitud puntual, la cuota, la tabla de amortización y la fecha de pago sugerida. */
function detalleSolicitud_(fila) {
  var sheet = getOCrearHojaSolicitudes_();
  if (!(fila >= 2)) throw new Error('Solicitud inválida.');
  var datos = sheet.getRange(fila, 1, 1, SOLICITUD_HEADERS.length).getValues()[0];
  if (!datos[1]) throw new Error('La solicitud ya no existe (puede que ya haya sido procesada).');

  var nombre = datos[1], correo = datos[2], fechaSolicitud = formatearFechaCelda_(datos[3]), servicio = datos[4];
  var monto = Number(datos[5]), cuotas = Number(datos[6]);
  var tasa = getTasaMensual_();
  var sim = simularPorPlazo_(monto, tasa, cuotas);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');

  return {
    fila: fila, nombre: nombre, correo: correo, fechaSolicitud: fechaSolicitud, servicio: servicio,
    monto: monto, cuotas: cuotas, tasa: tasa, cuota: sim.cuota, tabla: sim.tabla,
    fechaRevision: hoy, fechaPago: calcularFechaPago_(hoy)
  };
}

/**
 * La fecha de pago es la quincena más cercana del mes SIGUIENTE a la fecha base:
 * si la fecha base es del 1 al 14, paga el 15 del mes siguiente;
 * si es del 15 en adelante, paga el último día del mes siguiente.
 */
function calcularFechaPago_(fechaBaseStr) {
  var partes = fechaBaseStr.split('-');
  var anio = parseInt(partes[0], 10);
  var mes = parseInt(partes[1], 10) - 1;
  var dia = parseInt(partes[2], 10);

  var mesSiguiente = mes + 1;
  var anioSiguiente = anio;
  if (mesSiguiente > 11) { mesSiguiente = 0; anioSiguiente++; }

  var diaPago = dia <= 14 ? 15 : new Date(anioSiguiente, mesSiguiente + 1, 0).getDate();

  return anioSiguiente + '-' + pad2_(mesSiguiente + 1) + '-' + pad2_(diaPago);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Sheets a veces autoconvierte texto tipo fecha a un valor Date real; esto lo vuelve a 'yyyy-MM-dd' de forma consistente. */
function formatearFechaCelda_(valor) {
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return Utilities.formatDate(valor, ZONA_HORARIA, 'yyyy-MM-dd');
  }
  return String(valor);
}

/** Lee una celda que debe ser numérica; si Sheets la devuelve como fecha (formato de columna corrupto) falla con un mensaje claro en vez de calcular disparates. */
function numeroDeCelda_(valor) {
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    throw new Error('Una celda numérica quedó con formato de fecha en la hoja. Revisa el formato de la columna y corrígelo (número, no fecha).');
  }
  var n = Number(valor);
  if (isNaN(n)) throw new Error('Se encontró un valor no numérico donde se esperaba un número.');
  return n;
}

/** Aprueba una solicitud: calcula todo, genera el PDF, lo guarda en Drive, mueve el registro a PRESTAMOS_ACTIVOS y borra la solicitud. */
function guardarPrestamo_(body) {
  validarAdmin_(body.usuario, body.contrasena);

  var fila = parseInt(body.fila, 10);
  var detalle = detalleSolicitud_(fila);
  var observaciones = body.observaciones ? String(body.observaciones).trim() : '';

  if (!body.firma) throw new Error('La firma es obligatoria.');
  var firmaBlob = blobFromDataUrl_(body.firma, 'firma.png');
  var fotoBlob = body.fotoDesembolso ? blobFromDataUrl_(body.fotoDesembolso, 'desembolso.png') : null;

  var administrador = String(body.usuario).trim();
  var hojaPrestamos = getOCrearHojaPrestamos_();
  var idPrestamo = hojaPrestamos.getLastRow(); // fila 1 = encabezado, así que el conteo de filas existentes ya es el siguiente id

  var pdf = generarPdfPrestamo_({
    idPrestamo: idPrestamo, administrador: administrador, fechaRevision: detalle.fechaRevision,
    nombre: detalle.nombre, servicio: detalle.servicio, monto: detalle.monto, cuotas: detalle.cuotas,
    cuota: detalle.cuota, tasa: detalle.tasa, fechaPago: detalle.fechaPago, observaciones: observaciones,
    tabla: detalle.tabla, firmaBlob: firmaBlob, fotoBlob: fotoBlob
  });

  var carpeta = getOCrearCarpetaRespaldosMes_();
  var nombreArchivo = 'Prestamo_' + idPrestamo + '_' + detalle.nombre.replace(/[^a-zA-Z0-9]+/g, '_') + '.pdf';
  var archivoPdf = carpeta.createFile(pdf).setName(nombreArchivo);

  var montoTotalAPagar = redondear_(detalle.tabla.reduce(function (acc, r) { return acc + r.cuota; }, 0));

  hojaPrestamos.appendRow([
    detalle.fechaRevision, administrador, idPrestamo, detalle.nombre, detalle.monto, detalle.cuotas,
    detalle.cuota, detalle.tasa, detalle.fechaPago, observaciones, archivoPdf.getUrl(),
    0, montoTotalAPagar, detalle.cuotas, detalle.tabla[0].cuota, 'ACTIVO'
  ]);

  getOCrearHojaSolicitudes_().deleteRow(fila);

  try {
    var tipoDesembolso = getTiposMovimiento_().filter(function (t) { return t.tipo.toUpperCase() === 'DESEMBOLSO'; })[0];
    if (tipoDesembolso) {
      var cantidadDesembolso = tipoDesembolso.signo === '-' ? -detalle.monto : detalle.monto;
      insertarMovimiento_(tipoDesembolso.tipo, idPrestamo, detalle.nombre, cantidadDesembolso, 'Desembolso automático al aprobar el préstamo.');
    }
  } catch (err) {
    // El préstamo ya quedó guardado; un fallo al registrar el desembolso automático no debe invalidar la aprobación.
  }

  try {
    crearEventosCuotasPrestamo_(idPrestamo, detalle.nombre, detalle.cuotas, detalle.cuota, detalle.fechaPago);
  } catch (err) {
    // Igual que con el desembolso: si fallan los eventos de calendario, el préstamo ya quedó aprobado.
  }

  try {
    if (detalle.correo) notificarAprobacion_(detalle.correo, detalle.nombre, pdf, nombreArchivo);
  } catch (err) {
    // El préstamo ya quedó guardado; un fallo al enviar el correo no debe invalidar la aprobación.
  }

  return { idPrestamo: idPrestamo, pdfUrl: archivoPdf.getUrl() };
}

/** Crea un evento de todo el día por cada cuota, uno por mes, empezando en la fecha de la primera cuota. */
function crearEventosCuotasPrestamo_(idPrestamo, nombre, cuotas, valorCuota, fechaPrimeraCuota) {
  var calendario = CalendarApp.getDefaultCalendar();
  var montoTexto = '$' + Math.round(valorCuota).toLocaleString('es-CO');

  for (var i = 0; i < cuotas; i++) {
    var fechaStr = i === 0 ? fechaPrimeraCuota : sumarMeses_(fechaPrimeraCuota, i);
    var fecha = new Date(fechaStr + 'T12:00:00-05:00');
    calendario.createAllDayEvent(
      'Cuota ' + (i + 1) + '/' + cuotas + ' — ' + nombre + ' — ' + montoTexto + ' (Préstamo N.º ' + idPrestamo + ')',
      fecha
    );
  }
}

/** Envía al correo del solicitante la notificación de aprobación, con el PDF del préstamo adjunto. */
function notificarAprobacion_(correo, nombre, pdfBlob, nombreArchivo) {
  var asunto = '¡Tu préstamo fue aprobado! — FONHINCAS';
  var cuerpo = 'Hola ' + nombre + ',\n\n' +
    '¡Felicidades por hacer parte de nuestra familia! Tu préstamo fue aprobado y el dinero ya fue desembolsado. ' +
    'Próximamente se verá reflejado en el medio que elegiste.\n\n' +
    'Puedes consultar los detalles en el documento adjunto o en nuestra página web, en la función "Consultar".\n\n' +
    '— FONHINCAS';

  MailApp.sendEmail({
    to: correo,
    subject: asunto,
    body: cuerpo,
    attachments: [pdfBlob.setName(nombreArchivo)]
  });
}

/** Construye el PDF del préstamo (datos + tabla de amortización + firma + foto del desembolso) y lo devuelve como blob. */
function generarPdfPrestamo_(d) {
  var doc = DocumentApp.create('tmp_prestamo_' + d.idPrestamo);
  var body = doc.getBody();

  body.appendParagraph('FONHINCAS — Préstamo N.º ' + d.idPrestamo).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph('Fecha de revisión: ' + d.fechaRevision);
  body.appendParagraph('Administrador: ' + d.administrador);
  body.appendParagraph('Nombre del solicitante: ' + d.nombre);
  body.appendParagraph('Servicio: ' + d.servicio);
  body.appendParagraph('Monto: ' + d.monto);
  body.appendParagraph('Número de cuotas: ' + d.cuotas);
  body.appendParagraph('Valor de la cuota: ' + d.cuota);
  body.appendParagraph('Tasa de interés mensual: ' + (d.tasa * 100).toFixed(2) + '%');
  body.appendParagraph('Fecha de pago: ' + d.fechaPago);
  body.appendParagraph('Observaciones: ' + (d.observaciones || '—'));

  body.appendParagraph('Anexo 1 — Tabla de amortización').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  var filas = [['Mes', 'Saldo inicial', 'Cuota', 'Interés', 'Abono capital', 'Saldo final']];
  d.tabla.forEach(function (r) {
    filas.push([String(r.mes), String(r.saldoInicial), String(r.cuota), String(r.interes), String(r.abonoCapital), String(r.saldoFinal)]);
  });
  body.appendTable(filas);

  body.appendParagraph('Firma').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendImage(d.firmaBlob).setWidth(220);

  if (d.fotoBlob) {
    body.appendParagraph('Anexo 2 — Foto del desembolso').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendImage(d.fotoBlob).setWidth(350);
  }

  doc.saveAndClose();
  var archivo = DriveApp.getFileById(doc.getId());
  var pdf = archivo.getAs('application/pdf');
  archivo.setTrashed(true);
  return pdf;
}

/** Decodifica un data URL ("data:image/png;base64,...") a un Blob de Apps Script. */
function blobFromDataUrl_(dataUrl, nombreArchivo) {
  var match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Formato de imagen inválido.');
  return Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], nombreArchivo);
}

/** Carpeta de Drive respaldos/AAAA_MES (hoy), creándola si no existe. */
function getOCrearCarpetaRespaldosMes_() {
  var ahora = new Date();
  var anio = Utilities.formatDate(ahora, ZONA_HORARIA, 'yyyy');
  var mesIdx = parseInt(Utilities.formatDate(ahora, ZONA_HORARIA, 'M'), 10) - 1;
  var nombreCarpeta = anio + '_' + MESES_ES[mesIdx];

  var raiz = getOCrearCarpetaHija_(DriveApp.getRootFolder(), 'respaldos');
  return getOCrearCarpetaHija_(raiz, nombreCarpeta);
}

function getOCrearCarpetaHija_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  if (it.hasNext()) return it.next();
  return padre.createFolder(nombre);
}

/** Solo desarrollo: vacía las filas de datos de SOLICITUD, PRESTAMOS_ACTIVOS y MOVIMIENTOS (conserva encabezados). */
function limpiarDatosPrueba_() {
  var hojas = [getOCrearHojaSolicitudes_(), getOCrearHojaPrestamos_(), getOCrearHojaMovimientos_(), getOCrearHojaHistorial_()];
  var limpiadas = [];
  hojas.forEach(function (sheet) {
    var filas = sheet.getLastRow() - 1;
    if (filas > 0) sheet.deleteRows(2, filas);
    limpiadas.push(sheet.getName());
  });
  return { limpiadas: limpiadas };
}

/** Obtiene la hoja PRESTAMOS_ACTIVOS, creándola (o migrando sus encabezados, si está vacía) según PRESTAMOS_HEADERS. */
function getOCrearHojaPrestamos_() {
  var libro = getLibro_();
  var sheet = libro.getSheetByName(HOJA_PRESTAMOS);
  if (!sheet) {
    sheet = libro.insertSheet(HOJA_PRESTAMOS);
    sheet.appendRow(PRESTAMOS_HEADERS);
    sheet.setFrozenRows(1);
    forzarFormatoNumericoPrestamos_(sheet);
  } else if (sheet.getLastRow() <= 1) {
    sheet.getRange(1, 1, 1, PRESTAMOS_HEADERS.length).setValues([PRESTAMOS_HEADERS]);
    forzarFormatoNumericoPrestamos_(sheet);
  }
  return sheet;
}

/**
 * Fuerza formato numérico plano en las columnas de PRESTAMOS_ACTIVOS que deben ser números
 * (Monto, Cuotas, Valor cuota, Tasa interés, Pagado, Debe, Cuotas faltan, Siguiente cuota).
 * Evita que Sheets las reinterprete como fecha (p. ej. una tasa de 0.01 mostrada como 1899-12-30),
 * algo que ya pasó durante el desarrollo tras varios cambios de columnas.
 */
function forzarFormatoNumericoPrestamos_(sheet) {
  ['E:E', 'F:F', 'G:G', 'H:H', 'L:L', 'M:M', 'N:N', 'O:O'].forEach(function (col) {
    sheet.getRange(col).setNumberFormat('0.00');
  });
}

/** Obtiene la hoja PRESTAMOS_HISTORIAL, creándola con encabezados si todavía no existe. */
function getOCrearHojaHistorial_() {
  var libro = getLibro_();
  var sheet = libro.getSheetByName(HOJA_HISTORIAL);
  if (!sheet) {
    sheet = libro.insertSheet(HOJA_HISTORIAL);
    sheet.appendRow(PRESTAMOS_HEADERS.concat(['Fecha de cierre']));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Obtiene la hoja MOVIMIENTOS, creándola con encabezados si todavía no existe. */
function getOCrearHojaMovimientos_() {
  var libro = getLibro_();
  var sheet = libro.getSheetByName(HOJA_MOVIMIENTOS);
  if (!sheet) {
    sheet = libro.insertSheet(HOJA_MOVIMIENTOS);
    sheet.appendRow(['ID', 'Fecha', 'Tipo', 'ID préstamo', 'Nombre', 'Cantidad', 'Comentarios']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Tipos de movimiento (Tipo/Movimiento) configurados en CONFIGURACION (ver leerConfiguracion_). */
function getTiposMovimiento_() {
  return leerConfiguracion_().tiposMovimiento;
}

/** Lista los préstamos activos (hoja PRESTAMOS_ACTIVOS), con su estado de pago. */
function listarPrestamosActivos_() {
  var data = getOCrearHojaPrestamos_().getDataRange().getValues();
  var out = [];
  for (var r = 1; r < data.length; r++) {
    var fila = data[r];
    if (fila[2] === '' || fila[2] === null) continue;
    out.push({
      fila: r + 1, idPrestamo: Number(fila[2]), nombre: fila[3], monto: numeroDeCelda_(fila[4]), cuotas: numeroDeCelda_(fila[5]),
      valorCuota: numeroDeCelda_(fila[6]), tasa: numeroDeCelda_(fila[7]), fechaPago: formatearFechaCelda_(fila[8]),
      pagado: numeroDeCelda_(fila[11]), debe: numeroDeCelda_(fila[12]), cuotasFaltan: numeroDeCelda_(fila[13]),
      siguienteCuota: numeroDeCelda_(fila[14]), estado: fila[15]
    });
  }
  return out;
}

/** Préstamos activos cuyo saldo (Debe) ya está en o por debajo del umbral de cierre. */
function listarPrestamosPorCerrar_() {
  return listarPrestamosActivos_().filter(function (p) { return p.estado === 'POR_CERRAR'; });
}

/** Lista los préstamos ya cerrados (hoja PRESTAMOS_HISTORIAL). */
function listarHistorial_() {
  var data = getOCrearHojaHistorial_().getDataRange().getValues();
  var out = [];
  for (var r = 1; r < data.length; r++) {
    var fila = data[r];
    if (!fila[3]) continue;
    out.push({
      idPrestamo: Number(fila[2]), nombre: fila[3], monto: numeroDeCelda_(fila[4]), cuotas: numeroDeCelda_(fila[5]),
      valorCuota: numeroDeCelda_(fila[6]), pagado: numeroDeCelda_(fila[11]), fechaCierre: formatearFechaCelda_(fila[16])
    });
  }
  return out;
}

/** Todos los nombres que aparecen en SOLICITUD, PRESTAMOS_ACTIVOS o PRESTAMOS_HISTORIAL, sin repetir y ordenados. */
function listarUsuariosPrestamos_() {
  var vistos = {};
  listarSolicitudes_().forEach(function (s) { if (s.nombre) vistos[s.nombre] = true; });
  listarPrestamosActivos_().forEach(function (p) { if (p.nombre) vistos[p.nombre] = true; });
  listarHistorial_().forEach(function (h) { if (h.nombre) vistos[h.nombre] = true; });
  return Object.keys(vistos).sort(function (a, b) { return a.localeCompare(b, 'es'); });
}

/** Agrupa toda la hoja MOVIMIENTOS por ID de préstamo, en una sola lectura (evita releer la hoja por cada préstamo). */
function agruparMovimientosPorPrestamo_() {
  var data = getOCrearHojaMovimientos_().getDataRange().getValues();
  var mapa = {};
  for (var m = 1; m < data.length; m++) {
    var fila = data[m];
    if (fila[0] === '' || fila[0] === null) continue;
    var id = Number(fila[3]);
    if (!mapa[id]) mapa[id] = [];
    mapa[id].push({ fecha: formatearFechaCelda_(fila[1]), tipo: fila[2], cantidad: Number(fila[5]), comentarios: fila[6] });
  }
  return mapa;
}

/** Suma n meses a una fecha 'yyyy-MM-dd', ajustando el día si el mes destino es más corto. */
function sumarMeses_(fechaStr, n) {
  var partes = fechaStr.split('-');
  var anio = parseInt(partes[0], 10), mes = parseInt(partes[1], 10) - 1, dia = parseInt(partes[2], 10);

  var totalMeses = mes + n;
  var anioFinal = anio + Math.floor(totalMeses / 12);
  var mesFinal = ((totalMeses % 12) + 12) % 12;
  var ultimoDiaMes = new Date(anioFinal, mesFinal + 1, 0).getDate();

  return anioFinal + '-' + pad2_(mesFinal + 1) + '-' + pad2_(Math.min(dia, ultimoDiaMes));
}

/**
 * Calcula la fecha de la próxima cuota (avanza un mes por cada cuota ya cubierta con pagos) y si el
 * préstamo está en mora (esa fecha ya pasó y todavía queda saldo por pagar).
 */
function calcularProximaCuota_(prestamo) {
  var mesesCubiertos = prestamo.cuotas - prestamo.cuotasFaltan;
  var fechaProximoPago = sumarMeses_(prestamo.fechaPago, mesesCubiertos);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  var enMora = prestamo.estado === 'ACTIVO' && hoy > fechaProximoPago;
  return { fechaProximoPago: fechaProximoPago, enMora: enMora };
}

/**
 * Consulta pública de préstamos (sin autenticación, a propósito: pensada para que cualquier socio
 * revise el estado de sus préstamos por nombre). Filtra opcionalmente por nombre exacto y/o estado
 * ('SOLICITUD','ACTIVO','MORA','POR_CERRAR','COMPLETO'); sin filtro de estado trae todo.
 */
function consultarPrestamos_(usuarioFiltro, estadoFiltro) {
  usuarioFiltro = usuarioFiltro ? String(usuarioFiltro).trim() : '';
  estadoFiltro = estadoFiltro ? String(estadoFiltro).trim().toUpperCase() : '';
  var incluir = function (cat) { return !estadoFiltro || estadoFiltro === cat; };
  var resultados = [];

  if (incluir('SOLICITUD')) {
    listarSolicitudes_().forEach(function (s) {
      if (usuarioFiltro && s.nombre !== usuarioFiltro) return;
      resultados.push({
        estado: 'SOLICITUD', nombre: s.nombre, monto: s.monto, cuotas: s.cuotas,
        servicio: s.servicio, fecha: s.fecha
      });
    });
  }

  var necesitaMovimientos = incluir('ACTIVO') || incluir('MORA') || incluir('POR_CERRAR') || incluir('COMPLETO');
  var movimientosPorPrestamo = necesitaMovimientos ? agruparMovimientosPorPrestamo_() : {};

  if (incluir('ACTIVO') || incluir('MORA') || incluir('POR_CERRAR')) {
    listarPrestamosActivos_().forEach(function (p) {
      if (usuarioFiltro && p.nombre !== usuarioFiltro) return;

      var estadoReal = p.estado;
      var calc = { fechaProximoPago: null, enMora: false };
      if (p.estado === 'ACTIVO') {
        calc = calcularProximaCuota_(p);
        estadoReal = calc.enMora ? 'MORA' : 'ACTIVO';
      }
      if (!incluir(estadoReal)) return;

      resultados.push({
        estado: estadoReal, nombre: p.nombre, idPrestamo: p.idPrestamo, monto: p.monto, cuotas: p.cuotas,
        cuotasFaltan: p.cuotasFaltan, pagado: p.pagado, debe: p.debe, siguienteCuota: p.siguienteCuota,
        fechaProximoPago: calc.fechaProximoPago, movimientos: movimientosPorPrestamo[p.idPrestamo] || []
      });
    });
  }

  if (incluir('COMPLETO')) {
    listarHistorial_().forEach(function (h) {
      if (usuarioFiltro && h.nombre !== usuarioFiltro) return;
      resultados.push({
        estado: 'COMPLETO', nombre: h.nombre, idPrestamo: h.idPrestamo, monto: h.monto, cuotas: h.cuotas,
        pagado: h.pagado, fechaCierre: h.fechaCierre, movimientos: movimientosPorPrestamo[h.idPrestamo] || []
      });
    });
  }

  return resultados;
}

/** Ubica la fila (1-indexada) de un préstamo por su ID en PRESTAMOS_ACTIVOS. */
function getFilaPrestamoPorId_(idPrestamo) {
  var data = getOCrearHojaPrestamos_().getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (Number(data[r][2]) === idPrestamo) return r + 1;
  }
  throw new Error('No existe un préstamo activo con ese ID.');
}

/**
 * Recalcula Pagado/Debe/Cuotas faltan/Siguiente cuota/Estado de un préstamo a partir de sus movimientos positivos.
 * Si ya se conoce la fila (porque quien llama la acaba de ubicar), pásala en filaConocida para no releer toda la hoja.
 */
function recalcularPrestamo_(idPrestamo, filaConocida) {
  var hojaPrestamos = getOCrearHojaPrestamos_();
  var fila = filaConocida || getFilaPrestamoPorId_(idPrestamo);
  var datos = hojaPrestamos.getRange(fila, 1, 1, PRESTAMOS_HEADERS.length).getValues()[0];

  var monto = numeroDeCelda_(datos[4]), cuotas = numeroDeCelda_(datos[5]);
  var valorCuota = numeroDeCelda_(datos[6]), tasa = numeroDeCelda_(datos[7]);
  var montoTotalAPagar = redondear_(generarTabla_(monto, tasa, cuotas, valorCuota).reduce(function (acc, r) { return acc + r.cuota; }, 0));

  var movimientos = getOCrearHojaMovimientos_().getDataRange().getValues();
  var pagado = 0;
  for (var m = 1; m < movimientos.length; m++) {
    if (Number(movimientos[m][3]) === idPrestamo && Number(movimientos[m][5]) > 0) {
      pagado += Number(movimientos[m][5]);
    }
  }
  pagado = redondear_(pagado);

  var debe = Math.max(0, redondear_(montoTotalAPagar - pagado));
  var cuotasFaltan = valorCuota > 0 ? Math.min(cuotas, Math.ceil(debe / valorCuota)) : 0;
  var siguienteCuota = debe <= 0 ? 0 : redondear_(Math.min(valorCuota, debe));
  var estado = debe <= UMBRAL_CIERRE ? 'POR_CERRAR' : 'ACTIVO';

  hojaPrestamos.getRange(fila, 12, 1, 5).setValues([[pagado, debe, cuotasFaltan, siguienteCuota, estado]]);

  return { pagado: pagado, debe: debe, cuotasFaltan: cuotasFaltan, siguienteCuota: siguienteCuota, estado: estado };
}

/** Cierra un préstamo: lo mueve completo (con fecha de cierre) a PRESTAMOS_HISTORIAL y lo borra de PRESTAMOS_ACTIVOS. */
function cerrarPrestamo_(body) {
  validarAdmin_(body.usuario, body.contrasena);

  var idPrestamo = parseInt(body.idPrestamo, 10);
  var hojaPrestamos = getOCrearHojaPrestamos_();
  var fila = getFilaPrestamoPorId_(idPrestamo);
  var datos = hojaPrestamos.getRange(fila, 1, 1, PRESTAMOS_HEADERS.length).getValues()[0];

  if (Number(datos[12]) > UMBRAL_CIERRE) throw new Error('Este préstamo todavía tiene saldo pendiente.');

  datos[15] = 'COMPLETO'; // en PRESTAMOS_ACTIVOS decía POR_CERRAR; en el historial ya es un préstamo completo.
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  getOCrearHojaHistorial_().appendRow(datos.concat([hoy]));
  hojaPrestamos.deleteRow(fila);

  return { idPrestamo: idPrestamo, fechaCierre: hoy };
}

/** Valida y registra un movimiento (pago, préstamo, etc.) contra un préstamo activo. */
function registrarMovimiento_(body) {
  validarAdmin_(body.usuario, body.contrasena);

  var tipo = String(body.tipo || '').trim();
  var idPrestamo = parseInt(body.idPrestamo, 10);
  var cantidad = parseFloat(body.cantidad);
  var comentarios = String(body.comentarios || '').trim();

  if (!tipo) throw new Error('El tipo de movimiento es obligatorio.');
  if (!(idPrestamo >= 0)) throw new Error('Debes indicar el ID del préstamo.');
  if (isNaN(cantidad) || cantidad === 0) throw new Error('La cantidad es obligatoria y debe ser distinta de 0.');
  if (!comentarios) throw new Error('Los comentarios son obligatorios.');

  var tipos = getTiposMovimiento_();
  var tipoInfo = null;
  for (var t = 0; t < tipos.length; t++) {
    if (tipos[t].tipo === tipo) { tipoInfo = tipos[t]; break; }
  }
  if (!tipoInfo) throw new Error('El tipo de movimiento seleccionado no es válido.');

  if (tipoInfo.signo === '-' && cantidad > 0) throw new Error('Para "' + tipo + '" la cantidad debe ser negativa.');
  if (tipoInfo.signo === '+' && cantidad < 0) throw new Error('Para "' + tipo + '" la cantidad debe ser positiva.');

  var hojaPrestamos = getOCrearHojaPrestamos_();
  var fila = getFilaPrestamoPorId_(idPrestamo); // única lectura completa de PRESTAMOS_ACTIVOS para esta operación
  var nombrePrestamo = hojaPrestamos.getRange(fila, 4, 1, 1).getValue();

  var resultado = insertarMovimiento_(tipo, idPrestamo, nombrePrestamo, cantidad, comentarios);
  var estadoPrestamo = recalcularPrestamo_(idPrestamo, fila);

  return { id: resultado.id, fecha: resultado.fecha, nombre: nombrePrestamo, prestamo: estadoPrestamo };
}

/** Agrega una fila a MOVIMIENTOS con ID consecutivo (desde 0) y fecha automáticos. */
function insertarMovimiento_(tipo, idPrestamo, nombre, cantidad, comentarios) {
  var sheet = getOCrearHojaMovimientos_();
  var nuevoId = sheet.getLastRow() - 1; // encabezado en fila 1; los ids empiezan en 0
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');

  sheet.appendRow([nuevoId, hoy, tipo, idPrestamo, nombre, cantidad, comentarios]);

  return { id: nuevoId, fecha: hoy };
}

/** Obtiene la hoja SOLICITUD, creándola con encabezados si todavía no existe. */
function getOCrearHojaSolicitudes_() {
  var libro = getLibro_();
  var sheet = libro.getSheetByName(HOJA_SOLICITUDES);
  if (!sheet) {
    sheet = libro.insertSheet(HOJA_SOLICITUDES);
    sheet.appendRow(SOLICITUD_HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() <= 1) {
    sheet.getRange(1, 1, 1, SOLICITUD_HEADERS.length).setValues([SOLICITUD_HEADERS]);
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
    'Correo: ' + datos.correo + '\n' +
    'Fecha: ' + datos.fecha + '\n' +
    'Servicio: ' + datos.servicio + '\n' +
    'Monto: ' + datos.monto + '\n' +
    'Cuotas: ' + datos.cuotas + '\n' +
    (datos.linkPago ? 'Link de pago: ' + datos.linkPago + '\n' : '') +
    (datos.banco ? 'Banco: ' + datos.banco + '\nCuenta o llave: ' + datos.cuentaLlave + '\n' : '') +
    '\nEstado: PENDIENTE';

  MailApp.sendEmail(CORREO_NOTIFICACION, asunto, cuerpo);
}

/** Lista de servicios válidos (columna NOMBRE_SERVICIO) configurada en CONFIGURACION (ver leerConfiguracion_). */
function getServiciosDisponibles_() {
  return leerConfiguracion_().servicios;
}

/** Tasa mensual (TASA_MENSUAL) configurada en CONFIGURACION (ver leerConfiguracion_). */
function getTasaMensual_() {
  return leerConfiguracion_().tasaMensual;
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

