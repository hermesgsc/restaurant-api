import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { carregarConfig, ErroConfiguracao } from '../../src/config.js';

const base = { JWT_SECRET: 'x'.repeat(40) };
const carregar = (extras) => carregarConfig({ ...base, ...extras }, { lerEnv: false });

describe('configuracao', () => {
  test('JWT_EXPIRACAO so com digitos vale em segundos', () => {
    assert.equal(carregar({ JWT_EXPIRACAO: '3600' }).jwt.expiracao, 3600);
  });

  test('JWT_EXPIRACAO aceita sufixo de unidade', () => {
    assert.equal(carregar({ JWT_EXPIRACAO: '30m' }).jwt.expiracao, '30m');
    assert.equal(carregar({}).jwt.expiracao, '1h');
  });

  test('JWT_EXPIRACAO invalido impede a api de subir', () => {
    assert.throws(() => carregar({ JWT_EXPIRACAO: 'abc' }), ErroConfiguracao);
  });
});
