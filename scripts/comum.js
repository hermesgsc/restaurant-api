import { carregarConfig, ErroConfiguracao } from '../src/config.js';
import { abrirBanco, migrar } from '../src/infrastructure/banco.js';
import { criarServicos } from '../src/app.js';

// abre banco + servicos pros comandos de linha de comando
export function iniciarComando() {
  try {
    const config = carregarConfig();
    const db = abrirBanco(config.arquivoBanco);
    migrar(db);
    return { config, db, servicos: criarServicos(config, db) };
  } catch (erro) {
    if (erro instanceof ErroConfiguracao) {
      console.error(`Configuracao invalida: ${erro.message}`);
      process.exit(1);
    }
    throw erro;
  }
}
