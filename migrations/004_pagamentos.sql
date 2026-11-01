-- pagamentos e tentativas de comunicacao com o gateway (aqui so o mock).
-- nenhum dado de cartao ou credencial financeira e guardado.

CREATE TABLE pagamentos (
  id                 INTEGER PRIMARY KEY,
  pedido_id          INTEGER NOT NULL REFERENCES pedidos (id),
  forma              TEXT    NOT NULL CHECK (forma IN ('MOCK')),
  valor_centavos     INTEGER NOT NULL CHECK (valor_centavos >= 0),
  -- PROCESSANDO: enviado ao gateway, sem resposta ainda
  -- INDEFINIDO: o gateway nao respondeu no prazo (timeout); nao e aprovacao nem recusa
  -- APROVADO_TARDIO: aprovado depois que o pedido ja tinha sido cancelado ou expirado
  status             TEXT    NOT NULL CHECK (status IN ('PROCESSANDO', 'APROVADO', 'RECUSADO', 'INDEFINIDO', 'APROVADO_TARDIO')),
  motivo_recusa      TEXT,
  referencia_gateway TEXT    NOT NULL UNIQUE,
  codigo_autorizacao TEXT,
  reconciliacao      TEXT    CHECK (reconciliacao IN ('ESTORNO_MANUAL_PENDENTE')),
  idempotencia_id    INTEGER REFERENCES idempotencia_registros (id),
  solicitado_por_id  INTEGER NOT NULL REFERENCES usuarios (id),
  criado_em          TEXT    NOT NULL,
  atualizado_em      TEXT    NOT NULL,
  finalizado_em      TEXT,
  CHECK (status <> 'RECUSADO' OR motivo_recusa IS NOT NULL),
  CHECK ((status = 'APROVADO_TARDIO') = (reconciliacao IS NOT NULL))
);
CREATE INDEX ix_pagamentos_pedido ON pagamentos (pedido_id);
CREATE INDEX ix_pagamentos_status ON pagamentos (status, atualizado_em);
-- no maximo um pagamento vivo por pedido: impede cobrar duas vezes
CREATE UNIQUE INDEX ux_pagamento_vivo_por_pedido ON pagamentos (pedido_id)
  WHERE status IN ('PROCESSANDO', 'INDEFINIDO', 'APROVADO');

CREATE TABLE pagamento_tentativas (
  id                 INTEGER PRIMARY KEY,
  pagamento_id       INTEGER NOT NULL REFERENCES pagamentos (id),
  operacao           TEXT    NOT NULL CHECK (operacao IN ('AUTORIZACAO', 'CONSULTA')),
  payload_requisicao TEXT    NOT NULL,
  payload_resposta   TEXT,
  resultado          TEXT    CHECK (resultado IN ('APROVADO', 'RECUSADO', 'TIMEOUT', 'ERRO')),
  iniciado_em        TEXT    NOT NULL,
  finalizado_em      TEXT
);
CREATE INDEX ix_tentativas_pagamento ON pagamento_tentativas (pagamento_id, id);
