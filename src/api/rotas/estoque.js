import { Router } from 'express';
import { idParam, paginacao, validar, z } from '../validacao.js';
import { exigirPapeis } from '../middlewares/autenticacao.js';
import { Papel } from '../../domain/papeis.js';

const consultaSaldos = z.strictObject({ ...paginacao, unidadeId: idParam, produtoId: idParam.optional() });
const consultaMovimentos = z.strictObject({
  ...paginacao,
  unidadeId: idParam,
  produtoId: idParam.optional(),
  tipo: z.enum(['ENTRADA', 'AJUSTE', 'RESERVA', 'CONSUMO', 'LIBERACAO']).optional(),
});
const novaMovimentacao = z.strictObject({
  unidadeId: z.int().positive(),
  produtoId: z.int().positive(),
  tipo: z.enum(['ENTRADA', 'AJUSTE']),
  quantidade: z.int().min(-100000).max(100000).refine((q) => q !== 0, { message: 'Quantidade nao pode ser zero.' }),
  motivo: z.string().trim().min(3).max(200).optional(),
}).superRefine((d, ctx) => {
  if (d.tipo === 'ENTRADA' && d.quantidade < 0) ctx.addIssue({ code: 'custom', path: ['quantidade'], message: 'Entrada deve ser positiva.' });
  if (d.tipo === 'AJUSTE' && !d.motivo) ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Motivo obrigatorio para ajuste.' });
});

export function rotasEstoque({ servicos, autenticar }) {
  const r = Router();
  const funcionarios = exigirPapeis(Papel.ADMIN, Papel.GERENTE, Papel.ATENDENTE, Papel.COZINHA);
  const gestores = exigirPapeis(Papel.ADMIN, Papel.GERENTE);

  r.get('/estoque', autenticar, funcionarios, (req, res) => {
    const q = validar(consultaSaldos, req.query, 'query');
    res.json(servicos.estoque.listarSaldos(req.ator, { unidadeId: q.unidadeId, produtoId: q.produtoId, pagina: q.page, limite: q.limit }));
  });

  r.get('/estoque/movimentacoes', autenticar, gestores, (req, res) => {
    const q = validar(consultaMovimentos, req.query, 'query');
    res.json(servicos.estoque.listarMovimentacoes(req.ator, { unidadeId: q.unidadeId, produtoId: q.produtoId, tipo: q.tipo, pagina: q.page, limite: q.limit }));
  });

  r.post('/estoque/movimentacoes', autenticar, gestores, (req, res) => {
    const resultado = servicos.estoque.registrarMovimentacao(req.ator, validar(novaMovimentacao, req.body), req.requestId);
    res.status(201).json(resultado);
  });

  return r;
}
