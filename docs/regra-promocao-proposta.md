# Regra de promoção: proposta (não implementada)

> **Status: proposta.** Nada deste documento existe no código, no banco ou na API. Ele descreve como a promoção poderia entrar numa versão futura, sem quebrar as regras que já estão implementadas.

## Objetivo

Permitir que a matriz ou o gerente de uma unidade crie campanhas de desconto por período e por canal. Exemplo: "10% de desconto no X-Burger pelo APP, de segunda a quinta, na Unidade Centro".

## Proposta de regra

| Item | Proposta |
|---|---|
| Quem cria | ADMIN (para a rede toda ou para uma unidade) e GERENTE (só para as unidades dele) |
| Escopo | Uma unidade ou todas; uma lista de canais (`APP`, `TOTEM`, `BALCAO`, `PICKUP`, `WEB`); um produto ou o pedido inteiro |
| Tipo de desconto | Percentual (1 a 50%) ou valor fixo em centavos |
| Vigência | `inicio` e `fim` em UTC; fora da vigência a promoção não é aplicada |
| Acúmulo | Uma promoção por item, no máximo. Se mais de uma servir, vale a de maior desconto |
| Com fidelidade | A promoção é aplicada primeiro, sobre o subtotal. O resgate de pontos vem depois, limitado ao subtotal já com a promoção |
| Pontos | O crédito continua sendo sobre o valor efetivamente pago (`total_centavos`), na entrega |
| Arredondamento | Desconto percentual arredondado para baixo, em centavos inteiros |
| Histórico | O pedido guarda o id da promoção e o desconto aplicado em cada item, como já acontece com o preço histórico |

## Como entraria no sistema atual

1. Uma tabela `promocoes`, com escopo, tipo, valor, vigência e ativo, mais uma coluna `promocao_id` e um `desconto_promocao_centavos` em `pedido_itens`.
2. O cálculo ficaria em `src/domain/` (uma função pura que recebe itens, canal, unidade e instante), testado como `domain/fidelidade.js`.
3. Em `precificar` (`src/application/pedidos.js`), depois de buscar o preço do cardápio. O cliente continua sem enviar preço nem desconto: o schema da rota já rejeita esses campos.
4. A restrição `total = subtotal − desconto` do banco continuaria valendo, com o desconto sendo a soma de promoção e fidelidade.

## Fora do escopo desta proposta

Cupons digitados pelo cliente, promoções do tipo "leve 3, pague 2" e limite de uso por cliente.
