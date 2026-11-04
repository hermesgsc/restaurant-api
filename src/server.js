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

const { app, db, servicos } = criarApp(config);
const servidor = app.listen(config.porta, () => {
  console.log(`API ouvindo em http://localhost:${config.porta} (ambiente ${config.ambiente})`);
});

let timerExpiracao = null;
if (config.expiracaoIntervaloMs > 0) {
  timerExpiracao = setInterval(() => {
    try {
      const { expirados } = servicos.ciclo.expirarVencidos();
      if (expirados > 0) console.log(`${expirados} pedido(s) expirado(s) por falta de pagamento.`);
    } catch (erro) {
      console.error('Falha ao expirar pedidos:', erro.message);
    }
  }, config.expiracaoIntervaloMs);
  timerExpiracao.unref();
}

function encerrar() {
  clearInterval(timerExpiracao);
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
