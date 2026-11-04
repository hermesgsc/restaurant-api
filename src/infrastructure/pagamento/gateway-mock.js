import crypto from 'node:crypto';

export const CENARIOS_MOCK = Object.freeze(['APROVAR', 'RECUSAR', 'TIMEOUT']);

const NUNCA_MS = 24 * 60 * 60 * 1000;

function codigoAutorizacao() {
  return `MOCK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

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
        await esperar(NUNCA_MS, signal);
      }
      await esperar(latenciaMs, signal);
      if (escolhido === 'RECUSAR') {
        return { status: 'RECUSADO', referencia, motivo: 'RECUSA_SIMULADA_SALDO_INSUFICIENTE', mock: true };
      }
      return {
        status: 'APROVADO',
        referencia,
        valorCentavos,
        codigoAutorizacao: codigoAutorizacao(),
        mock: true,
      };
    },

    async consultar({ referencia }, { signal } = {}) {
      await esperar(latenciaMs, signal);
      if (resultadoConsulta === 'TIMEOUT') await esperar(NUNCA_MS, signal);
      if (resultadoConsulta === 'RECUSADO') return { status: 'RECUSADO', referencia, motivo: 'RECUSA_SIMULADA_NA_CONSULTA', mock: true };
      return { status: 'APROVADO', referencia, codigoAutorizacao: codigoAutorizacao(), mock: true };
    },
  };
}
