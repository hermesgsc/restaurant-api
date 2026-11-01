import { Router } from 'express';
import { esquemaId, validar, z } from '../validacao.js';
import { erros } from '../../domain/erros.js';
import { lerChaveIdempotencia } from './pedidos.js';

const CENARIOS_MOCK = ['APROVAR', 'RECUSAR', 'TIMEOUT'];

// o corpo e vazio de proposito: valor e forma vem do pedido no servidor
const corpoPagamento = z.strictObject({});

// X-Mock-Cenario so e aceito quando a configuracao permite (dev/teste).
// em producao o cabecalho e rejeitado em vez de ignorado, pra ninguem achar
// que escolheu o resultado do pagamento
function lerCenario(req, config) {
  const cenario = req.get('x-mock-cenario');
  if (cenario === undefined) return undefined;
  if (!config.mockPagamento.permitirCenario) {
    throw erros.validacao('CENARIO_MOCK_NAO_PERMITIDO', 'O cabecalho X-Mock-Cenario so e aceito em desenvolvimento e teste.', [
      { field: 'X-Mock-Cenario', issue: 'Cabecalho nao permitido neste ambiente.' },
    ]);
  }
  if (!CENARIOS_MOCK.includes(cenario)) {
    throw erros.validacao('CENARIO_MOCK_INVALIDO', 'Cenario de mock invalido.', [
      { field: 'X-Mock-Cenario', issue: `Use um de: ${CENARIOS_MOCK.join(', ')}.` },
    ]);
  }
  return cenario;
}

export function rotasPagamentos({ config, servicos, autenticar }) {
  const r = Router();

  r.post('/pedidos/:id/pagamentos', autenticar, async (req, res) => {
    const { id } = validar(esquemaId, req.params, 'path');
    validar(corpoPagamento, req.body ?? {});
    const chave = lerChaveIdempotencia(req);
    const cenario = lerCenario(req, config);
    const resultado = await servicos.pagamentos.pagar(req.ator, id, { chave, cenario, requestId: req.requestId });
    if (resultado.repetida) res.set('Idempotent-Replayed', 'true');
    res.status(resultado.status).location(`/pagamentos/${resultado.corpo.pagamento.id}`).json(resultado.corpo);
  });

  r.get('/pedidos/:id/pagamentos', autenticar, (req, res) => {
    const { id } = validar(esquemaId, req.params, 'path');
    res.json(servicos.pagamentos.listarDoPedido(req.ator, id, req.requestId));
  });

  r.get('/pagamentos/:id', autenticar, (req, res) => {
    const { id } = validar(esquemaId, req.params, 'path');
    res.json(servicos.pagamentos.obter(req.ator, id, req.requestId));
  });

  return r;
}
