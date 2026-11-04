import bcrypt from 'bcryptjs';

export function criarServicoSenhas(custo) {
  const hashFalso = bcrypt.hashSync('senha-que-nunca-sera-usada', custo);
  return {
    gerarHash: (senha) => bcrypt.hash(senha, custo),
    conferir: (senha, hash) => bcrypt.compare(senha, hash ?? hashFalso),
  };
}
