import crypto from 'node:crypto';
import { agora, placeholders, transacao } from '../infrastructure/banco.js';
import { erros } from '../domain/erros.js';
import { Papel } from '../domain/papeis.js';
import { StatusPedido } from '../domain/pedido.js';

const STATUS_EM_ANDAMENTO = [StatusPedido.AGUARDANDO_PAGAMENTO, StatusPedido.EM_PREPARO, StatusPedido.PRONTO];

// anonimizacao do titular (cliente). apaga o que identifica a pessoa e mantem
// o que precisa ficar por obrigacao legal/contabil (pedido, valor, pagamento),
// agora sem ligacao com nome ou e-mail. a linha do usuario continua existindo
// porque pedidos e auditoria apontam pra ela pelo id.
export function criarServicoLgpd({ db, auditoria, fidelidade }) {
  const buscarUsuario = db.prepare('SELECT * FROM usuarios WHERE id = ?');
  const pedidosEmAndamento = db.prepare(`SELECT COUNT(*) AS n FROM pedidos WHERE cliente_id = ? AND status IN (${placeholders(STATUS_EM_ANDAMENTO)})`);

  function anonimizar(usuarioId, { ator = null, requestId = 'lgpd-comando' } = {}) {
    return transacao(db, () => {
      const usuario = buscarUsuario.get(usuarioId);
      if (!usuario) throw erros.naoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuario nao encontrado.');
      if (usuario.anonimizado_em) {
        throw erros.conflito('USUARIO_JA_ANONIMIZADO', 'Este usuario ja foi anonimizado.', [{ field: 'usuarioId', issue: `Anonimizado em ${usuario.anonimizado_em}` }]);
      }
      if (usuario.papel !== Papel.CLIENTE) {
        throw erros.conflito('ANONIMIZACAO_SO_CLIENTE', 'A anonimizacao por este fluxo vale apenas para contas de cliente.', [
          { field: 'usuarioId', issue: `Papel ${usuario.papel}` },
        ]);
      }
      const andamento = pedidosEmAndamento.get(usuarioId, ...STATUS_EM_ANDAMENTO).n;
      if (andamento > 0) {
        throw erros.conflito('PEDIDOS_EM_ANDAMENTO', 'O cliente tem pedidos em andamento. Conclua ou cancele antes de anonimizar.', [
          { field: 'usuarioId', issue: `${andamento} pedido(s) em andamento.` },
        ]);
      }

      const pontosBaixados = fidelidade.encerrarParaAnonimizacao(usuarioId, { ator, requestId });
      const instante = agora();
      // senha aleatoria que ninguem conhece, so pra satisfazer o NOT NULL
      const senhaInutil = `anonimizado:${crypto.randomBytes(32).toString('hex')}`;
      db.prepare(`UPDATE usuarios SET nome = ?, email = ?, senha_hash = ?, ativo = 0, anonimizado_em = ?, atualizado_em = ?
        WHERE id = ?`).run('Titular anonimizado', `anonimizado-${usuarioId}@anonimizado.invalid`, senhaInutil, instante, instante, usuarioId);

      auditoria.registrar({
        ator, acao: 'USUARIO_ANONIMIZADO', recursoTipo: 'USUARIO', recursoId: usuarioId, requestId,
        detalhes: { pontosBaixados },
      });
      return { usuarioId, anonimizadoEm: instante, pontosBaixados };
    });
  }

  return { anonimizar };
}
