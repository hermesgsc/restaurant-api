import { carregarConfig } from '../src/config.js';
import { abrirBanco, migrar } from '../src/infrastructure/banco.js';

const config = carregarConfig();
const db = abrirBanco(config.arquivoBanco);
const novas = migrar(db);
console.log(novas.length ? `Migracoes aplicadas: ${novas.join(', ')}` : 'Banco ja estava atualizado.');
console.log(`Arquivo do banco: ${config.arquivoBanco}`);
db.close();
