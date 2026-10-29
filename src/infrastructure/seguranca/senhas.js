import bcrypt from 'bcryptjs';

// hash fixo usado quando o e-mail nao existe, pra o login demorar o mesmo tanto
// e nao entregar quais e-mails estao cadastrados
const HASH_FALSO = bcrypt.hashSync('senha-que-nunca-sera-usada', 10);

export function criarServicoSenhas(custo) {
  return {
    gerarHash: (senha) => bcrypt.hash(senha, custo),
    conferir: (senha, hash) => bcrypt.compare(senha, hash ?? HASH_FALSO),
  };
}
