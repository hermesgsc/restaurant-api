export const Papel = Object.freeze({
  ADMIN: 'ADMIN',
  GERENTE: 'GERENTE',
  ATENDENTE: 'ATENDENTE',
  COZINHA: 'COZINHA',
  CLIENTE: 'CLIENTE',
});

export const PAPEIS = Object.values(Papel);
export const PAPEIS_FUNCIONARIO = [Papel.GERENTE, Papel.ATENDENTE, Papel.COZINHA];

export function ehFuncionario(ator) {
  return PAPEIS_FUNCIONARIO.includes(ator.papel);
}

// admin representa a matriz e atua em qualquer unidade; funcionario so nas unidades vinculadas
export function temEscopoUnidade(ator, unidadeId) {
  if (ator.papel === Papel.ADMIN) return true;
  if (!ehFuncionario(ator)) return false;
  return ator.unidadeIds.includes(unidadeId);
}
