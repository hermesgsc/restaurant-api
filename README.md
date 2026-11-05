# API da rede de restaurantes

Projeto acadêmico da disciplina Projeto Back-End, do curso de Análise e Desenvolvimento de Sistemas do Centro Universitário Internacional UNINTER.

Autor: Hermes Gabriel Santos Crispim (RU 4307859).

## Tecnologias

Node.js 24, Express 5, SQLite (módulo nativo `node:sqlite`), zod, JWT, bcryptjs, Swagger/OpenAPI e Postman/newman.

## Como rodar

Pré-requisitos: Node.js 24 e npm 11. Não é preciso instalar servidor de banco.

```bash
npm ci
cp .env.example .env        # preencha JWT_SECRET
npm run db:migrate
npm run db:seed
npm start                   # documentação em http://localhost:3000/docs
```

Testes:

```bash
npm test
npm run postman:executar
```

Os usuários de demonstração criados pelo seed aparecem no terminal ao rodar `npm run db:seed`. Para recomeçar do zero, use `npm run db:reset`.

## Documentação

O relatório do projeto está em [`docs/relatorio/4307859_Projeto_Back_End.pdf`](docs/relatorio/4307859_Projeto_Back_End.pdf). Os diagramas ficam em [`docs/diagramas/`](docs/diagramas/) e a coleção do Postman em [`postman/`](postman/).
