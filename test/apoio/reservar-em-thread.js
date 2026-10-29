// roda numa worker thread com conexao sqlite propria, pra simular outro
// processo disputando o mesmo estoque no mesmo arquivo de banco
import { parentPort, workerData } from 'node:worker_threads';
import { abrirBanco } from '../../src/infrastructure/banco.js';
import { criarServicoEstoque } from '../../src/application/estoque.js';

const { arquivo, unidadeId, produtoId, sinal } = workerData;
const db = abrirBanco(arquivo);
const estoque = criarServicoEstoque({ db, auditoria: null, unidades: null, produtos: null });

// espera todas as threads ficarem prontas pra largar juntas
Atomics.wait(new Int32Array(sinal), 0, 0);
try {
  estoque.movimentar({ unidadeId, produtoId, tipo: 'RESERVA', quantidade: 1, motivo: 'teste de concorrencia' });
  parentPort.postMessage({ ok: true });
} catch (erro) {
  parentPort.postMessage({ ok: false, codigo: erro.codigo ?? erro.message });
} finally {
  db.close();
}
