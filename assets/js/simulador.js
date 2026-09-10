(function () {
  var API_URL = 'https://script.google.com/macros/s/AKfycbxyJw-4kRWEwFFqlJmYM2B7iuyZsNbxJHT7hRDRObfHjJReY43AE6NCdGF6sbYZXEMM/exec';

  var modoActual = 'plazo';
  var tabs = document.querySelectorAll('.tab');
  var campoSecundario = document.getElementById('campoSecundario');
  var form = document.getElementById('simuladorForm');
  var errorBox = document.getElementById('simuladorError');
  var resultBox = document.getElementById('simuladorResult');
  var tableWrap = document.getElementById('simuladorTableWrap');
  var submitBtn = document.getElementById('simuladorSubmit');

  var moneyFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  var moneyFmt2 = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });

  var CAMPOS = {
    plazo: { id: 'plazo', label: 'Plazo (meses)', placeholder: 'Ej: 12', step: '1' },
    cuota: { id: 'cuota', label: 'Valor de la cuota', placeholder: 'Ej: 90.000', step: 'any' }
  };

  function renderCampoSecundario() {
    var c = CAMPOS[modoActual];
    campoSecundario.innerHTML =
      '<label for="' + c.id + '">' + c.label + '</label>' +
      '<input type="number" id="' + c.id + '" name="' + c.id + '" placeholder="' + c.placeholder + '" step="' + c.step + '" min="0" required />';
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.setAttribute('aria-selected', 'false'); });
      tab.setAttribute('aria-selected', 'true');
      modoActual = tab.dataset.modo;
      renderCampoSecundario();
      resultBox.innerHTML = '';
      tableWrap.innerHTML = '';
      errorBox.hidden = true;
    });
  });

  renderCampoSecundario();

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    resultBox.innerHTML = '';
    tableWrap.innerHTML = '';

    var monto = form.monto.value;
    var params = new URLSearchParams({ modo: modoActual, monto: monto });
    params.set(CAMPOS[modoActual].id, form[CAMPOS[modoActual].id].value);

    submitBtn.disabled = true;
    submitBtn.textContent = 'Calculando…';

    fetch(API_URL + '?' + params.toString())
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'No fue posible calcular la simulación.');
        mostrarResultado(json.data);
      })
      .catch(function (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Calcular';
      });
  });

  function mostrarResultado(data) {
    if (modoActual === 'plazo') {
      resultBox.innerHTML =
        '<div class="value">' + moneyFmt2.format(data.cuota) + '</div>' +
        '<div class="label">Cuota mensual estimada</div>';
    } else {
      resultBox.innerHTML =
        '<div class="value">' + data.plazo + ' meses</div>' +
        '<div class="label">Plazo estimado</div>';
    }

    var rows = data.tabla.map(function (r) {
      return '<tr>' +
        '<td>' + r.mes + '</td>' +
        '<td>' + moneyFmt.format(r.saldoInicial) + '</td>' +
        '<td>' + moneyFmt2.format(r.cuota) + '</td>' +
        '<td>' + moneyFmt2.format(r.interes) + '</td>' +
        '<td>' + moneyFmt2.format(r.abonoCapital) + '</td>' +
        '<td>' + moneyFmt.format(r.saldoFinal) + '</td>' +
        '</tr>';
    }).join('');

    tableWrap.innerHTML =
      '<table class="amort">' +
      '<thead><tr><th>Mes</th><th>Saldo inicial</th><th>Cuota</th><th>Interés</th><th>Abono capital</th><th>Saldo final</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>';
  }
})();
