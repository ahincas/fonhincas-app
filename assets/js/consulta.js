(function () {
  var form = document.getElementById('consultaForm');
  var usuarioSelect = document.getElementById('consultaUsuario');
  var estadoSelect = document.getElementById('consultaEstado');
  var errorBox = document.getElementById('consultaError');
  var resultadosEl = document.getElementById('consultaResultados');
  var submitBtn = form.querySelector('button[type="submit"]');

  var moneyFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  var moneyFmt2 = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });

  var ESTADO_LABEL = {
    SOLICITUD: 'Solicitud',
    ACTIVO: 'Activo',
    MORA: 'Mora',
    POR_CERRAR: 'Pendiente de finalización',
    COMPLETO: 'Completo'
  };

  // Lista de usuarios (cacheada 5 min por pestaña: casi no cambia dentro de una sesión de consulta).
  FonhincasAPI.cached('usuariosPrestamos', 5 * 60 * 1000, function () {
    return FonhincasAPI.fetchJson({ accion: 'usuariosPrestamos' });
  }).then(function (json) {
    if (!json.ok) throw new Error(json.error || 'No fue posible cargar la lista de usuarios.');
    json.data.usuarios.forEach(function (u) {
      var opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      usuarioSelect.appendChild(opt);
    });
  }).catch(function (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    resultadosEl.innerHTML = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Consultando…';

    FonhincasAPI.fetchJson({ accion: 'consultarPrestamos', usuario: usuarioSelect.value, estado: estadoSelect.value })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'No fue posible realizar la consulta.');
        renderResultados(json.data.prestamos);
      })
      .catch(function (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Consultar';
      });
  });

  function renderResultados(prestamos) {
    if (!prestamos.length) {
      resultadosEl.innerHTML = '<p class="list-empty">No se encontraron préstamos con esos filtros.</p>';
      return;
    }
    resultadosEl.innerHTML = prestamos.map(renderCard).join('');
  }

  function renderCard(p) {
    var pill = '<span class="estado-pill">' + ESTADO_LABEL[p.estado] + '</span>';
    var head = '<div class="resultado-head"><h3>' + escapeHtml(p.nombre) + '</h3>' + pill + '</div>';
    var cuerpo = '';

    if (p.estado === 'SOLICITUD') {
      cuerpo =
        '<p>Servicio: ' + escapeHtml(p.servicio) + ' · Fecha de solicitud: ' + p.fecha + '</p>' +
        '<div class="detalle-grid" style="margin-top: var(--space-2);">' +
        kv('Monto solicitado', moneyFmt.format(p.monto)) +
        kv('Cuotas solicitadas', p.cuotas) +
        '</div>';
    } else if (p.estado === 'ACTIVO' || p.estado === 'MORA') {
      cuerpo =
        (p.estado === 'MORA' ? '<p class="mora-alerta">⚠ El pago de la cuota está vencido.</p>' : '') +
        '<div class="detalle-grid">' +
        kv('Monto', moneyFmt.format(p.monto)) +
        kv('Cuotas totales', p.cuotas) +
        kv('Cuotas faltan', p.cuotasFaltan) +
        kv('Pagado', moneyFmt.format(p.pagado)) +
        kv('Debe', moneyFmt.format(p.debe)) +
        '</div>' +
        '<div class="proxima-cuota-box">' +
        '<div class="valor">' + moneyFmt2.format(p.siguienteCuota) + '</div>' +
        '<div class="label">Próxima cuota — vence ' + p.fechaProximoPago + '</div>' +
        '</div>' +
        movimientosDetalle(p.movimientos, 'Historial de pagos');
    } else if (p.estado === 'POR_CERRAR') {
      cuerpo =
        '<p>Préstamo pagado en su totalidad, pendiente de que administración confirme el cierre.</p>' +
        '<div class="detalle-grid" style="margin-top: var(--space-2);">' +
        kv('Monto', moneyFmt.format(p.monto)) +
        kv('Pagado', moneyFmt.format(p.pagado)) +
        '</div>' +
        movimientosDetalle(p.movimientos, 'Historial de pagos');
    } else if (p.estado === 'COMPLETO') {
      cuerpo =
        '<div class="detalle-grid">' +
        kv('Monto', moneyFmt.format(p.monto)) +
        kv('Pagado', moneyFmt.format(p.pagado)) +
        kv('Fecha de cierre', p.fechaCierre) +
        '</div>' +
        movimientosDetalle(p.movimientos, 'Resumen de pagos');
    }

    return '<div class="resultado-card" data-estado="' + p.estado + '">' + head + cuerpo + '</div>';
  }

  function kv(k, v) {
    return '<div class="kv"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }

  function movimientosDetalle(movimientos, titulo) {
    if (!movimientos || !movimientos.length) return '';
    var filas = movimientos.map(function (m) {
      return '<tr><td>' + m.fecha + '</td><td>' + escapeHtml(m.tipo) + '</td><td>' + moneyFmt2.format(m.cantidad) + '</td><td>' + escapeHtml(m.comentarios || '') + '</td></tr>';
    }).join('');

    return '<details class="movimientos-tabla"><summary>' + titulo + ' (' + movimientos.length + ')</summary>' +
      '<div class="table-wrap" style="margin-top: var(--space-2);"><div class="table-wrap__scroll"><table class="amort">' +
      '<thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Comentarios</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div></div></details>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
