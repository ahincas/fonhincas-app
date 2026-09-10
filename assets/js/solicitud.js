(function () {
  var MAX_CUOTAS = 36;

  var form = document.getElementById('solicitudForm');
  var servicioSelect = document.getElementById('servicio');
  var fechaInput = document.getElementById('fecha');
  var cuotasInput = document.getElementById('cuotas');
  var errorBox = document.getElementById('solicitudError');
  var nota = document.getElementById('solicitudNota');
  var submitBtn = document.getElementById('solicitudSubmit');

  // Fecha mínima: hoy (hora Bogotá), no se permite el pasado.
  fechaInput.min = hoyBogota();

  function hoyBogota() {
    var partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).formatToParts(new Date());
    var m = {};
    partes.forEach(function (p) { m[p.type] = p.value; });
    return m.year + '-' + m.month + '-' + m.day;
  }

  // Precarga monto/cuotas si venimos del simulador.
  var qs = new URLSearchParams(window.location.search);
  if (qs.get('monto')) document.getElementById('montoSolicitud').value = qs.get('monto');
  if (qs.get('plazo')) cuotasInput.value = Math.min(parseInt(qs.get('plazo'), 10) || 0, MAX_CUOTAS);

  // Carga la lista de servicios válidos desde CONFIGURACION (cacheada 5 min por pestaña).
  FonhincasAPI.cached('servicios', 5 * 60 * 1000, function () {
    return FonhincasAPI.fetchJson({ accion: 'servicios' });
  })
    .then(function (json) {
      if (!json.ok) throw new Error(json.error || 'No fue posible cargar los servicios.');
      servicioSelect.innerHTML = '<option value="" disabled selected>Selecciona un servicio</option>' +
        json.data.servicios.map(function (s) {
          return '<option value="' + s.replace(/"/g, '&quot;') + '">' + s + '</option>';
        }).join('');
    })
    .catch(function (err) {
      servicioSelect.innerHTML = '<option value="" disabled selected>No se pudieron cargar los servicios</option>';
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    });

  setupSwitch('switchLink', 'camposLink', ['linkPago']);
  setupSwitch('switchConsignacion', 'camposConsignacion', ['banco', 'cuentaLlave']);

  function setupSwitch(switchId, panelId, fieldIds) {
    var toggle = document.getElementById(switchId);
    var panel = document.getElementById(panelId);
    toggle.addEventListener('change', function () {
      panel.hidden = !toggle.checked;
      fieldIds.forEach(function (id) {
        document.getElementById(id).required = toggle.checked;
        if (!toggle.checked) document.getElementById(id).value = '';
      });
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    nota.hidden = true;

    if (form.fecha.value < fechaInput.min) {
      errorBox.textContent = 'La fecha no puede ser anterior a hoy.';
      errorBox.hidden = false;
      return;
    }

    if (parseInt(form.cuotas.value, 10) > MAX_CUOTAS) {
      errorBox.textContent = 'El número de cuotas no puede superar ' + MAX_CUOTAS + '.';
      errorBox.hidden = false;
      return;
    }

    var payload = {
      accion: 'guardarSolicitud',
      nombre: form.nombre.value,
      correo: form.correo.value,
      fecha: form.fecha.value,
      servicio: form.servicio.value,
      monto: form.monto.value,
      cuotas: form.cuotas.value,
      linkPago: document.getElementById('switchLink').checked ? form.linkPago.value : null,
      consignacion: document.getElementById('switchConsignacion').checked
        ? { banco: form.banco.value, cuentaLlave: form.cuentaLlave.value }
        : null
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando…';

    FonhincasAPI.postJson(payload)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'No fue posible enviar la solicitud.');
        nota.textContent = 'Solicitud enviada. Estado: ' + json.data.estado + '. Te contactaremos pronto.';
        nota.hidden = false;
        form.reset();
        document.getElementById('camposLink').hidden = true;
        document.getElementById('camposConsignacion').hidden = true;
      })
      .catch(function (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enviar solicitud';
      });
  });
})();
