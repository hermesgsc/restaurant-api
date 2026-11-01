import { iniciarComando } from './comum.js';

// consulta o gateway pros pagamentos INDEFINIDO ou parados em PROCESSANDO
const { db, servicos } = iniciarComando();
try {
  const resumo = await servicos.pagamentos.reconciliar();
  console.log(`Pagamentos verificados: ${resumo.verificados}.`, resumo.resultados);
} finally {
  db.close();
}
