import express from 'express';
import { abrirBanco, migrar } from './infrastructure/banco.js';
import { criarServicoSenhas } from './infrastructure/seguranca/senhas.js';
import { criarServicoTokens } from './infrastructure/seguranca/tokens.js';
import { criarLimitadorLogin } from './infrastructure/seguranca/limitador-login.js';
import { criarAuditoria } from './application/auditoria.js';
import { criarServicoUsuarios } from './application/usuarios.js';
import { criarServicoUnidades } from './application/unidades.js';
import { criarServicoProdutos } from './application/produtos.js';
import { criarServicoCardapio } from './application/cardapio.js';
import { criarServicoEstoque } from './application/estoque.js';
import { autenticar } from './api/middlewares/autenticacao.js';
import { cabecalhosSeguranca, cors, criarLogger, logRequisicoes, requestId, rotaNaoEncontrada } from './api/middlewares/basicos.js';
import { tratadorErros } from './api/http-erros.js';
import { rotasIdentidade } from './api/rotas/identidade.js';
import { rotasCatalogo } from './api/rotas/catalogo.js';
import { rotasAuditorias } from './api/rotas/auditorias.js';
import { rotasEstoque } from './api/rotas/estoque.js';

// monta os servicos da aplicacao em cima de um banco ja aberto.
// e o mesmo ponto de entrada pro servidor, pros comandos e pros testes
export function criarServicos(config, db) {
  const auditoria = criarAuditoria(db);
  const senhas = criarServicoSenhas(config.bcryptCusto);
  const tokens = criarServicoTokens(config.jwt);
  const limitador = criarLimitadorLogin(config.login);
  const usuarios = criarServicoUsuarios({ db, senhas, tokens, limitador, auditoria });
  const unidades = criarServicoUnidades({ db, auditoria });
  const produtos = criarServicoProdutos({ db, auditoria });
  const cardapio = criarServicoCardapio({ db, auditoria, unidades, produtos });
  const estoque = criarServicoEstoque({ db, auditoria, unidades, produtos });
  return { db, auditoria, senhas, tokens, usuarios, unidades, produtos, cardapio, estoque };
}

export function criarApp(config, { db = abrirBanco(config.arquivoBanco), logger = criarLogger(config.ambiente) } = {}) {
  migrar(db);
  const servicos = criarServicos(config, db);
  const deps = {
    servicos,
    autenticar: autenticar(servicos),
    autenticarOpcional: autenticar(servicos, { opcional: true }),
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.set('query parser', 'simple');

  app.use(requestId());
  app.use(logRequisicoes(logger));
  app.use(cabecalhosSeguranca());
  app.use(cors(config.corsOrigens));
  app.use(express.json({ limit: '32kb', strict: true }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(rotasIdentidade(deps));
  app.use(rotasCatalogo(deps));
  app.use(rotasEstoque(deps));
  app.use(rotasAuditorias(deps));

  app.use(rotaNaoEncontrada());
  app.use(tratadorErros(logger));
  return { app, servicos, db };
}
