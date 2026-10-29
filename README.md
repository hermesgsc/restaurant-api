# API da rede de restaurantes

Back-end academico (MVP) para uma rede com matriz e varias unidades. Em construcao: este README sera completado nas proximas etapas.

## Pre-requisitos

- Node.js 24 (testado com 24.16.0). O banco e SQLite local, pelo modulo nativo `node:sqlite`; nao precisa instalar servidor de banco.
- npm 11 (testado com 11.13.0).

## Como rodar

```bash
npm ci
cp .env.example .env        # depois preencha JWT_SECRET (veja o comentario no arquivo)
npm run db:migrate
npm run db:seed
npm start                   # http://localhost:3000/health
npm test
```

`npm run db:reset` apaga o arquivo do banco local para recomecar do zero.

As credenciais criadas pelo seed sao apenas para demonstracao local e aparecem no terminal ao rodar `npm run db:seed`.
