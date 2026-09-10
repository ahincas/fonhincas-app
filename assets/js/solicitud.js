(function () {
  var form = document.getElementById('solicitudForm');
  var servicioSelect = document.getElementById('servicio');
  var errorBox = document.getElementById('solicitudError');
  var nota = document.getElementById('solicitudNota');

  // Precarga monto/cuotas si venimos del simulador.
  var qs = new URLSearchParams(window.location.search);
  if (qs.get('monto')) document.getElementById('montoSolicitud').value = qs.get('monto');
  if (qs.get('plazo')) document.getElementById('cuotas').value = qs.get('plazo');

  // Carga la lista de servicios válidos desde CONFIGURACION.
  FonhincasAPI.fetchJson({ accion: 'servicios' })
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

    var payload = {
      nombre: form.nombre.value,
      fecha: form.fecha.value,
      servicio: form.servicio.value,
      monto: form.monto.value,
      cuotas: form.cuotas.value,
      linkPago: document.getElementById('switchLink').checked ? form.linkPago.value : null,
      consignacion: document.getElementById('switchConsignacion').checked
        ? { banco: form.banco.value, cuentaLlave: form.cuentaLlave.value }
        : null
    };

    // El guardado en la hoja y la notificación de llenado se conectan en la siguiente fase.
    console.log('Solicitud (aún no se guarda):', payload);
    nota.textContent = 'Formulario validado correctamente. El guardado y la notificación se activarán próximamente.';
    nota.hidden = false;
  });
})();
