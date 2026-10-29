import { iniciarComando } from './comum.js';
import { popular, SENHA_DEMO, USUARIOS_DEMO } from '../src/infrastructure/seed.js';

const { db, servicos } = iniciarComando();
try {
  await popular(db, servicos);
  console.log('Seed aplicado. Credenciais de DEMONSTRACAO LOCAL (nao usar em producao):');
  for (const u of USUARIOS_DEMO) console.log(`  ${u.papel.padEnd(9)} ${u.email}  senha: ${SENHA_DEMO}`);
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
} finally {
  db.close();
}
