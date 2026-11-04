import jwt from 'jsonwebtoken';

const EMISSOR = 'rede-restaurantes-api';

export function criarServicoTokens({ segredo, expiracao }) {
  return {
    emitir(usuario) {
      return jwt.sign({ papel: usuario.papel }, segredo, {
        algorithm: 'HS256',
        expiresIn: expiracao,
        issuer: EMISSOR,
        subject: String(usuario.id),
      });
    },
    verificar(token) {
      const dados = jwt.verify(token, segredo, { algorithms: ['HS256'], issuer: EMISSOR });
      const id = Number(dados.sub);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('subject invalido');
      return { usuarioId: id };
    },
  };
}
