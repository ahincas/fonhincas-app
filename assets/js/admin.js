(function () {
  var sesion = { usuario: null, contrasena: null };
  var solicitudes = [];
  var fotoDataUrl = null;
  var firmaDibujada = false;
  var dibujando = false;

  var vistaLogin = document.getElementById('vistaLogin');
  var vistaMenu = document.getElementById('vistaMenu');
  var vistaPago = document.getElementById('vistaPago');
  var vistaLista = document.getElementById('vistaLista');
  var vistaCierre = document.getElementById('vistaCierre');
  var vistaDetalle = document.getElementById('vistaDetalle');

  var moneyFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  var moneyFmt2 = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });

  function mostrarVista(vista) {
    [vistaLogin, vistaMenu, vistaPago, vistaLista, vistaCierre, vistaDetalle].forEach(function (v) { v.hidden = (v !== vista); });
  }

  function salir() {
    sesion.usuario = null;
    sesion.contrasena = null;
    mostrarVista(vistaLogin);
  }

  // ---------- Login ----------

  var loginForm = document.getElementById('loginForm');
  var loginError = document.getElementById('loginError');
  var loginSubmit = document.getElementById('loginSubmit');

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    loginError.hidden = true;
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Ingresando…';

    var usuario = loginForm.usuario.value;
    var contrasena = loginForm.contrasena.value;

    FonhincasAPI.postJson({ accion: 'login', usuario: usuario, contrasena: contrasena })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'No fue posible iniciar sesión.');
        sesion.usuario = json.data.usuario;
        sesion.contrasena = contrasena;
        loginForm.reset();
        mostrarVista(vistaMenu);
        actualizarBadgeCierre();
      })
      .catch(function (err) {
        loginError.textContent = err.message;
        loginError.hidden = false;
      })
      .finally(function () {
        loginSubmit.disabled = false;
        loginSubmit.textContent = 'Ingresar';
      });
  });

  document.getElementById('btnSalirMenu').addEventListener('click', salir);

  // ---------- Menú ----------

  document.getElementById('btnIrPago').addEventListener('click', abrirPago);
  document.getElementById('btnIrSolicitudes').addEventListener('click', cargarLista);
  document.getElementById('btnIrCierre').addEventListener('click', cargarCierre);
  document.getElementById('btnVolverMenuPago').addEventListener('click', volverAlMenu);
  document.getElementById('btnVolverMenuLista').addEventListener('click', volverAlMenu);
  document.getElementById('btnVolverMenuCierre').addEventListener('click', volverAlMenu);

  function volverAlMenu() {
    mostrarVista(vistaMenu);
    actualizarBadgeCierre();
  }

  function actualizarBadgeCierre() {
    var badge = document.getElementById('badgeCierre');
    FonhincasAPI.postJson({ accion: 'listarPrestamosPorCerrar', usuario: sesion.usuario, contrasena: sesion.contrasena })
      .then(function (json) {
        var n = json.ok ? json.data.prestamos.length : 0;
        badge.textContent = n;
        badge.hidden = n === 0;
      })
      .catch(function () { badge.hidden = true; });
  }

  // ---------- Lista ----------

  var listaEl = document.getElementById('listaSolicitudes');

  function cargarLista() {
    listaEl.innerHTML = '<p class="list-empty">Cargando…</p>';
    mostrarVista(vistaLista);

    FonhincasAPI.postJson({ accion: 'listarSolicitudes', usuario: sesion.usuario, contrasena: sesion.contrasena })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'No fue posible cargar las solicitudes.');
        solicitudes = json.data.solicitudes;
        renderLista();
      })
      .catch(function (err) {
        listaEl.innerHTML = '<p class="list-empty">' + err.message + '</p>';
      });
  }

  function renderLista() {
    if (!solicitudes.length) {
      listaEl.innerHTML = '<p class="list-empty">No hay solicitudes pendientes.</p>';
      return;
    }

    listaEl.innerHTML = solicitudes.map(function (s) {
      return '<div class="card list-item" style="margin-bottom: var(--space-2);" data-fila="' + s.fila + '">' +
        '<div class="list-item__head"><h3>' + escapeHtml(s.nombre) + '</h3><span class="list-item__monto">' + moneyFmt.format(s.monto) + '</span></div>' +
        '<p>' + escapeHtml(s.servicio) + ' · ' + s.cuotas + ' cuotas · Fecha: ' + s.fecha + '</p>' +
        '</div>';
    }).join('');

    listaEl.querySelectorAll('.list-item').forEach(function (el) {
      el.addEventListener('click', function () { abrirDetalle(parseInt(el.dataset.fila, 10)); });
    });
  }

  // ---------- Detalle ----------

  var detalleForm = document.getElementById('detalleForm');
  var detalleError = document.getElementById('detalleError');
  var detalleNota = document.getElementById('detalleNota');
  var detalleSubmit = document.getElementById('detalleSubmit');
  var filaActual = null;

  function abrirDetalle(fila) {
    detalleError.hidden = true;
    detalleNota.hidden = true;
    mostrarVista(vistaDetalle);
    document.getElementById('dTablaWrap').innerHTML = '<p class="list-empty">Cargando…</p>';

    FonhincasAPI.postJson({ accion: 'detalleSolicitud', usuario: sesion.usuario, contrasena: sesion.contrasena, fila: fila })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'No fue posible cargar la solicitud.');
        filaActual = fila;
        renderDetalle(json.data);
        prepararFirma();
        resetearAnexo2();
      })
      .catch(function (err) {
        mostrarVista(vistaLista);
        listaEl.innerHTML = '<p class="list-empty">' + err.message + '</p>';
      });
  }

  function renderDetalle(d) {
    document.getElementById('dFechaRevision').textContent = d.fechaRevision;
    document.getElementById('dAdministrador').textContent = sesion.usuario;
    document.getElementById('dNombre').textContent = d.nombre;
    document.getElementById('dServicio').textContent = d.servicio;
    document.getElementById('dMonto').textContent = moneyFmt.format(d.monto);
    document.getElementById('dCuotas').textContent = d.cuotas;
    document.getElementById('dCuota').textContent = moneyFmt2.format(d.cuota);
    document.getElementById('dTasa').textContent = (d.tasa * 100).toFixed(2) + '%';
    document.getElementById('dFechaPago').textContent = d.fechaPago;
    detalleForm.observaciones.value = '';

    var rows = d.tabla.map(function (r) {
      return '<tr>' +
        '<td>' + r.mes + '</td>' +
        '<td>' + moneyFmt.format(r.saldoInicial) + '</td>' +
        '<td>' + moneyFmt2.format(r.cuota) + '</td>' +
        '<td>' + moneyFmt2.format(r.interes) + '</td>' +
        '<td>' + moneyFmt2.format(r.abonoCapital) + '</td>' +
        '<td>' + moneyFmt.format(r.saldoFinal) + '</td>' +
        '</tr>';
    }).join('');

    document.getElementById('dTablaWrap').innerHTML =
      '<div class="table-wrap__scroll"><table class="amort">' +
      '<thead><tr><th>Mes</th><th>Saldo inicial</th><th>Cuota</th><th>Interés</th><th>Abono capital</th><th>Saldo final</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  document.getElementById('btnVolver').addEventListener('click', cargarLista);

  // ---------- Firma ----------

  var canvas = document.getElementById('firmaPad');
  var ctx = canvas.getContext('2d');

  function prepararFirma() {
    var ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#071014';
    firmaDibujada = false;
  }

  function coordsDe(evento) {
    var r = canvas.getBoundingClientRect();
    return { x: evento.clientX - r.left, y: evento.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', function (e) {
    dibujando = true;
    firmaDibujada = true;
    var p = coordsDe(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!dibujando) return;
    var p = coordsDe(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });

  ['pointerup', 'pointerleave'].forEach(function (ev) {
    canvas.addEventListener(ev, function () { dibujando = false; });
  });

  document.getElementById('btnLimpiarFirma').addEventListener('click', function () {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    firmaDibujada = false;
  });

  // ---------- Anexo 2: foto del desembolso ----------

  var uploadZone = document.getElementById('uploadZone');
  var uploadInput = document.getElementById('uploadInput');
  var uploadPreview = document.getElementById('uploadPreview');
  var uploadZoneTexto = document.getElementById('uploadZoneTexto');

  function resetearAnexo2() {
    fotoDataUrl = null;
    uploadPreview.hidden = true;
    uploadPreview.src = '';
    uploadZoneTexto.hidden = false;
    uploadInput.value = '';
  }

  uploadZone.addEventListener('click', function () { uploadInput.click(); });

  uploadInput.addEventListener('change', function () {
    if (uploadInput.files && uploadInput.files[0]) leerImagen(uploadInput.files[0]);
  });

  uploadZone.addEventListener('paste', function (e) { manejarPegado(e); });
  document.addEventListener('paste', function (e) {
    if (!vistaDetalle.hidden) manejarPegado(e);
  });

  function manejarPegado(e) {
    var items = (e.clipboardData || window.clipboardData).items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        leerImagen(items[i].getAsFile());
        e.preventDefault();
        break;
      }
    }
  }

  function leerImagen(file) {
    var reader = new FileReader();
    reader.onload = function () {
      fotoDataUrl = reader.result;
      uploadPreview.src = fotoDataUrl;
      uploadPreview.hidden = false;
      uploadZoneTexto.hidden = true;
    };
    reader.readAsDataURL(file);
  }

  // ---------- Guardar préstamo ----------

  detalleForm.addEventListener('submit', function (e) {
    e.preventDefault();
    detalleError.hidden = true;
    detalleNota.hidden = true;

    if (!firmaDibujada) {
      detalleError.textContent = 'La firma es obligatoria.';
      detalleError.hidden = false;
      return;
    }

    detalleSubmit.disabled = true;
    detalleSubmit.textContent = 'Guardando…';

    FonhincasAPI.postJson({
      accion: 'guardarPrestamo',
      usuario: sesion.usuario,
      contrasena: sesion.contrasena,
      fila: filaActual,
      observaciones: detalleForm.observaciones.value,
      firma: canvas.toDataURL('image/png'),
      fotoDesembolso: fotoDataUrl
    })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'No fue posible guardar el préstamo.');
        detalleNota.textContent = 'Préstamo N.º ' + json.data.idPrestamo + ' guardado correctamente.';
        detalleNota.hidden = false;
        setTimeout(cargarLista, 1200);
      })
      .catch(function (err) {
        detalleError.textContent = err.message;
        detalleError.hidden = false;
      })
      .finally(function () {
        detalleSubmit.disabled = false;
        detalleSubmit.textContent = 'Guardar préstamo';
      });
  });

  // ---------- Registrar pago ----------

  var pagoForm = document.getElementById('pagoForm');
  var pagoTipoSelect = document.getElementById('pagoTipo');
  var pagoPrestamoSelect = document.getElementById('pagoPrestamo');
  var pagoCantidadInput = document.getElementById('pagoCantidad');
  var pagoCantidadLabel = document.getElementById('pagoCantidadLabel');
  var pagoError = document.getElementById('pagoError');
  var pagoNota = document.getElementById('pagoNota');
  var pagoSubmit = document.getElementById('pagoSubmit');
  var tiposMovimiento = [];

  function abrirPago() {
    pagoError.hidden = true;
    pagoNota.hidden = true;
    pagoForm.reset();
    pagoTipoSelect.innerHTML = '<option value="" disabled selected>Cargando tipos…</option>';
    pagoPrestamoSelect.innerHTML = '<option value="" disabled selected>Cargando préstamos…</option>';
    pagoCantidadLabel.textContent = 'Cantidad';
    mostrarVista(vistaPago);

    Promise.all([
      FonhincasAPI.postJson({ accion: 'tiposMovimiento', usuario: sesion.usuario, contrasena: sesion.contrasena }),
      FonhincasAPI.postJson({ accion: 'listarPrestamosActivos', usuario: sesion.usuario, contrasena: sesion.contrasena })
    ]).then(function (respuestas) {
      var rTipos = respuestas[0], rPrestamos = respuestas[1];
      if (!rTipos.ok) throw new Error(rTipos.error || 'No fue posible cargar los tipos de movimiento.');
      if (!rPrestamos.ok) throw new Error(rPrestamos.error || 'No fue posible cargar los préstamos activos.');

      tiposMovimiento = rTipos.data.tipos;
      pagoTipoSelect.innerHTML = '<option value="" disabled selected>Selecciona un tipo</option>' +
        tiposMovimiento.map(function (t) {
          return '<option value="' + escapeHtml(t.tipo) + '">' + escapeHtml(t.tipo) + ' (' + (t.signo === '-' ? 'resta' : 'suma') + ')</option>';
        }).join('');

      var prestamos = rPrestamos.data.prestamos;
      pagoPrestamoSelect.innerHTML = prestamos.length
        ? '<option value="" disabled selected>Selecciona un préstamo</option>' +
          prestamos.map(function (p) {
            return '<option value="' + p.idPrestamo + '">N.º ' + p.idPrestamo + ' — ' + escapeHtml(p.nombre) + ' (debe ' + moneyFmt.format(p.debe) + ')</option>';
          }).join('')
        : '<option value="" disabled selected>No hay préstamos activos</option>';
    }).catch(function (err) {
      pagoError.textContent = err.message;
      pagoError.hidden = false;
    });
  }

  pagoTipoSelect.addEventListener('change', function () {
    var info = tiposMovimiento.filter(function (t) { return t.tipo === pagoTipoSelect.value; })[0];
    pagoCantidadLabel.textContent = info ? 'Cantidad (debe ser ' + (info.signo === '-' ? 'negativa' : 'positiva') + ')' : 'Cantidad';
  });

  pagoForm.addEventListener('submit', function (e) {
    e.preventDefault();
    pagoError.hidden = true;
    pagoNota.hidden = true;

    var info = tiposMovimiento.filter(function (t) { return t.tipo === pagoTipoSelect.value; })[0];
    var cantidad = parseFloat(pagoCantidadInput.value);

    if (!pagoTipoSelect.value || !pagoPrestamoSelect.value || !pagoCantidadInput.value || !pagoForm.comentarios.value.trim()) {
      pagoError.textContent = 'Todos los campos son obligatorios.';
      pagoError.hidden = false;
      return;
    }
    if (isNaN(cantidad) || cantidad === 0) {
      pagoError.textContent = 'La cantidad debe ser un número distinto de 0.';
      pagoError.hidden = false;
      return;
    }
    if (info && info.signo === '-' && cantidad > 0) {
      pagoError.textContent = 'Para "' + info.tipo + '" la cantidad debe ser negativa.';
      pagoError.hidden = false;
      return;
    }
    if (info && info.signo === '+' && cantidad < 0) {
      pagoError.textContent = 'Para "' + info.tipo + '" la cantidad debe ser positiva.';
      pagoError.hidden = false;
      return;
    }

    pagoSubmit.disabled = true;
    pagoSubmit.textContent = 'Guardando…';

    FonhincasAPI.postJson({
      accion: 'registrarMovimiento',
      usuario: sesion.usuario,
      contrasena: sesion.contrasena,
      tipo: pagoTipoSelect.value,
      idPrestamo: pagoPrestamoSelect.value,
      cantidad: cantidad,
      comentarios: pagoForm.comentarios.value.trim()
    })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'No fue posible registrar el movimiento.');
        var p = json.data.prestamo;
        pagoNota.textContent = 'Movimiento N.º ' + json.data.id + ' registrado para ' + json.data.nombre + '. Debe ahora: ' +
          moneyFmt.format(p.debe) + (p.estado === 'POR_CERRAR' ? ' — ¡préstamo listo para cerrar!' : '.');
        pagoNota.hidden = false;
        pagoForm.reset();
        pagoCantidadLabel.textContent = 'Cantidad';
      })
      .catch(function (err) {
        pagoError.textContent = err.message;
        pagoError.hidden = false;
      })
      .finally(function () {
        pagoSubmit.disabled = false;
        pagoSubmit.textContent = 'Registrar movimiento';
      });
  });

  // ---------- Préstamos por cerrar ----------

  var listaCierreEl = document.getElementById('listaCierre');

  function cargarCierre() {
    listaCierreEl.innerHTML = '<p class="list-empty">Cargando…</p>';
    mostrarVista(vistaCierre);

    FonhincasAPI.postJson({ accion: 'listarPrestamosPorCerrar', usuario: sesion.usuario, contrasena: sesion.contrasena })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'No fue posible cargar los préstamos por cerrar.');
        renderCierre(json.data.prestamos);
      })
      .catch(function (err) {
        listaCierreEl.innerHTML = '<p class="list-empty">' + err.message + '</p>';
      });
  }

  function renderCierre(prestamos) {
    if (!prestamos.length) {
      listaCierreEl.innerHTML = '<p class="list-empty">No hay préstamos listos para cerrar.</p>';
      return;
    }

    listaCierreEl.innerHTML = prestamos.map(function (p) {
      return '<div class="card" style="margin-bottom: var(--space-2);">' +
        '<div class="list-item__head"><h3>N.º ' + p.idPrestamo + ' — ' + escapeHtml(p.nombre) + '</h3><span class="list-item__monto">' + moneyFmt.format(p.pagado) + ' pagado</span></div>' +
        '<p>Monto original: ' + moneyFmt.format(p.monto) + ' · Saldo pendiente: ' + moneyFmt.format(p.debe) + '</p>' +
        '<button class="btn btn--primary" type="button" data-id="' + p.idPrestamo + '" style="margin-top: var(--space-2);">Confirmar cierre</button>' +
        '</div>';
    }).join('');

    listaCierreEl.querySelectorAll('button[data-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { confirmarCierre(parseInt(btn.dataset.id, 10), btn); });
    });
  }

  function confirmarCierre(idPrestamo, btn) {
    btn.disabled = true;
    btn.textContent = 'Cerrando…';

    FonhincasAPI.postJson({ accion: 'cerrarPrestamo', usuario: sesion.usuario, contrasena: sesion.contrasena, idPrestamo: idPrestamo })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'No fue posible cerrar el préstamo.');
        cargarCierre();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Confirmar cierre';
        listaCierreEl.insertAdjacentHTML('afterbegin', '<p class="simulator__error">' + escapeHtml(err.message) + '</p>');
      });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
