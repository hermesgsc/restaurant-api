import { Router } from 'express';
import { booleanoQuery, esquemaId, idParam, paginacao, validar, z } from '../validacao.js';
import { exigirPapeis } from '../middlewares/autenticacao.js';
import { Papel } from '../../domain/papeis.js';

const texto = (max) => z.string().trim().min(2).max(max);
const precoCentavos = z.int().min(1).max(10_000_000);

const unidadeNova = z.strictObject({ nome: texto(100), cidade: texto(100) });
const unidadeAlteracao = z.strictObject({ nome: texto(100).optional(), cidade: texto(100).optional(), ativa: z.boolean().optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'Informe ao menos um campo.' });

const produtoNovo = z.strictObject({ nome: texto(100), descricao: z.string().trim().max(500).optional(), categoria: texto(50) });
const produtoAlteracao = z.strictObject({
  nome: texto(100).optional(),
  descricao: z.string().trim().max(500).nullable().optional(),
  categoria: texto(50).optional(),
  ativo: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Informe ao menos um campo.' });

const itemCardapio = z.strictObject({ precoCentavos: precoCentavos.optional(), disponivel: z.boolean().optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'Informe ao menos um campo.' });

const listaUnidades = z.strictObject({ ...paginacao, ativa: booleanoQuery.optional() });
const listaProdutos = z.strictObject({ ...paginacao, ativo: booleanoQuery.optional(), categoria: z.string().max(50).optional() });
const listaCardapio = z.strictObject({ ...paginacao, incluirIndisponiveis: booleanoQuery.optional() });

// autenticacao opcional: rota publica que mostra mais coisa pra quem tem papel
export function rotasCatalogo({ servicos, autenticar, autenticarOpcional }) {
  const r = Router();
  const gestores = exigirPapeis(Papel.ADMIN, Papel.GERENTE);
  const somenteAdmin = exigirPapeis(Papel.ADMIN);

  r.get('/unidades', autenticarOpcional, (req, res) => {
    const q = validar(listaUnidades, req.query, 'query');
    res.json(servicos.unidades.listar(req.ator, { ativa: q.ativa, pagina: q.page, limite: q.limit }));
  });

  r.post('/unidades', autenticar, somenteAdmin, (req, res) => {
    const unidade = servicos.unidades.criar(req.ator, validar(unidadeNova, req.body), req.requestId);
    res.status(201).location(`/unidades/${unidade.id}`).json(unidade);
  });

  r.patch('/unidades/:id', autenticar, gestores, (req, res) => {
    const { id } = validar(esquemaId, req.params, 'path');
    res.json(servicos.unidades.atualizar(req.ator, id, validar(unidadeAlteracao, req.body), req.requestId));
  });

  r.get('/unidades/:id/cardapio', autenticarOpcional, (req, res) => {
    const { id } = validar(esquemaId, req.params, 'path');
    const q = validar(listaCardapio, req.query, 'query');
    res.json(servicos.cardapio.listar(req.ator, id, { incluirIndisponiveis: q.incluirIndisponiveis, pagina: q.page, limite: q.limit }));
  });

  r.put('/unidades/:id/cardapio/:produtoId', autenticar, gestores, (req, res) => {
    const { id, produtoId } = validar(z.strictObject({ id: idParam, produtoId: idParam }), req.params, 'path');
    res.json(servicos.cardapio.definirItem(req.ator, id, produtoId, validar(itemCardapio, req.body), req.requestId));
  });

  r.get('/produtos', autenticarOpcional, (req, res) => {
    const q = validar(listaProdutos, req.query, 'query');
    res.json(servicos.produtos.listar(req.ator, { ativo: q.ativo, categoria: q.categoria, pagina: q.page, limite: q.limit }));
  });

  r.post('/produtos', autenticar, somenteAdmin, (req, res) => {
    const produto = servicos.produtos.criar(req.ator, validar(produtoNovo, req.body), req.requestId);
    res.status(201).location(`/produtos/${produto.id}`).json(produto);
  });

  r.patch('/produtos/:id', autenticar, somenteAdmin, (req, res) => {
    const { id } = validar(esquemaId, req.params, 'path');
    res.json(servicos.produtos.atualizar(req.ator, id, validar(produtoAlteracao, req.body), req.requestId));
  });

  return r;
}
