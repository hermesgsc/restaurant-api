# Evidência: execução da coleção Postman com newman

Gerado por `npm run postman:executar -- --evidencia` em 2026-10-28T17:40:43.434Z, com a API num banco SQLite temporário com seed.

| Item | Total | Falhas |
|---|---:|---:|
| Requisições da coleção | 87 | - |
| Requisições HTTP enviadas (inclui 5 de pre-request) | 92 | 0 |
| Asserções | 359 | 0 |

Duração total: 13372 ms.

| Pasta / requisição | Método | Status | Asserções |
|---|---|---:|---|
| Auth / Health | GET | 200 | 4/4 ok |
| Auth / Cadastrar cliente | POST | 201 | 4/4 ok |
| Auth / Cadastro com e-mail repetido (409) | POST | 409 | 4/4 ok |
| Auth / Cadastro com e-mail invalido e senha curta (422) | POST | 422 | 5/5 ok |
| Auth / Login do cliente | POST | 200 | 3/3 ok |
| Auth / Login admin | POST | 200 | 4/4 ok |
| Auth / Login gerente centro | POST | 200 | 4/4 ok |
| Auth / Login gerente shopping | POST | 200 | 4/4 ok |
| Auth / Login atendente centro | POST | 200 | 4/4 ok |
| Auth / Login cozinha centro | POST | 200 | 4/4 ok |
| Auth / Login de outro cliente (seed) | POST | 200 | 4/4 ok |
| Auth / Login com senha errada (401) | POST | 401 | 5/5 ok |
| Auth / Meu perfil | GET | 200 | 4/4 ok |
| Units/Menu / Listar unidades (publico) | GET | 200 | 4/4 ok |
| Units/Menu / Cardapio da Unidade Centro | GET | 200 | 5/5 ok |
| Units/Menu / Cardapio da Unidade Shopping (preco diferente) | GET | 200 | 4/4 ok |
| Units/Menu / Listar produtos | GET | 200 | 4/4 ok |
| Units/Menu / Criar unidade (admin) | POST | 201 | 4/4 ok |
| Units/Menu / Alterar unidade (admin) | PATCH | 200 | 4/4 ok |
| Units/Menu / Gerente nao desativa unidade (403) | PATCH | 403 | 4/4 ok |
| Units/Menu / Criar produto (admin) | POST | 201 | 3/3 ok |
| Units/Menu / Alterar produto (admin) | PATCH | 200 | 3/3 ok |
| Units/Menu / Colocar produto no cardapio da unidade nova | PUT | 200 | 4/4 ok |
| Units/Menu / Cliente nao cria produto (403) | POST | 403 | 4/4 ok |
| Stock / Saldo de estoque da Unidade Centro | GET | 200 | 4/4 ok |
| Stock / Entrada de estoque (gerente) | POST | 201 | 4/4 ok |
| Stock / Ajuste sem motivo (422) | POST | 422 | 5/5 ok |
| Stock / Historico de movimentacoes | GET | 200 | 4/4 ok |
| Stock / Gerente de outra unidade nao ve o estoque (403) | GET | 403 | 4/4 ok |
| Orders / Criar pedido pelo APP | POST | 201 | 5/5 ok |
| Orders / Repetir criacao com a mesma Idempotency-Key | POST | 201 | 5/5 ok |
| Orders / Mesma chave com outro corpo (409) | POST | 409 | 4/4 ok |
| Orders / Cliente tenta mandar o preco (422) | POST | 422 | 4/4 ok |
| Orders / Pedido sem canalPedido (422) | POST | 422 | 5/5 ok |
| Orders / Canal fora da lista (422) | POST | 422 | 5/5 ok |
| Orders / Quantidade fracionada (422) | POST | 422 | 5/5 ok |
| Orders / Produto inexistente (404) | POST | 404 | 4/4 ok |
| Orders / Unidade inexistente (404) | POST | 404 | 4/4 ok |
| Orders / Estoque insuficiente (409) | POST | 409 | 5/5 ok |
| Orders / Detalhar pedido | GET | 200 | 4/4 ok |
| Orders / Listar pedidos com filtros | GET | 200 | 4/4 ok |
| Orders / Atendente cria pedido de balcao | POST | 201 | 4/4 ok |
| Orders / Atendente filtra pedidos por canal BALCAO | GET | 200 | 6/6 ok |
| Orders / Cancelar pedido de balcao | POST | 200 | 4/4 ok |
| Orders / Cancelar de novo (409) | POST | 409 | 4/4 ok |
| Payment / Pagar pedido (aprovado) | POST | 201 | 5/5 ok |
| Payment / Repetir pagamento com a mesma chave | POST | 201 | 4/4 ok |
| Payment / Pagar de novo com outra chave (409) | POST | 409 | 4/4 ok |
| Payment / Consultar pagamento | GET | 200 | 4/4 ok |
| Payment / Pagamentos do pedido | GET | 200 | 4/4 ok |
| Payment / Criar pedido para recusa | POST | 201 | 3/3 ok |
| Payment / Pagar pedido (recusado) | POST | 201 | 4/4 ok |
| Payment / Criar pedido para timeout | POST | 201 | 3/3 ok |
| Payment / Pagar pedido (timeout do gateway) | POST | 202 | 4/4 ok |
| Payment / Retry do timeout com a mesma chave (202) | POST | 202 | 4/4 ok |
| Payment / Nova cobranca com pagamento indefinido (409) | POST | 409 | 4/4 ok |
| Payment / Cenario de mock invalido (422) | POST | 422 | 4/4 ok |
| Loyalty / Saldo sem consentimento | GET | 200 | 4/4 ok |
| Loyalty / Conceder consentimento | PUT | 200 | 4/4 ok |
| Loyalty / Cozinha marca PRONTO | PATCH | 200 | 4/4 ok |
| Loyalty / Cozinha nao entrega (403) | PATCH | 403 | 4/4 ok |
| Loyalty / Atendente marca ENTREGUE | PATCH | 200 | 4/4 ok |
| Loyalty / Saldo depois da entrega | GET | 200 | 4/4 ok |
| Loyalty / Entregar de novo (409, sem credito duplicado) | PATCH | 409 | 4/4 ok |
| Loyalty / Historico de pontos | GET | 200 | 4/4 ok |
| Loyalty / Resgate fora do multiplo de 10 (422) | POST | 422 | 4/4 ok |
| Loyalty / Pedido com resgate de 50 pontos | POST | 201 | 4/4 ok |
| Loyalty / Saldo com pontos reservados | GET | 200 | 4/4 ok |
| Loyalty / Cancelar pedido com resgate | POST | 200 | 4/4 ok |
| Loyalty / Saldo depois do cancelamento | GET | 200 | 4/4 ok |
| Loyalty / Revogar consentimento | DELETE | 200 | 4/4 ok |
| Loyalty / Resgate sem consentimento (409) | POST | 409 | 4/4 ok |
| Loyalty / Funcionario nao participa (403) | GET | 403 | 4/4 ok |
| Errors/Audit / Sem token (401) | GET | 401 | 4/4 ok |
| Errors/Audit / Token invalido (401) | GET | 401 | 4/4 ok |
| Errors/Audit / JSON malformado (400) | POST | 400 | 4/4 ok |
| Errors/Audit / Rota inexistente (404) | GET | 404 | 4/4 ok |
| Errors/Audit / Pedido inexistente (404) | GET | 404 | 4/4 ok |
| Errors/Audit / Pedido sem Idempotency-Key (422) | POST | 422 | 5/5 ok |
| Errors/Audit / Limit acima de 100 (422) | GET | 422 | 4/4 ok |
| Errors/Audit / Outro cliente nao ve o pedido (403) | GET | 403 | 4/4 ok |
| Errors/Audit / Gerente de outra unidade nao ve o pedido (403) | GET | 403 | 4/4 ok |
| Errors/Audit / Cliente nao acessa auditoria (403) | GET | 403 | 4/4 ok |
| Errors/Audit / Muitas tentativas de login (429) | POST | 429 | 5/5 ok |
| Errors/Audit / Auditoria do pagamento aprovado | GET | 200 | 4/4 ok |
| Errors/Audit / Auditoria do pedido (gerente da unidade) | GET | 200 | 5/5 ok |
| Errors/Audit / Auditoria de logins que falharam | GET | 200 | 4/4 ok |
