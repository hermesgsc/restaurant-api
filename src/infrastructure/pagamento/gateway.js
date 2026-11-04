export class TimeoutGateway extends Error {
  constructor() {
    super('gateway nao respondeu no prazo');
    this.name = 'TimeoutGateway';
  }
}

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
