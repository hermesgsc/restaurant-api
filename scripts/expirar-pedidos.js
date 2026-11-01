import { iniciarComando } from './comum.js';

// cancela pedidos AGUARDANDO_PAGAMENTO vencidos e devolve a reserva de estoque
const { db, servicos } = iniciarComando();
try {
  const resumo = servicos.ciclo.expirarVencidos();
  console.log(`Pedidos vencidos verificados: ${resumo.verificados}, expirados: ${resumo.expirados}.`);
} finally {
  db.close();
}
