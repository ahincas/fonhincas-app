(function () {
  var sesion = { usuario: null, contrasena: null };
  var solicitudes = [];
  var fotoDataUrl = null;
  var firmaDibujada = false;
  var dibujando = false;

  var vistaLogin = document.getElementById('vistaLogin');
  var vistaLista = document.getElementById('vistaLista');
  var vistaDetalle = document.getElementById('vistaDetalle');

  var moneyFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  var moneyFmt2 = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });

  function mostrarVista(vista) {
    [vistaLogin, vistaLista, vistaDetalle].forEach(function (v) { v.hidden = (v !== vista); });
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
        cargarLista();
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

  document.getElementById('btnSalir').addEventListener('click', function () {
    sesion.usuario = null;
    sesion.contrasena = null;
    mostrarVista(vistaLogin);
  });

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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
