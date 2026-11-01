import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { descontoDoResgate, pontosGanhos, valorDosPontos } from '../../src/domain/fidelidade.js';

describe('regra de fidelidade', () => {
  test('1 ponto por real inteiro, centavos sao descartados', () => {
    assert.equal(pontosGanhos(0), 0);
    assert.equal(pontosGanhos(99), 0);
    assert.equal(pontosGanhos(100), 1);
    assert.equal(pontosGanhos(7250), 72);
    assert.equal(pontosGanhos(7299), 72);
  });

  test('cada 10 pontos valem R$ 1,00', () => {
    assert.equal(valorDosPontos(0), 0);
    assert.equal(valorDosPontos(9), 0);
    assert.equal(valorDosPontos(10), 100);
    assert.equal(valorDosPontos(72), 700);
  });

  test('resgate precisa ser multiplo de 10 e maior que zero', () => {
    for (const pontos of [0, -10, 5, 15, 10.5]) {
      assert.throws(() => descontoDoResgate(pontos, 10000), { codigo: 'RESGATE_INVALIDO' }, String(pontos));
    }
    assert.equal(descontoDoResgate(30, 10000), 300);
  });

  test('desconto nao passa do subtotal', () => {
    assert.equal(descontoDoResgate(250, 2590), 2500);
    assert.throws(() => descontoDoResgate(260, 2590), (e) => e.codigo === 'RESGATE_ACIMA_DO_SUBTOTAL' && /250 pontos/.test(e.detalhes[0].issue));
    assert.equal(descontoDoResgate(100, 1000), 1000);
  });
});
