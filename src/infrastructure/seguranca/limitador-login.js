// limitador em memoria por chave (ip + e-mail). serve pra demo local com um
// processo so; com varias instancias teria que ir pra um armazenamento comum.
export function criarLimitadorLogin({ maxTentativas, janelaMs }, relogio = () => Date.now()) {
  const falhas = new Map();

  function limpar(chave, instante) {
    const registro = falhas.get(chave);
    if (registro && instante - registro.inicio >= janelaMs) falhas.delete(chave);
    return falhas.get(chave);
  }

  return {
    segundosBloqueado(chave) {
      const instante = relogio();
      const registro = limpar(chave, instante);
      if (!registro || registro.total < maxTentativas) return 0;
      return Math.ceil((registro.inicio + janelaMs - instante) / 1000);
    },
    registrarFalha(chave) {
      const instante = relogio();
      const registro = limpar(chave, instante) ?? { inicio: instante, total: 0 };
      registro.total += 1;
      falhas.set(chave, registro);
    },
    registrarSucesso(chave) {
      falhas.delete(chave);
    },
  };
}
