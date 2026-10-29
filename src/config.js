import fs from 'node:fs';
import path from 'node:path';

export class ErroConfiguracao extends Error {}

function lerArquivoEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return {};
  const valores = {};
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const texto = linha.trim();
    if (!texto || texto.startsWith('#')) continue;
    const pos = texto.indexOf('=');
    if (pos < 1) continue;
    valores[texto.slice(0, pos).trim()] = texto.slice(pos + 1).trim();
  }
  return valores;
}

function inteiro(env, nome, padrao, minimo, maximo) {
  const bruto = env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    throw new ErroConfiguracao(`${nome} deve ser inteiro entre ${minimo} e ${maximo}.`);
  }
  return valor;
}

function booleano(env, nome, padrao) {
  const bruto = env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  if (bruto === 'true') return true;
  if (bruto === 'false') return false;
  throw new ErroConfiguracao(`${nome} deve ser true ou false.`);
}

function opcao(env, nome, padrao, opcoes) {
  const valor = env[nome] || padrao;
  if (!opcoes.includes(valor)) throw new ErroConfiguracao(`${nome} deve ser um de: ${opcoes.join(', ')}.`);
  return valor;
}

// le o .env e as variaveis do processo (o processo ganha). os testes passam
// `sobrescrever` pra isolar banco e segredo. sem JWT_SECRET a api nem sobe.
export function carregarConfig(sobrescrever = {}, { lerEnv = true } = {}) {
  const raiz = path.resolve(import.meta.dirname, '..');
  const env = { ...(lerEnv ? lerArquivoEnv(path.join(raiz, '.env')) : {}), ...process.env, ...sobrescrever };

  const ambiente = opcao(env, 'NODE_ENV', 'development', ['development', 'test', 'production']);
  const segredo = env.JWT_SECRET || '';
  if (segredo.length < 32) {
    throw new ErroConfiguracao('JWT_SECRET ausente ou curto: defina um valor aleatorio com pelo menos 32 caracteres (veja .env.example).');
  }

  const arquivoBanco = env.DATABASE_FILE || './data/rede-restaurantes.db';
  const permitirCenario = booleano(env, 'MOCK_PAGAMENTO_PERMITIR_CENARIO', ambiente !== 'production');

  return Object.freeze({
    ambiente,
    porta: inteiro(env, 'PORT', 3000, 0, 65535),
    arquivoBanco: arquivoBanco === ':memory:' ? arquivoBanco : path.resolve(raiz, arquivoBanco),
    jwt: Object.freeze({ segredo, expiracao: env.JWT_EXPIRACAO || '1h' }),
    bcryptCusto: inteiro(env, 'BCRYPT_CUSTO', 11, 4, 14),
    login: Object.freeze({
      maxTentativas: inteiro(env, 'LOGIN_MAX_TENTATIVAS', 5, 1, 1000),
      janelaMs: inteiro(env, 'LOGIN_JANELA_MS', 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
    }),
    corsOrigens: (env.CORS_ORIGENS || '').split(',').map((o) => o.trim()).filter(Boolean),
    pedidoExpiracaoMinutos: inteiro(env, 'PEDIDO_EXPIRACAO_MINUTOS', 15, 1, 24 * 60),
    expiracaoIntervaloMs: inteiro(env, 'PEDIDO_EXPIRACAO_INTERVALO_MS', 60000, 0, 24 * 60 * 60 * 1000),
    pagamentoTimeoutMs: inteiro(env, 'PAGAMENTO_TIMEOUT_MS', 3000, 50, 60000),
    mockPagamento: Object.freeze({
      latenciaMs: inteiro(env, 'MOCK_PAGAMENTO_LATENCIA_MS', 50, 0, 60000),
      cenarioPadrao: opcao(env, 'MOCK_PAGAMENTO_CENARIO_PADRAO', 'APROVAR', ['APROVAR', 'RECUSAR', 'TIMEOUT']),
      // seletor de cenario e coisa do mock, em producao fica sempre desligado
      permitirCenario: ambiente === 'production' ? false : permitirCenario,
      resultadoConsulta: opcao(env, 'MOCK_PAGAMENTO_RESULTADO_CONSULTA', 'APROVADO', ['APROVADO', 'RECUSADO', 'TIMEOUT']),
    }),
    versaoTermoFidelidade: 'FIDELIDADE-v1',
  });
}
