import { erros } from '../../domain/erros.js';

// le o bearer, confere assinatura e validade e recarrega o usuario do banco.
// papel e unidades vem sempre do banco, nunca do token nem do corpo.
// no modo opcional a falta de token passa, mas token invalido continua 401.
export function autenticar({ tokens, usuarios }, { opcional = false } = {}) {
  return (req, _res, next) => {
    const cabecalho = req.get('authorization');
    if (!cabecalho && opcional) return next();
    const [esquema, token] = (cabecalho || '').split(' ');
    if (esquema !== 'Bearer' || !token) return next(erros.naoAutenticado('Token de acesso ausente.'));
    let usuarioId;
    try {
      ({ usuarioId } = tokens.verificar(token));
    } catch {
      return next(erros.naoAutenticado('Token de acesso invalido ou expirado.'));
    }
    const ator = usuarios.carregarAtor(usuarioId);
    if (!ator) return next(erros.naoAutenticado('Token de acesso invalido ou expirado.'));
    req.ator = ator;
    return next();
  };
}

export function exigirPapeis(...papeis) {
  return (req, _res, next) => {
    if (!req.ator) return next(erros.naoAutenticado());
    if (!papeis.includes(req.ator.papel)) return next(erros.proibido());
    return next();
  };
}
