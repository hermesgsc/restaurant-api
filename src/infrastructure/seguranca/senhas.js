import bcrypt from 'bcryptjs';

export function criarServicoSenhas(custo) {
  // hash usado quando o e-mail nao existe, pra o login demorar o mesmo tanto
  // e nao entregar quais e-mails estao cadastrados. tem que ter o mesmo custo
  // dos hashes reais, senao o e-mail inexistente responde mais rapido
  const hashFalso = bcrypt.hashSync('senha-que-nunca-sera-usada', custo);
  return {
    gerarHash: (senha) => bcrypt.hash(senha, custo),
    conferir: (senha, hash) => bcrypt.compare(senha, hash ?? hashFalso),
  };
}
