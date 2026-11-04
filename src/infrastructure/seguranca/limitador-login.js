export function criarLimitadorLogin({ maxTentativas, janelaMs }, relogio = () => Date.now()) {
  const falhas = new Map();

  function limpar(chave, instante) {
    const registro = falhas.get(chave);
    if (registro && instante - registro.inicio >= janelaMs) falhas.delete(chave);
    return falhas.get(chave);
  }

  return {
    tentar(chave) {
      const instante = relogio();
      const registro = limpar(chave, instante) ?? { inicio: instante, total: 0 };
      if (registro.total >= maxTentativas) return Math.ceil((registro.inicio + janelaMs - instante) / 1000);
      registro.total += 1;
      falhas.set(chave, registro);
      return 0;
    },
    registrarSucesso(chave) {
      falhas.delete(chave);
    },
  };
}
