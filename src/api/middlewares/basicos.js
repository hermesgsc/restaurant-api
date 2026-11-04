import crypto from 'node:crypto';
import { envelopeErro } from '../http-erros.js';

const REQUEST_ID_VALIDO = /^[A-Za-z0-9._-]{8,64}$/;

export function requestId() {
  return (req, res, next) => {
    const recebido = req.get('x-request-id');
    req.requestId = recebido && REQUEST_ID_VALIDO.test(recebido) ? recebido : crypto.randomUUID();
    res.set('X-Request-Id', req.requestId);
    next();
  };
}

export function logRequisicoes(logger) {
  return (req, res, next) => {
    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info({
        requestId: req.requestId,
        metodo: req.method,
        rota: req.originalUrl.split('?')[0],
        status: res.statusCode,
        duracaoMs: Number((process.hrtime.bigint() - inicio) / 1000000n),
        atorId: req.ator?.id,
      });
    });
    next();
  };
}

export function cabecalhosSeguranca() {
  return (_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'no-store');
    next();
  };
}

export function cors(origens) {
  return (req, res, next) => {
    const origem = req.get('origin');
    if (origem && origens.includes(origem)) {
      res.set('Access-Control-Allow-Origin', origem);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Request-Id');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.set('Access-Control-Expose-Headers', 'X-Request-Id, Retry-After');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  };
}

export function rotaNaoEncontrada() {
  return (req, res) => res.status(404).json(envelopeErro(req, 'ROTA_NAO_ENCONTRADA', 'Rota nao encontrada.'));
}

export function criarLogger(ambiente) {
  const silencioso = ambiente === 'test';
  const escrever = (nivel, dados) => {
    if (silencioso && nivel !== 'error') return;
    const linha = JSON.stringify({ nivel, instante: new Date().toISOString(), ...dados });
    (nivel === 'error' ? console.error : console.log)(linha);
  };
  return { info: (d) => escrever('info', d), error: (d) => escrever('error', d) };
}
