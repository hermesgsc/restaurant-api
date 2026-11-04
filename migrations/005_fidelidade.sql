CREATE TABLE consentimentos (
  id           INTEGER PRIMARY KEY,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios (id),
  finalidade   TEXT    NOT NULL CHECK (finalidade IN ('PROGRAMA_FIDELIDADE')),
  versao_termo TEXT    NOT NULL,
  acao         TEXT    NOT NULL CHECK (acao IN ('CONCEDIDO', 'REVOGADO')),
  origem       TEXT    NOT NULL CHECK (origem IN ('TITULAR', 'ANONIMIZACAO')),
  request_id   TEXT,
  criado_em    TEXT    NOT NULL
);
CREATE INDEX ix_consentimentos_usuario ON consentimentos (usuario_id, finalidade, id);

CREATE TRIGGER tr_consentimentos_sem_update BEFORE UPDATE ON consentimentos
BEGIN
  SELECT RAISE(ABORT, 'consentimentos e somente insercao');
END;

CREATE TRIGGER tr_consentimentos_sem_delete BEFORE DELETE ON consentimentos
BEGIN
  SELECT RAISE(ABORT, 'consentimentos e somente insercao');
END;

CREATE TABLE fidelidade_contas (
  usuario_id    INTEGER PRIMARY KEY REFERENCES usuarios (id),
  saldo_pontos  INTEGER NOT NULL DEFAULT 0 CHECK (saldo_pontos >= 0),
  criado_em     TEXT    NOT NULL,
  atualizado_em TEXT    NOT NULL
);

CREATE TABLE fidelidade_lancamentos (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios (id),
  pedido_id   INTEGER REFERENCES pedidos (id),
  tipo        TEXT    NOT NULL CHECK (tipo IN ('CREDITO', 'RESGATE', 'ESTORNO_RESGATE', 'BAIXA_ANONIMIZACAO')),
  pontos      INTEGER NOT NULL CHECK (pontos <> 0),
  saldo_apos  INTEGER NOT NULL CHECK (saldo_apos >= 0),
  descricao   TEXT    NOT NULL,
  criado_em   TEXT    NOT NULL
);
CREATE INDEX ix_lancamentos_usuario ON fidelidade_lancamentos (usuario_id, id);
CREATE UNIQUE INDEX ux_lancamento_pedido_tipo ON fidelidade_lancamentos (pedido_id, tipo)
  WHERE pedido_id IS NOT NULL;

ALTER TABLE pedidos ADD COLUMN pontos_resgatados INTEGER NOT NULL DEFAULT 0
  CHECK (pontos_resgatados >= 0 AND pontos_resgatados % 10 = 0);
ALTER TABLE pedidos ADD COLUMN resgate_status TEXT
  CHECK (resgate_status IN ('RESERVADO', 'CONFIRMADO', 'LIBERADO'));
