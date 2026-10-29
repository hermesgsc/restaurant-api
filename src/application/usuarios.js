import { agora, transacao } from '../infrastructure/banco.js';
import { erros, ErroNegocio, TipoErro } from '../domain/erros.js';
import { Papel } from '../domain/papeis.js';

export function paraUsuarioPublico(linha, unidadeIds = []) {
  return {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    papel: linha.papel,
    unidadeIds,
    ativo: linha.ativo === 1,
    criadoEm: linha.criado_em,
  };
}

export function criarServicoUsuarios({ db, senhas, tokens, limitador, auditoria }) {
  const buscarPorId = db.prepare('SELECT * FROM usuarios WHERE id = ?');
  const buscarPorEmail = db.prepare('SELECT * FROM usuarios WHERE email = ?');
  const unidadesDoUsuario = db.prepare('SELECT unidade_id FROM usuario_unidades WHERE usuario_id = ? ORDER BY unidade_id');

  function unidadeIds(usuarioId) {
    return unidadesDoUsuario.all(usuarioId).map((l) => l.unidade_id);
  }

  function carregarAtor(usuarioId) {
    const linha = buscarPorId.get(usuarioId);
    if (!linha || linha.ativo !== 1) return null;
    return { id: linha.id, papel: linha.papel, unidadeIds: unidadeIds(linha.id) };
  }

  // cadastro publico: o papel e sempre CLIENTE, o schema da rota ja barra
  // campos como papel ou unidadeIds e aqui o valor e fixo de novo por garantia
  async function cadastrarCliente({ nome, email, senha }, requestId) {
    const hash = await senhas.gerarHash(senha);
    const instante = agora();
    let id;
    try {
      id = transacao(db, () => {
        const r = db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, papel, criado_em, atualizado_em)
          VALUES (?, ?, ?, ?, ?, ?)`).run(nome, email, hash, Papel.CLIENTE, instante, instante);
        const novoId = Number(r.lastInsertRowid);
        auditoria.registrar({ ator: { id: novoId, papel: Papel.CLIENTE }, acao: 'USUARIO_CADASTRADO', recursoTipo: 'USUARIO', recursoId: novoId, requestId });
        return novoId;
      });
    } catch (erro) {
      if (String(erro.message).includes('UNIQUE constraint failed: usuarios.email')) {
        throw erros.conflito('EMAIL_JA_CADASTRADO', 'Ja existe uma conta com este e-mail.', [{ field: 'email', issue: 'E-mail ja cadastrado.' }]);
      }
      throw erro;
    }
    return paraUsuarioPublico(buscarPorId.get(id));
  }

  async function login({ email, senha }, { ip, requestId }) {
    const chave = `${ip}|${email.toLowerCase()}`;
    const espera = limitador.segundosBloqueado(chave);
    if (espera > 0) {
      const erro = new ErroNegocio(TipoErro.LIMITE_EXCEDIDO, 'MUITAS_TENTATIVAS', 'Muitas tentativas de login. Tente novamente mais tarde.');
      erro.segundosEspera = espera;
      throw erro;
    }
    const linha = buscarPorEmail.get(email);
    const confere = await senhas.conferir(senha, linha?.senha_hash);
    if (!linha || !confere || linha.ativo !== 1) {
      limitador.registrarFalha(chave);
      auditoria.registrar({ ator: null, acao: 'LOGIN_FALHOU', recursoTipo: 'SESSAO', resultado: 'NEGADO', requestId });
      // mensagem generica de proposito, nao diz se o e-mail existe
      throw erros.naoAutenticado('Credenciais invalidas.');
    }
    limitador.registrarSucesso(chave);
    auditoria.registrar({ ator: linha, acao: 'LOGIN', recursoTipo: 'SESSAO', recursoId: linha.id, requestId });
    return {
      accessToken: tokens.emitir(linha),
      tokenType: 'Bearer',
      usuario: paraUsuarioPublico(linha, unidadeIds(linha.id)),
    };
  }

  function perfil(ator) {
    return paraUsuarioPublico(buscarPorId.get(ator.id), ator.unidadeIds);
  }

  return { carregarAtor, cadastrarCliente, login, perfil, buscarPorId: (id) => buscarPorId.get(id) };
}
