import fs from 'node:fs';
import path from 'node:path';
import { especificacaoOpenApi } from '../src/api/openapi.js';

// grava a especificacao em docs/openapi.json pra quem quiser importar no
// postman ou abrir num editor sem subir a api
const destino = path.resolve(import.meta.dirname, '..', 'docs', 'openapi.json');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, `${JSON.stringify(especificacaoOpenApi(), null, 2)}\n`);
console.log(`Especificacao OpenAPI gravada em docs/openapi.json (${Object.keys(especificacaoOpenApi().paths).length} caminhos).`);
