import { agora, transacao } from './banco.js';

// credenciais de demonstracao local. nao sao segredos e nunca devem ir pra producao
export const SENHA_DEMO = 'Demo@12345';

export const USUARIOS_DEMO = [
  { nome: 'Admin Demo', email: 'admin@demo.local', papel: 'ADMIN', unidades: [] },
  { nome: 'Gerente Centro Demo', email: 'gerente.centro@demo.local', papel: 'GERENTE', unidades: ['Unidade Centro'] },
  { nome: 'Gerente Shopping Demo', email: 'gerente.shopping@demo.local', papel: 'GERENTE', unidades: ['Unidade Shopping'] },
  { nome: 'Atendente Centro Demo', email: 'atendente.centro@demo.local', papel: 'ATENDENTE', unidades: ['Unidade Centro'] },
  { nome: 'Cozinha Centro Demo', email: 'cozinha.centro@demo.local', papel: 'COZINHA', unidades: ['Unidade Centro'] },
  { nome: 'Cozinha Shopping Demo', email: 'cozinha.shopping@demo.local', papel: 'COZINHA', unidades: ['Unidade Shopping'] },
  { nome: 'Cliente Ana Demo', email: 'cliente.ana@demo.local', papel: 'CLIENTE', unidades: [] },
  { nome: 'Cliente Bruno Demo', email: 'cliente.bruno@demo.local', papel: 'CLIENTE', unidades: [] },
];

const UNIDADES = [
  { nome: 'Unidade Centro', cidade: 'Curitiba', ativa: 1 },
  { nome: 'Unidade Shopping', cidade: 'Curitiba', ativa: 1 },
  { nome: 'Unidade Desativada', cidade: 'Londrina', ativa: 0 },
];

const PRODUTOS = [
  { nome: 'X-Burger', categoria: 'LANCHE', descricao: 'Pao, hamburguer 150g e queijo.' },
  { nome: 'X-Salada', categoria: 'LANCHE', descricao: 'X-Burger com alface e tomate.' },
  { nome: 'Batata Frita', categoria: 'ACOMPANHAMENTO', descricao: 'Porcao media.' },
  { nome: 'Refrigerante Lata', categoria: 'BEBIDA', descricao: 'Lata 350 ml.' },
  { nome: 'Suco Natural', categoria: 'BEBIDA', descricao: 'Copo 400 ml.' },
  { nome: 'Combo Classico', categoria: 'COMBO', descricao: 'X-Burger, batata e refrigerante.' },
  { nome: 'Milkshake', categoria: 'SOBREMESA', descricao: 'Produto descontinuado (inativo).', ativo: 0 },
];

// precos e estoque diferentes de proposito pra mostrar que cada unidade e independente.
// "Suco Natural" so existe na Shopping; "Combo Classico" esta no cardapio do centro mas indisponivel.
export const CARDAPIOS = {
  'Unidade Centro': [
    ['X-Burger', 2590, 1], ['X-Salada', 2790, 1], ['Batata Frita', 1290, 1],
    ['Refrigerante Lata', 690, 1], ['Combo Classico', 3990, 0], ['Milkshake', 1590, 1],
  ],
  'Unidade Shopping': [
    ['X-Burger', 2790, 1], ['X-Salada', 2990, 1], ['Batata Frita', 1390, 1],
    ['Refrigerante Lata', 790, 1], ['Suco Natural', 1190, 1], ['Combo Classico', 4290, 1],
  ],
  'Unidade Desativada': [['X-Burger', 2490, 1]],
};

// estoque diferente por unidade. a Batata Frita do centro tem so 1 unidade,
// usada pra demonstrar disputa pelo ultimo item. o Refrigerante da shopping
// fica sem saldo nenhum pra mostrar estoque insuficiente.
export const ESTOQUE_INICIAL = {
  'Unidade Centro': [
    ['X-Burger', 50], ['X-Salada', 30], ['Batata Frita', 1], ['Refrigerante Lata', 100], ['Combo Classico', 10], ['Milkshake', 5],
  ],
  'Unidade Shopping': [
    ['X-Burger', 20], ['X-Salada', 10], ['Batata Frita', 40], ['Suco Natural', 15], ['Combo Classico', 25],
  ],
};

// popula um banco vazio; recusa rodar se ja tiver usuario pra nao duplicar nada
export async function popular(db, servicos) {
  if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n > 0) {
    throw new Error('O banco ja tem dados. Rode "npm run db:reset" para recriar do zero.');
  }
  const hash = await servicos.senhas.gerarHash(SENHA_DEMO);
  const instante = agora();
  return transacao(db, () => {
    const unidadeId = {};
    for (const u of UNIDADES) {
      unidadeId[u.nome] = Number(db.prepare('INSERT INTO unidades (nome, cidade, ativa, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)')
        .run(u.nome, u.cidade, u.ativa, instante, instante).lastInsertRowid);
    }
    const produtoId = {};
    for (const p of PRODUTOS) {
      produtoId[p.nome] = Number(db.prepare('INSERT INTO produtos (nome, descricao, categoria, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)')
        .run(p.nome, p.descricao, p.categoria, p.ativo ?? 1, instante, instante).lastInsertRowid);
    }
    for (const [unidade, itens] of Object.entries(CARDAPIOS)) {
      for (const [produto, preco, disponivel] of itens) {
        db.prepare(`INSERT INTO cardapio_itens (unidade_id, produto_id, preco_centavos, disponivel, criado_em, atualizado_em)
          VALUES (?, ?, ?, ?, ?, ?)`).run(unidadeId[unidade], produtoId[produto], preco, disponivel, instante, instante);
      }
    }
    const usuarioId = {};
    for (const u of USUARIOS_DEMO) {
      const id = Number(db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, papel, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?)`).run(u.nome, u.email, hash, u.papel, instante, instante).lastInsertRowid);
      usuarioId[u.email] = id;
      for (const unidade of u.unidades) {
        db.prepare('INSERT INTO usuario_unidades (usuario_id, unidade_id) VALUES (?, ?)').run(id, unidadeId[unidade]);
      }
    }
    const adminId = usuarioId['admin@demo.local'];
    for (const [unidade, itens] of Object.entries(ESTOQUE_INICIAL)) {
      for (const [produto, quantidade] of itens) {
        servicos.estoque.movimentar({
          unidadeId: unidadeId[unidade], produtoId: produtoId[produto], tipo: 'ENTRADA', quantidade, usuarioId: adminId, motivo: 'Carga inicial do seed',
        });
      }
    }
    return { unidadeId, produtoId, usuarioId };
  });
}
