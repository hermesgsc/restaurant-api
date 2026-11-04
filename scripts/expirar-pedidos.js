import { iniciarComando } from './comum.js';

const { db, servicos } = iniciarComando();
try {
  const resumo = servicos.ciclo.expirarVencidos();
  console.log(`Pedidos vencidos verificados: ${resumo.verificados}, expirados: ${resumo.expirados}.`);
} finally {
  db.close();
}
