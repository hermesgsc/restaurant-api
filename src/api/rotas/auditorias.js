import { Router } from 'express';
import { idParam, paginacao, validar, z } from '../validacao.js';
import { exigirPapeis } from '../middlewares/autenticacao.js';
import { Papel } from '../../domain/papeis.js';

const filtros = z.strictObject({
  ...paginacao,
  unidadeId: idParam.optional(),
  acao: z.string().regex(/^[A-Z_]{3,60}$/).optional(),
  recursoTipo: z.string().regex(/^[A-Z_]{3,40}$/).optional(),
  recursoId: z.string().max(40).optional(),
  requestId: z.string().max(64).optional(),
});

export function rotasAuditorias({ servicos, autenticar }) {
  const r = Router();
  r.get('/auditorias', autenticar, exigirPapeis(Papel.ADMIN, Papel.GERENTE), (req, res) => {
    const { page, limit, ...resto } = validar(filtros, req.query, 'query');
    res.json(servicos.auditoria.listar(req.ator, resto, { pagina: page, limite: limit }));
  });
  return r;
}
