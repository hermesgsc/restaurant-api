import * as z from 'zod';
import { erros } from '../domain/erros.js';

export { z };

export const LIMITE_MAXIMO_PAGINA = 100;

function caminho(path) {
  return path.reduce((acc, parte) => (typeof parte === 'number' ? `${acc}[${parte}]` : acc ? `${acc}.${parte}` : String(parte)), '');
}

// traduz as issues do zod pro formato {field, issue} do envelope de erro
function descrever(issue) {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'Campo obrigatorio.' : `Tipo invalido: esperado ${issue.expected}.`;
    case 'invalid_value':
      return `Valor invalido. Aceitos: ${issue.values.join(', ')}.`;
    case 'too_small':
      if (issue.origin === 'array') return `Informe pelo menos ${issue.minimum} item(ns).`;
      if (issue.origin === 'string') return `Minimo de ${issue.minimum} caractere(s).`;
      return `Deve ser maior${issue.inclusive ? ' ou igual' : ''} a ${issue.minimum}.`;
    case 'too_big':
      if (issue.origin === 'array') return `Maximo de ${issue.maximum} item(ns).`;
      if (issue.origin === 'string') return `Maximo de ${issue.maximum} caractere(s).`;
      return `Deve ser menor${issue.inclusive ? ' ou igual' : ''} a ${issue.maximum}.`;
    case 'invalid_format':
      return issue.format === 'email' ? 'E-mail invalido.' : 'Formato invalido.';
    case 'not_multiple_of':
      return `Deve ser multiplo de ${issue.divisor}.`;
    case 'unrecognized_keys':
      return `Campo nao permitido: ${issue.keys.join(', ')}.`;
    default:
      return issue.message || 'Valor invalido.';
  }
}

export function validar(schema, dados, origem = 'body') {
  const resultado = schema.safeParse(dados ?? {});
  if (resultado.success) return resultado.data;
  const detalhes = [];
  for (const issue of resultado.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const chave of issue.keys) detalhes.push({ field: caminho([...issue.path, chave]), issue: 'Campo nao permitido.' });
    } else {
      detalhes.push({ field: caminho(issue.path) || origem, issue: descrever(issue) });
    }
  }
  throw erros.validacao('VALIDACAO', 'Dados de entrada invalidos.', detalhes);
}

// query string chega como texto, por isso o coerce
export const idParam = z.coerce.number().int().positive();

export const esquemaId = z.strictObject({ id: idParam });

export const paginacao = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO_PAGINA).default(20),
};

export const booleanoQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
