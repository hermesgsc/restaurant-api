// tudo em centavos inteiros de brl, nenhuma conta passa por float

export function validarCentavos(valor) {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new RangeError(`Valor monetario invalido: ${valor}`);
  }
  return valor;
}

export function multiplicar(centavos, quantidade) {
  validarCentavos(centavos);
  if (!Number.isSafeInteger(quantidade) || quantidade <= 0) throw new RangeError(`Quantidade invalida: ${quantidade}`);
  return validarCentavos(centavos * quantidade);
}

export function somar(valores) {
  return valores.reduce((acc, v) => validarCentavos(acc + validarCentavos(v)), 0);
}

export function formatarBRL(centavos) {
  validarCentavos(centavos);
  const reais = Math.trunc(centavos / 100);
  const resto = String(centavos % 100).padStart(2, '0');
  return `R$ ${reais},${resto}`;
}
