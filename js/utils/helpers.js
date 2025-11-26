// Função para pegar a data atual corrigindo o fuso horário
export function obterDataLocalFormatada(d = new Date()) {
    const data = new Date(d);
    // Ajusta os minutos pelo Timezone Offset para garantir a data local correta
    data.setMinutes(data.getMinutes() - data.getTimezoneOffset());
    return data.toISOString().split('T')[0];
}

// Exemplo: Função para formatar número (se quiser usar no futuro)
export function formatarNumero(valor) {
    return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}
