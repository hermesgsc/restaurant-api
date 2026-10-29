-- usuarios, unidades, catalogo, cardapio por unidade e auditoria.
-- datas em texto iso 8601 utc; dinheiro em centavos inteiros.

CREATE TABLE unidades (
  id            INTEGER PRIMARY KEY,
  nome          TEXT    NOT NULL UNIQUE,
  cidade        TEXT    NOT NULL,
  ativa         INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),
  criado_em     TEXT    NOT NULL,
  atualizado_em TEXT    NOT NULL
);

CREATE TABLE usuarios (
  id             INTEGER PRIMARY KEY,
  nome           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash     TEXT    NOT NULL,
  papel          TEXT    NOT NULL CHECK (papel IN ('ADMIN', 'GERENTE', 'ATENDENTE', 'COZINHA', 'CLIENTE')),
  ativo          INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  anonimizado_em TEXT,
  criado_em      TEXT    NOT NULL,
  atualizado_em  TEXT    NOT NULL
);

-- escopo dos funcionarios; admin nao precisa de vinculo porque atua na rede toda
CREATE TABLE usuario_unidades (
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id),
  unidade_id INTEGER NOT NULL REFERENCES unidades (id),
  PRIMARY KEY (usuario_id, unidade_id)
);
CREATE INDEX ix_usuario_unidades_unidade ON usuario_unidades (unidade_id);

CREATE TABLE produtos (
  id            INTEGER PRIMARY KEY,
  nome          TEXT    NOT NULL UNIQUE,
  descricao     TEXT,
  categoria     TEXT    NOT NULL,
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em     TEXT    NOT NULL,
  atualizado_em TEXT    NOT NULL
);

CREATE TABLE cardapio_itens (
  id             INTEGER PRIMARY KEY,
  unidade_id     INTEGER NOT NULL REFERENCES unidades (id),
  produto_id     INTEGER NOT NULL REFERENCES produtos (id),
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos > 0),
  disponivel     INTEGER NOT NULL DEFAULT 1 CHECK (disponivel IN (0, 1)),
  criado_em      TEXT    NOT NULL,
  atualizado_em  TEXT    NOT NULL,
  UNIQUE (unidade_id, produto_id)
);

-- trilha de auditoria: sem senha, token, e-mail ou nome do titular
CREATE TABLE auditorias (
  id           INTEGER PRIMARY KEY,
  ator_id      INTEGER REFERENCES usuarios (id),
  ator_papel   TEXT,
  acao         TEXT    NOT NULL,
  recurso_tipo TEXT    NOT NULL,
  recurso_id   TEXT,
  unidade_id   INTEGER REFERENCES unidades (id),
  resultado    TEXT    NOT NULL CHECK (resultado IN ('SUCESSO', 'NEGADO', 'FALHA')),
  request_id   TEXT    NOT NULL,
  detalhes     TEXT,
  criado_em    TEXT    NOT NULL
);
CREATE INDEX ix_auditorias_unidade ON auditorias (unidade_id, criado_em);
CREATE INDEX ix_auditorias_acao ON auditorias (acao, criado_em);
CREATE INDEX ix_auditorias_recurso ON auditorias (recurso_tipo, recurso_id);
CREATE INDEX ix_auditorias_request ON auditorias (request_id);
