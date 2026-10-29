import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';

// apaga o arquivo sqlite local; depois rode db:migrate e db:seed
const config = carregarConfig();
if (config.ambiente === 'production') {
  console.error('db:reset nao roda com NODE_ENV=production.');
  process.exit(1);
}
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(config.arquivoBanco + sufixo, { force: true });
console.log(`Banco removido: ${config.arquivoBanco}`);
