import { iniciarComando } from './comum.js';
import { ErroNegocio } from '../src/domain/erros.js';

const usuarioId = Number(process.argv[2]);
if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
  console.error('Uso: npm run lgpd:anonimizar -- <usuarioId>');
  process.exit(1);
}

const { db, servicos } = iniciarComando();
try {
  const r = servicos.lgpd.anonimizar(usuarioId, { requestId: `lgpd-comando-${Date.now()}` });
  console.log(`Usuario ${r.usuarioId} anonimizado em ${r.anonimizadoEm}. Pontos baixados: ${r.pontosBaixados}.`);
} catch (erro) {
  if (!(erro instanceof ErroNegocio)) throw erro;
  console.error(`${erro.codigo}: ${erro.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
