import { carregarConfig, ErroConfiguracao } from './config.js';
import { criarApp } from './app.js';

let config;
try {
  config = carregarConfig();
} catch (erro) {
  if (erro instanceof ErroConfiguracao) {
    console.error(`Configuracao invalida: ${erro.message}`);
    process.exit(1);
  }
  throw erro;
}

const { app, db } = criarApp(config);
const servidor = app.listen(config.porta, () => {
  console.log(`API ouvindo em http://localhost:${config.porta} (ambiente ${config.ambiente})`);
});

function encerrar() {
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
