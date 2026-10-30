-- pedidos, itens com preco historico, vinculo do estoque com o pedido e idempotencia.

CREATE TABLE pedidos (
  id                     INTEGER PRIMARY KEY,
  unidade_id             INTEGER NOT NULL REFERENCES unidades (id),
  cliente_id             INTEGER REFERENCES usuarios (id),
  criado_por_id          INTEGER NOT NULL REFERENCES usuarios (id),
  canal_pedido           TEXT    NOT NULL CHECK (canal_pedido IN ('APP', 'TOTEM', 'BALCAO', 'PICKUP', 'WEB')),
  status                 TEXT    NOT NULL CHECK (status IN ('AGUARDANDO_PAGAMENTO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO')),
  forma_pagamento        TEXT    NOT NULL CHECK (forma_pagamento IN ('MOCK')),
  subtotal_centavos      INTEGER NOT NULL CHECK (subtotal_centavos > 0),
  -- desconto aplicado no pedido; fica 0 ate entrar o resgate de pontos
  desconto_centavos      INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  total_centavos         INTEGER NOT NULL CHECK (total_centavos >= 0),
  reserva_estoque_status TEXT    NOT NULL CHECK (reserva_estoque_status IN ('ATIVA', 'CONSUMIDA', 'LIBERADA')),
  motivo_cancelamento    TEXT,
  expira_em              TEXT    NOT NULL,
  criado_em              TEXT    NOT NULL,
  atualizado_em          TEXT    NOT NULL,
  pago_em                TEXT,
  pronto_em              TEXT,
  entregue_em            TEXT,
  cancelado_em           TEXT,
  CHECK (total_centavos = subtotal_centavos - desconto_centavos)
);
CREATE INDEX ix_pedidos_unidade_status_canal ON pedidos (unidade_id, status, canal_pedido, id);
CREATE INDEX ix_pedidos_canal_status ON pedidos (canal_pedido, status, id);
CREATE INDEX ix_pedidos_cliente ON pedidos (cliente_id, id);
CREATE INDEX ix_pedidos_expiracao ON pedidos (status, expira_em);

-- nome e preco sao copiados do cardapio na hora do pedido, pra mudanca de
-- preco depois nao alterar pedido antigo. produto repetido no mesmo pedido
-- e rejeitado pela api e o UNIQUE garante no banco.
CREATE TABLE pedido_itens (
  id                      INTEGER PRIMARY KEY,
  pedido_id               INTEGER NOT NULL REFERENCES pedidos (id),
  produto_id              INTEGER NOT NULL REFERENCES produtos (id),
  nome_produto            TEXT    NOT NULL,
  quantidade              INTEGER NOT NULL CHECK (quantidade > 0),
  preco_unitario_centavos INTEGER NOT NULL CHECK (preco_unitario_centavos > 0),
  total_centavos          INTEGER NOT NULL CHECK (total_centavos = quantidade * preco_unitario_centavos),
  UNIQUE (pedido_id, produto_id)
);

ALTER TABLE estoque_movimentacoes ADD COLUMN pedido_id INTEGER REFERENCES pedidos (id);
CREATE INDEX ix_mov_estoque_pedido ON estoque_movimentacoes (pedido_id);
-- um pedido reserva, consome e libera cada produto no maximo uma vez
CREATE UNIQUE INDEX ux_mov_estoque_pedido_tipo ON estoque_movimentacoes (pedido_id, produto_id, tipo)
  WHERE pedido_id IS NOT NULL;

-- chave de idempotencia por usuario e operacao. guarda o hash da requisicao
-- e a resposta original pra devolver a mesma coisa num retry equivalente.
CREATE TABLE idempotencia_registros (
  id              INTEGER PRIMARY KEY,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios (id),
  operacao        TEXT    NOT NULL,
  chave           TEXT    NOT NULL,
  hash_requisicao TEXT    NOT NULL,
  estado          TEXT    NOT NULL CHECK (estado IN ('EM_PROCESSAMENTO', 'CONCLUIDO')),
  status_http     INTEGER,
  corpo_resposta  TEXT,
  criado_em       TEXT    NOT NULL,
  atualizado_em   TEXT    NOT NULL,
  UNIQUE (usuario_id, operacao, chave)
);
CREATE INDEX ix_idempotencia_criacao ON idempotencia_registros (criado_em);
