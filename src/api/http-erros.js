import { ErroNegocio, TipoErro } from '../domain/erros.js';

const STATUS_POR_TIPO = {
  [TipoErro.VALIDACAO]: 422,
  [TipoErro.NAO_AUTENTICADO]: 401,
  [TipoErro.PROIBIDO]: 403,
  [TipoErro.NAO_ENCONTRADO]: 404,
  [TipoErro.CONFLITO]: 409,
  [TipoErro.LIMITE_EXCEDIDO]: 429,
};

export function envelopeErro(req, codigo, mensagem, detalhes = []) {
  return {
    error: codigo,
    message: mensagem,
    details: detalhes,
    timestamp: new Date().toISOString(),
    path: req.originalUrl.split('?')[0],
    requestId: req.requestId,
  };
}

export function tratadorErros(logger) {
  return (erro, req, res, _next) => {
    if (erro instanceof ErroNegocio) {
      const status = STATUS_POR_TIPO[erro.tipo] ?? 400;
      if (erro.segundosEspera) res.set('Retry-After', String(erro.segundosEspera));
      return res.status(status).json(envelopeErro(req, erro.codigo, erro.message, erro.detalhes));
    }
    if (erro?.type === 'entity.parse.failed') {
      return res.status(400).json(envelopeErro(req, 'JSON_MALFORMADO', 'O corpo da requisicao nao e um JSON valido.'));
    }
    if (erro?.type === 'entity.too.large') {
      return res.status(413).json(envelopeErro(req, 'CORPO_MUITO_GRANDE', 'O corpo da requisicao excede o limite permitido.'));
    }
    if (erro?.type === 'encoding.unsupported' || erro?.type === 'charset.unsupported') {
      return res.status(415).json(envelopeErro(req, 'CODIFICACAO_NAO_SUPORTADA', 'Codificacao do corpo nao suportada.'));
    }
    if (erro instanceof URIError) {
      return res.status(400).json(envelopeErro(req, 'PARAMETRO_MALFORMADO', 'A URL tem um parametro com codificacao invalida.'));
    }
    logger.error({ requestId: req.requestId, erro: erro?.message, stack: erro?.stack });
    return res.status(500).json(envelopeErro(req, 'ERRO_INTERNO', 'Erro inesperado. Informe o requestId ao suporte.'));
  };
}
