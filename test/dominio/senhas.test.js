import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { criarServicoSenhas } from '../../src/infrastructure/seguranca/senhas.js';

describe('senhas', () => {
  test('e-mail inexistente confere contra um hash do mesmo custo dos reais', async () => {
    const custo = 6;
    const senhas = criarServicoSenhas(custo);
    const chamadas = [];
    const original = bcrypt.compare;
    bcrypt.compare = (senha, hash) => { chamadas.push(hash); return original(senha, hash); };
    try {
      assert.equal(await senhas.conferir('qualquer', undefined), false);
    } finally {
      bcrypt.compare = original;
    }
    assert.equal(bcrypt.getRounds(chamadas[0]), custo);
  });
});
