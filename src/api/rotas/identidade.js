import { Router } from 'express';
import { validar, z } from '../validacao.js';

const esquemaCadastro = z.strictObject({
  nome: z.string().trim().min(2).max(100),
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  senha: z.string().min(8).max(72),
});

const esquemaLogin = z.strictObject({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  senha: z.string().min(1).max(72),
});

export function rotasIdentidade({ servicos, autenticar }) {
  const r = Router();

  r.post('/usuarios', async (req, res) => {
    const dados = validar(esquemaCadastro, req.body);
    const usuario = await servicos.usuarios.cadastrarCliente(dados, req.requestId);
    res.status(201).location(`/usuarios/${usuario.id}`).json(usuario);
  });

  r.post('/auth/login', async (req, res) => {
    const dados = validar(esquemaLogin, req.body);
    res.json(await servicos.usuarios.login(dados, { ip: req.ip, requestId: req.requestId }));
  });

  r.get('/usuarios/me', autenticar, (req, res) => {
    res.json(servicos.usuarios.perfil(req.ator));
  });

  return r;
}
