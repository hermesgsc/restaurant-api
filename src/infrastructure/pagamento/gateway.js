// contrato do gateway de pagamento. a aplicacao so conhece isto; trocar o mock
// por um provedor real seria escrever outro adaptador com os mesmos metodos.
//
// autorizar({ referencia, valorCentavos, cenario? }, { signal })
//   -> { status: 'APROVADO', codigoAutorizacao, ... } | { status: 'RECUSADO', motivo, ... }
// consultar({ referencia }, { signal })
//   -> mesmo formato de autorizar
//
// `referencia` e unica por pagamento e serve como chave de idempotencia no
// provedor. `signal` e abortado quando estoura o PAGAMENTO_TIMEOUT_MS.

export class TimeoutGateway extends Error {
  constructor() {
    super('gateway nao respondeu no prazo');
    this.name = 'TimeoutGateway';
  }
}

// o prazo vale mesmo se o adaptador ignorar o signal: a corrida com o abort
// garante que a requisicao nunca fica presa esperando o gateway
export async function chamarComTimeout(fn, timeoutMs) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(new TimeoutGateway()), timeoutMs);
  const abortou = new Promise((_resolve, reject) => {
    controle.signal.addEventListener('abort', () => reject(controle.signal.reason), { once: true });
  });
  try {
    return await Promise.race([fn(controle.signal), abortou]);
  } finally {
    clearTimeout(timer);
  }
}
