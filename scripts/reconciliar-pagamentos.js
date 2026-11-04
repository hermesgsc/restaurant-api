import { iniciarComando } from './comum.js';

const { db, servicos } = iniciarComando();
try {
  const resumo = await servicos.pagamentos.reconciliar();
  console.log(`Pagamentos verificados: ${resumo.verificados}.`, resumo.resultados);
} finally {
  db.close();
}
