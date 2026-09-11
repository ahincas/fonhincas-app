(function () {
  var moneyFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  var moneyFmt2 = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function tablaAmortizacion(tabla) {
    var rows = tabla.map(function (r) {
      return '<tr>' +
        '<td>' + r.mes + '</td>' +
        '<td>' + moneyFmt.format(r.saldoInicial) + '</td>' +
        '<td>' + moneyFmt2.format(r.cuota) + '</td>' +
        '<td>' + moneyFmt2.format(r.interes) + '</td>' +
        '<td>' + moneyFmt2.format(r.abonoCapital) + '</td>' +
        '<td>' + moneyFmt.format(r.saldoFinal) + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="table-wrap__scroll"><table class="amort">' +
      '<thead><tr><th>Mes</th><th>Saldo inicial</th><th>Cuota</th><th>Interés</th><th>Abono capital</th><th>Saldo final</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  window.FonhincasFormat = {
    moneyFmt: moneyFmt,
    moneyFmt2: moneyFmt2,
    escapeHtml: escapeHtml,
    tablaAmortizacion: tablaAmortizacion
  };
})();
