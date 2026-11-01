import { Router } from 'express';
import { paginacao, validar, z } from '../validacao.js';

const filtrosHistorico = z.strictObject({ ...paginacao });

export function rotasFidelidade({ servicos, autenticar }) {
  const r = Router();

  r.get('/fidelidade/saldo', autenticar, (req, res) => {
    res.json(servicos.fidelidade.saldo(req.ator));
  });

  r.get('/fidelidade/historico', autenticar, (req, res) => {
    const { page, limit } = validar(filtrosHistorico, req.query, 'query');
    res.json(servicos.fidelidade.historico(req.ator, { pagina: page, limite: limit }));
  });

  // PUT concede e DELETE revoga; os dois sao idempotentes
  r.put('/fidelidade/consentimento', autenticar, (req, res) => {
    res.json(servicos.fidelidade.conceder(req.ator, req.requestId));
  });

  r.delete('/fidelidade/consentimento', autenticar, (req, res) => {
    res.json(servicos.fidelidade.revogar(req.ator, req.requestId));
  });

  return r;
}
