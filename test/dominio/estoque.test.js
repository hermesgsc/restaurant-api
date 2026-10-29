import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarMovimento } from '../../src/domain/estoque.js';
import { ErroNegocio } from '../../src/domain/erros.js';

describe('regras de movimento de estoque', () => {
  test('entrada soma ao total', () => {
    assert.deepEqual(aplicarMovimento({ total: 2, reservada: 1 }, 'ENTRADA', 3), { total: 5, reservada: 1 });
  });

  test('reserva usa o disponivel e nao o total', () => {
    assert.deepEqual(aplicarMovimento({ total: 5, reservada: 4 }, 'RESERVA', 1), { total: 5, reservada: 5 });
    assert.throws(() => aplicarMovimento({ total: 5, reservada: 4 }, 'RESERVA', 2), (e) => e instanceof ErroNegocio && e.codigo === 'ESTOQUE_INSUFICIENTE');
  });

  test('consumo baixa total e reserva juntos', () => {
    assert.deepEqual(aplicarMovimento({ total: 5, reservada: 2 }, 'CONSUMO', 2), { total: 3, reservada: 0 });
  });

  test('liberacao devolve a reserva sem mexer no total', () => {
    assert.deepEqual(aplicarMovimento({ total: 5, reservada: 2 }, 'LIBERACAO', 2), { total: 5, reservada: 0 });
  });

  test('ajuste negativo nao pode invadir o reservado', () => {
    assert.deepEqual(aplicarMovimento({ total: 5, reservada: 2 }, 'AJUSTE', -3), { total: 2, reservada: 2 });
    assert.throws(() => aplicarMovimento({ total: 5, reservada: 2 }, 'AJUSTE', -4), (e) => e.codigo === 'AJUSTE_INVALIDO');
  });

  test('quantidade zero, fracionada ou negativa fora do ajuste e rejeitada', () => {
    assert.throws(() => aplicarMovimento({ total: 1, reservada: 0 }, 'ENTRADA', 0), RangeError);
    assert.throws(() => aplicarMovimento({ total: 1, reservada: 0 }, 'ENTRADA', 1.5), RangeError);
    assert.throws(() => aplicarMovimento({ total: 1, reservada: 0 }, 'RESERVA', -1), RangeError);
  });

  test('consumo ou liberacao acima da reserva e erro de programacao', () => {
    assert.throws(() => aplicarMovimento({ total: 5, reservada: 1 }, 'CONSUMO', 2));
    assert.throws(() => aplicarMovimento({ total: 5, reservada: 1 }, 'LIBERACAO', 2));
  });
});
