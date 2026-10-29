-- estoque independente por unidade e produto.
-- disponivel = quantidade_total - quantidade_reservada (nunca negativo pelos CHECK).

CREATE TABLE estoques (
  unidade_id           INTEGER NOT NULL REFERENCES unidades (id),
  produto_id           INTEGER NOT NULL REFERENCES produtos (id),
  quantidade_total     INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_total >= 0),
  quantidade_reservada INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_reservada >= 0),
  atualizado_em        TEXT    NOT NULL,
  PRIMARY KEY (unidade_id, produto_id),
  CHECK (quantidade_reservada <= quantidade_total)
);
CREATE INDEX ix_estoques_produto ON estoques (produto_id);

-- historico de toda mudanca de saldo. quantidade e sempre positiva, menos no
-- AJUSTE, que e com sinal. os campos *_apos guardam o saldo depois do movimento.
-- o vinculo com pedido (pedido_id) entra na migracao 003, junto com a tabela pedidos.
CREATE TABLE estoque_movimentacoes (
  id                    INTEGER PRIMARY KEY,
  unidade_id            INTEGER NOT NULL,
  produto_id            INTEGER NOT NULL,
  tipo                  TEXT    NOT NULL CHECK (tipo IN ('ENTRADA', 'AJUSTE', 'RESERVA', 'CONSUMO', 'LIBERACAO')),
  quantidade            INTEGER NOT NULL CHECK (quantidade <> 0 AND (tipo = 'AJUSTE' OR quantidade > 0)),
  total_apos            INTEGER NOT NULL CHECK (total_apos >= 0),
  reservada_apos        INTEGER NOT NULL CHECK (reservada_apos >= 0),
  usuario_id            INTEGER REFERENCES usuarios (id),
  motivo                TEXT,
  criado_em             TEXT    NOT NULL,
  FOREIGN KEY (unidade_id, produto_id) REFERENCES estoques (unidade_id, produto_id)
);
CREATE INDEX ix_mov_estoque_unidade_produto ON estoque_movimentacoes (unidade_id, produto_id, id);
