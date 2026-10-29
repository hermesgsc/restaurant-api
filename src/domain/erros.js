export const TipoErro = Object.freeze({
  VALIDACAO: 'VALIDACAO',
  NAO_AUTENTICADO: 'NAO_AUTENTICADO',
  PROIBIDO: 'PROIBIDO',
  NAO_ENCONTRADO: 'NAO_ENCONTRADO',
  CONFLITO: 'CONFLITO',
  REQUISICAO_INVALIDA: 'REQUISICAO_INVALIDA',
  LIMITE_EXCEDIDO: 'LIMITE_EXCEDIDO',
});

// erro de negocio nao sabe nada de http, quem traduz o tipo em status e a camada api
export class ErroNegocio extends Error {
  constructor(tipo, codigo, mensagem, detalhes = []) {
    super(mensagem);
    this.tipo = tipo;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export const erros = {
  validacao: (codigo, mensagem, detalhes) => new ErroNegocio(TipoErro.VALIDACAO, codigo, mensagem, detalhes),
  naoAutenticado: (mensagem = 'Autenticacao necessaria.') =>
    new ErroNegocio(TipoErro.NAO_AUTENTICADO, 'NAO_AUTENTICADO', mensagem),
  proibido: (mensagem = 'Voce nao tem permissao para esta operacao.') =>
    new ErroNegocio(TipoErro.PROIBIDO, 'ACESSO_NEGADO', mensagem),
  naoEncontrado: (codigo, mensagem, detalhes) => new ErroNegocio(TipoErro.NAO_ENCONTRADO, codigo, mensagem, detalhes),
  conflito: (codigo, mensagem, detalhes) => new ErroNegocio(TipoErro.CONFLITO, codigo, mensagem, detalhes),
};
