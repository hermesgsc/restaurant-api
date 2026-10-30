import { Router } from 'express';
import { esquemaId, idParam, paginacao, validar, z } from '../validacao.js';
import { erros } from '../../domain/erros.js';
import { CANAIS_PEDIDO, LIMITES_PEDIDO, STATUS_PEDIDO } from '../../domain/pedido.js';

const CHAVE_VALIDA = /^[A-Za-z0-9._:-]{8,100}$/;

// strictObject barra precoCentavos, totalCentavos, desconto ou status no corpo
const novoPedido = z.strictObject({
  unidadeId: z.int().positive(),
  canalPedido: z.enum(CANAIS_PEDIDO),
  formaPagamento: z.enum(['MOCK']),
  clienteId: z.int().positive().optional(),
  itens: z.array(z.strictObject({
    produtoId: z.int().positive(),
    quantidade: z.int().min(1).max(LIMITES_PEDIDO.maxQuantidade),
  })).min(1).max(LIMITES_PEDIDO.maxLinhas),
});

const filtrosPedidos = z.strictObject({
  ...paginacao,
  unidadeId: idParam.optional(),
  status: z.enum(STATUS_PEDIDO).optional(),
  canalPedido: z.enum(CANAIS_PEDIDO).optional(),
});

export function lerChaveIdempotencia(req) {
  const chave = req.get('idempotency-key');
  if (!chave || !CHAVE_VALIDA.test(chave)) {
    throw erros.validacao('IDEMPOTENCY_KEY_INVALIDA', 'Envie o cabecalho Idempotency-Key com 8 a 100 caracteres (letras, numeros, . _ : -).', [
      { field: 'Idempotency-Key', issue: chave ? 'Formato invalido.' : 'Cabecalho obrigatorio.' },
    ]);
  }
  return chave;
}

export function rotasPedidos({ servicos, autenticar }) {
  const r = Router();

  r.post('/pedidos', autenticar, (req, res) => {
    const dados = validar(novoPedido, req.body);
    const chave = lerChaveIdempotencia(req);
    const resultado = servicos.pedidos.criar(req.ator, dados, { chave, requestId: req.requestId });
    if (resultado.repetida) res.set('Idempotent-Replayed', 'true');
    res.status(resultado.status).location(`/pedidos/${resultado.corpo.id}`).json(resultado.corpo);
  });

  r.get('/pedidos', autenticar, (req, res) => {
    const q = validar(filtrosPedidos, req.query, 'query');
    res.json(servicos.pedidos.listar(req.ator, {
      unidadeId: q.unidadeId, status: q.status, canalPedido: q.canalPedido, pagina: q.page, limite: q.limit,
    }));
  });

  r.get('/pedidos/:id', autenticar, (req, res) => {
    const { id } = validar(esquemaId, req.params, 'path');
    res.json(servicos.pedidos.obter(req.ator, id, req.requestId));
  });

  return r;
}
