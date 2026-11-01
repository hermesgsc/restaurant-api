import crypto from 'node:crypto';

// adaptador simulado do gateway. segue o mesmo contrato que um gateway real
// seguiria (ver gateway.js), sem rede, sem cartao e sem credencial.
// o cenario (APROVAR, RECUSAR, TIMEOUT) e escolhido pela configuracao ou pelo
// cabecalho X-Mock-Cenario, que so existe neste mock e so em dev/teste.
export function criarGatewayMock({ latenciaMs, cenarioPadrao, resultadoConsulta }) {
  function esperar(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
    });
  }

  return {
    nome: 'MOCK',

    async autorizar({ referencia, valorCentavos, cenario }, { signal } = {}) {
      const escolhido = cenario ?? cenarioPadrao;
      if (escolhido === 'TIMEOUT') {
        // nunca responde: quem chamou desiste pelo proprio timeout
        await esperar(24 * 60 * 60 * 1000, signal);
      }
      await esperar(latenciaMs, signal);
      if (escolhido === 'RECUSAR') {
        return { status: 'RECUSADO', referencia, motivo: 'RECUSA_SIMULADA_SALDO_INSUFICIENTE', mock: true };
      }
      return {
        status: 'APROVADO',
        referencia,
        valorCentavos,
        codigoAutorizacao: `MOCK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        mock: true,
      };
    },

    // consulta usada pela reconciliacao de pagamentos INDEFINIDO. como o mock
    // nao guarda estado entre processos, a resposta vem da configuracao
    // MOCK_PAGAMENTO_RESULTADO_CONSULTA, o que deixa o teste deterministico
    async consultar({ referencia }, { signal } = {}) {
      await esperar(latenciaMs, signal);
      if (resultadoConsulta === 'TIMEOUT') await esperar(24 * 60 * 60 * 1000, signal);
      if (resultadoConsulta === 'RECUSADO') return { status: 'RECUSADO', referencia, motivo: 'RECUSA_SIMULADA_NA_CONSULTA', mock: true };
      return { status: 'APROVADO', referencia, codigoAutorizacao: `MOCK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, mock: true };
    },
  };
}
