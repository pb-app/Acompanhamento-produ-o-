import { db, massaCol, pesagemCol } from './config/firebase.js';
import { obterDataLocalFormatada } from './utils/helpers.js';
// ADICIONEI 'collection' NA LISTA ABAIXO:
import { 
    addDoc, getDocs, query, where, orderBy, deleteDoc, doc, getDoc, setDoc, updateDoc, collection 
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// === NOVAS COLEÇÕES ===
const moagemCol = collection(db, "producao_moagem");
const operadoresCol = collection(db, "operadores_moagem");

// VARIÁVEIS DE CONFIGURAÇÃO (Mantive as antigas e adicionei a de Pontos)
let appConfig = { pesoFiltro: 4100, pesoPlaca: 39.1, metaKgFT: 12300, metaKgPalete: 12500 };
let appConfigMoagem = { pontosPorKgMoagem: 0.01, pontosDescarga: 1, pontosArrumouBox: 5 }; // Config básica

// ESTADO DA APLICAÇÃO
let appConfig = { pesoFiltro: 4100, pesoPlaca: 39.1, metaKgFT: 12300, metaKgPalete: 12500 };
let paletesDisponiveis = new Map();
let pieChartTurnosInstance, barChartMensalInstance;

// INICIALIZAÇÃO
document.addEventListener('DOMContentLoaded', async () => {
    // Configura datas iniciais
    const hojeStr = obterDataLocalFormatada();
    ['data', 'filtroDataInicio', 'filtroDataFim', 'dataPesagem', 'dashFiltroDataInicio', 'dashFiltroDataFim']
        .forEach(id => { if(document.getElementById(id)) document.getElementById(id).value = hojeStr; });

    // Listeners de Eventos
    document.querySelectorAll('.palete-select, .palete-qtd').forEach(el => el.addEventListener('input', calcularPesoTotalPaletes));
    ['filtroDataInicio', 'filtroDataFim', 'filtroTurno'].forEach(id => document.getElementById(id).addEventListener('change', renderizarHistorico));
    ['dashFiltroDataInicio', 'dashFiltroDataFim', 'dashFiltroTurno'].forEach(id => document.getElementById(id).addEventListener('change', atualizarDashboard));
    document.getElementById('filtroTurnoGraficoMes').addEventListener('change', gerarGraficoProducaoMensal);
    document.getElementById('openConfigBtn').addEventListener('click', openConfigModal);
    
    // Formulários
    document.getElementById('formMassa').addEventListener('submit', salvarProducaoMassa);
    document.getElementById('formPesagem').addEventListener('submit', salvarPesagem);

    // Carregamento Inicial
    if(typeof Chart !== 'undefined') Chart.register(ChartDataLabels);
    
    await carregarConfiguracoes(); 
    await carregarOpcoesPaletes();
    renderizarHistorico();
    renderizarHistoricoPesagem();
    await atualizarDashboard();
    await gerarGraficoProducaoMensal();
});

// --- FUNÇÕES DE NAVEGAÇÃO UI (Globais para onclick HTML) ---
window.showTab = function(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-link').forEach(link => link.classList.remove('active'));
    document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`).classList.add('active');
    // Adiciona classe active ao botão clicado (event.target precisa ser capturado ou passado, mas aqui simplificamos)
    const btn = Array.from(document.querySelectorAll('.tab-link')).find(b => b.textContent.toLowerCase().includes(tabName.substr(0,4)));
    if(btn) btn.classList.add('active');
}

window.openConfigModal = function() {
    document.getElementById('pesoFiltro').value = appConfig.pesoFiltro;
    document.getElementById('pesoPlaca').value = appConfig.pesoPlaca;
    document.getElementById('metaKgFT').value = appConfig.metaKgFT;
    document.getElementById('metaKgPalete').value = appConfig.metaKgPalete;
    document.getElementById('configModal').style.display = 'flex';
}

window.closeConfigModal = function(event, force = false) {
    if (force || event.target.id === 'configModal') {
        document.getElementById('configModal').style.display = 'none';
    }
}

window.limparFormMassa = function() {
    document.getElementById('formMassa').reset();
    document.getElementById('data').value = obterDataLocalFormatada();
    calcularPesoTotalPaletes();
}

window.toggleDetalhes = function(docId) {
    const detalhesRow = document.getElementById(`detalhes-${docId}`);
    if (detalhesRow.style.display === "table-row") detalhesRow.style.display = "none";
    else detalhesRow.style.display = "table-row";
};

// --- CONFIGURAÇÕES ---
async function carregarConfiguracoes() {
    try {
        const docSnap = await getDoc(doc(db, "configuracoes", "massaConfig"));
        if (docSnap.exists()) appConfig = docSnap.data();
    } catch(e) { console.error("Erro config:", e); }
}

window.salvarConfiguracoes = async function() {
    if (document.getElementById('configSenha').value !== 'pb2025') return alert('Senha incorreta!');
    
    const newConfig = {
        pesoFiltro: parseFloat(document.getElementById('pesoFiltro').value) || 0,
        pesoPlaca: parseFloat(document.getElementById('pesoPlaca').value) || 0,
        metaKgFT: parseFloat(document.getElementById('metaKgFT').value) || 0,
        metaKgPalete: parseFloat(document.getElementById('metaKgPalete').value) || 0
    };
    try {
        await setDoc(doc(db, "configuracoes", "massaConfig"), newConfig, { merge: true });
        appConfig = newConfig;
        alert('Configurações salvas!');
        document.getElementById('configSenha').value = '';
        window.closeConfigModal(null, true);
        renderizarHistorico(); // Recalcula visualmente com novas metas
    } catch (e) { console.error(e); alert("Erro ao salvar."); }
}

// --- PESAGEM E PALETES ---
async function carregarOpcoesPaletes() {
    try {
        const q = query(pesagemCol, orderBy("codigo"));
        const snap = await getDocs(q);
        paletesDisponiveis.clear();
        snap.forEach(d => { if(d.data().codigo && d.data().peso) paletesDisponiveis.set(d.data().codigo, d.data().peso); });

        document.querySelectorAll('.palete-select').forEach(select => {
            select.innerHTML = '<option value="">Selecione...</option>';
            paletesDisponiveis.forEach((peso, codigo) => {
                const opt = document.createElement('option');
                opt.value = codigo;
                opt.textContent = `${codigo} (${peso.toFixed(2)} kg)`;
                opt.dataset.peso = peso;
                select.appendChild(opt);
            });
        });
    } catch (e) { console.error(e); }
}

function calcularPesoTotalPaletes() {
    let grandTotal = 0;
    for (let i = 1; i <= 3; i++) {
        const select = document.getElementById(`paleteSelect_${i}`);
        const qtdInput = document.getElementById(`paleteQtd_${i}`);
        const pesoOutput = document.getElementById(`paletePesoTotal_${i}`);
        const selectedOption = select.options[select.selectedIndex];
        
        const pesoUnitario = selectedOption && selectedOption.dataset.peso ? parseFloat(selectedOption.dataset.peso) : 0;
        const quantidade = parseInt(qtdInput.value) || 0;
        const subTotal = pesoUnitario * quantidade;
        
        pesoOutput.textContent = subTotal.toFixed(2);
        grandTotal += subTotal;
    }
    document.getElementById('kgPalete').value = grandTotal.toFixed(2);
}

// =========================================================
// ATUALIZAÇÃO: SALVAR PRODUÇÃO MASSA (COM PROTEÇÃO)
// =========================================================
async function salvarProducaoMassa(event) {
    event.preventDefault();

    // 1. Bloqueia botão
    const btnSalvar = document.querySelector('#formMassa button[type="submit"]');
    const textoOriginal = btnSalvar.textContent;
    btnSalvar.disabled = true;
    btnSalvar.textContent = "Salvando...";

    const kgPaleteReal = parseFloat(document.getElementById('kgPalete').value);
    
    // Se validação falhar, precisamos desbloquear o botão antes de sair
    if (kgPaleteReal <= 0) {
        alert("O KG Total de Paletes deve ser maior que zero.");
        btnSalvar.disabled = false;
        btnSalvar.textContent = textoOriginal;
        return;
    }

    const qtdFT = parseInt(document.getElementById('qtdFT').value);
    const qtdPlacas = parseInt(document.getElementById('qtdPlacas').value);
    const kgCalculado = (qtdFT * appConfig.pesoFiltro) + (qtdPlacas * appConfig.pesoPlaca);
    
    const retrabalhoCalculado = kgPaleteReal - kgCalculado;
    const retrabalhoKg = Math.max(0, retrabalhoCalculado);

    const novoRegistro = {
        data: document.getElementById('data').value,
        turno: document.getElementById('turno').value,
        qtdFT, qtdPlacas, kgPalete: kgPaleteReal,
        observacao: document.getElementById('observacao').value,
        kgCalculado, retrabalhoKg,
        timestamp: new Date().toISOString(),
        metaKgFT: appConfig.metaKgFT, metaKgPalete: appConfig.metaKgPalete
    };

    try {
        await addDoc(massaCol, novoRegistro);

        // --- LÓGICA DE ALERTA (MASSA) ---
        // 1. Calcula as eficiências para o alerta
        const metaFT = appConfig.metaKgFT || 1;
        const metaPalete = appConfig.metaKgPalete || 1;
        
        const eficFT = (kgCalculado / metaFT) * 100;
        const eficPalete = (kgPaleteReal / metaPalete) * 100;

        // 2. Se ALGUMA das duas for menor que 90%, dispara o alerta
        if (eficFT < 66 || eficPalete < 70) {
            // Chama a função que criamos lá no final do arquivo
            enviarAlertaMassa(
                document.getElementById('turno').value,
                eficFT.toFixed(1),
                eficPalete.toFixed(1),
                document.getElementById('observacao').value
            );
        }
        // ---------------------------------

        alert('Produção lançada! ✅');
        renderizarHistorico();
        window.limparFormMassa();
    } catch (e) { 
        console.error(e); 
        alert("Erro ao salvar."); 
    } finally {
        // 2. Libera botão
        btnSalvar.disabled = false;
        btnSalvar.textContent = textoOriginal;
    }
}
async function renderizarHistorico() {
    const tbody = document.getElementById('tabelaHistoricoBody');
    tbody.innerHTML = `<tr><td colspan="6">Carregando...</td></tr>`;
    
    const filtro = {
        ini: document.getElementById('filtroDataInicio').value,
        fim: document.getElementById('filtroDataFim').value,
        turno: document.getElementById('filtroTurno').value
    };
    
    let constraints = [orderBy("data", "desc"), orderBy("timestamp", "desc")];
    if (filtro.ini) constraints.push(where("data", ">=", filtro.ini));
    if (filtro.fim) constraints.push(where("data", "<=", filtro.fim));
    if (filtro.turno) constraints.push(where("turno", "==", filtro.turno));

    try {
        const snap = await getDocs(query(massaCol, ...constraints));
        tbody.innerHTML = '';
        if(snap.empty) { tbody.innerHTML = `<tr><td colspan="6">Nenhum registro.</td></tr>`; return; }

        snap.forEach(doc => {
            const reg = doc.data();
            const metaFT = reg.metaKgFT || appConfig.metaKgFT;
            const metaPalete = reg.metaKgPalete || appConfig.metaKgPalete;
            const eficFT = (reg.kgCalculado / (metaFT || 1)) * 100;
            const eficPalete = (reg.kgPalete / (metaPalete || 1)) * 100;
            
            const getEficClass = (p) => p >= 98 ? 'efficiency-good' : (p >= 90 ? 'efficiency-ok' : 'efficiency-bad');
            const retrabalhoClasse = (reg.retrabalhoKg > 0) ? 'efficiency-good' : ((reg.retrabalhoKg < 0) ? 'efficiency-bad' : '');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><button class="expand-btn" onclick="toggleDetalhes('${doc.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>
                </button></td>
                <td>${new Date(reg.data + 'T03:00:00').toLocaleDateString('pt-BR')}</td>
                <td>${reg.turno}</td>
                <td class="${getEficClass(eficFT)}">${eficFT.toFixed(2)}%</td>
                <td class="${getEficClass(eficPalete)}">${eficPalete.toFixed(2)}%</td>
                <td class="${retrabalhoClasse}">${reg.retrabalhoKg ? reg.retrabalhoKg.toFixed(2) : '0.00'}</td>
            `;
            
            const trDet = document.createElement('tr');
            trDet.id = `detalhes-${doc.id}`; trDet.className = 'linha-detalhes';
            trDet.innerHTML = `<td colspan="6">
                <div class="detalhe-grid">
                    <div><span>Filtro Prensa:</span> ${reg.kgCalculado.toFixed(2)} kg</div>
                    <div><span>Palete:</span> ${reg.kgPalete.toFixed(2)} kg</div>
                    <div><span>Retrabalho:</span> ${reg.retrabalhoKg ? reg.retrabalhoKg.toFixed(2) : '0.00'} kg</div>
                    <div><span>Qtd. Filtros:</span> ${reg.qtdFT}</div>
                    <div><span>Qtd. Placas:</span> ${reg.qtdPlacas}</div>
                    <div><span>Meta FT:</span> ${metaFT} kg</div>
                    <div style="grid-column: 1 / -1;"><span>Obs:</span> ${reg.observacao || '-'}</div>
                    <div><button class="delete-btn" onclick="deletarRegistroMassa('${doc.id}')">Excluir</button></div>
                </div>
            </td>`;
            tbody.append(tr, trDet);
        });
    } catch(e) { console.error(e); }
}

window.deletarRegistroMassa = async function(id) {
    if(prompt("Senha:") !== "pb2025") return alert("Senha incorreta.");
    if(confirm("Excluir?")) { await deleteDoc(doc(db, "producao_massa", id)); renderizarHistorico(); }
}

// =========================================================
// ATUALIZAÇÃO: SALVAR PESAGEM (COM PROTEÇÃO)
// =========================================================
async function salvarPesagem(e) {
    e.preventDefault();

    // 1. Bloqueia botão
    const btnSalvar = document.querySelector('#formPesagem button[type="submit"]');
    const textoOriginal = btnSalvar.textContent;
    btnSalvar.disabled = true;
    btnSalvar.textContent = "Salvando...";

    const reg = {
        data: document.getElementById('dataPesagem').value,
        codigo: document.getElementById('codigoPalete').value.trim().toUpperCase(),
        peso: parseFloat(document.getElementById('pesoTotalPalete').value),
        timestamp: new Date().toISOString()
    };

    if(!reg.codigo) {
        alert("Código obrigatório");
        btnSalvar.disabled = false;
        btnSalvar.textContent = textoOriginal;
        return;
    }

    try {
        await addDoc(pesagemCol, reg);
        alert('Salvo! ✅');
        renderizarHistoricoPesagem();
        carregarOpcoesPaletes();
        document.getElementById('formPesagem').reset();
        document.getElementById('dataPesagem').value = obterDataLocalFormatada();
    } catch(e) { 
        console.error(e); 
        alert("Erro ao salvar pesagem."); 
    } finally {
        // 2. Libera botão
        btnSalvar.disabled = false;
        btnSalvar.textContent = textoOriginal;
    }
}

async function renderizarHistoricoPesagem() {
    const tbody = document.getElementById('tabelaPesagemBody');
    tbody.innerHTML = '<tr><td colspan="4">Carregando...</td></tr>';
    try {
        const snap = await getDocs(query(pesagemCol, orderBy("codigo")));
        tbody.innerHTML = '';
        if(snap.empty) { tbody.innerHTML = '<tr><td colspan="4">Vazio.</td></tr>'; return; }
        
        snap.forEach(d => {
            const o = d.data();
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${new Date(o.data+"T03:00:00").toLocaleDateString("pt-BR")}</td>
                <td>${o.codigo}</td><td>${o.peso.toFixed(2)} kg</td>
                <td><button class="delete-btn" onclick="deletarPesagem('${d.id}')">Excluir</button></td>`;
            tbody.appendChild(tr);
        });
    } catch(e) { console.error(e); }
}

window.deletarPesagem = async function(id) {
    if(prompt("Senha:") !== "pb2025") return;
    if(confirm("Excluir pesagem?")) { 
        await deleteDoc(doc(db, "pesagem_paletes", id)); 
        renderizarHistoricoPesagem(); carregarOpcoesPaletes(); 
    }
}

// =========================================================
// CORREÇÃO: EXPORTAR EXCEL FÁBRICA DE MASSA
// =========================================================
window.exportarExcel = async function() {
    alert("Preparando exportação da Fábrica de Massa...");
    
    // 1. Pega os valores dos filtros da tela
    const filtro = {
        ini: document.getElementById('filtroDataInicio').value,
        fim: document.getElementById('filtroDataFim').value,
        turno: document.getElementById('filtroTurno').value
    };

    // 2. Prepara a busca no Banco de Dados
    let constraints = [orderBy("data", "desc"), orderBy("timestamp", "desc")];
    
    if (filtro.ini) constraints.push(where("data", ">=", filtro.ini));
    if (filtro.fim) constraints.push(where("data", "<=", filtro.fim));
    if (filtro.turno) constraints.push(where("turno", "==", filtro.turno));

    try {
        const snap = await getDocs(query(massaCol, ...constraints));
        
        if (snap.empty) return alert("Nenhum dado encontrado para exportar.");

        // 3. Formata os dados para o Excel
        const dataToExport = snap.docs.map(doc => {
            const r = doc.data();
            
            // Correção da DATA para o Excel agrupar certo
            let dataFormatada = r.data;
            if (r.data && typeof r.data === 'string') {
                const partes = r.data.split('-'); 
                dataFormatada = new Date(partes[0], partes[1] - 1, partes[2]);
            }

            // Cálculos de Eficiência para sair no Excel
            const metaFT = r.metaKgFT || appConfig.metaKgFT;
            const metaPalete = r.metaKgPalete || appConfig.metaKgPalete;
            
            // Evita divisão por zero
            const eficFT = metaFT > 0 ? (r.kgCalculado / metaFT) * 100 : 0;
            const eficPalete = metaPalete > 0 ? (r.kgPalete / metaPalete) * 100 : 0;

            return {
                "Data": dataFormatada,
                "Turno": r.turno,
                "Qtd Filtros (FT)": r.qtdFT,
                "Qtd Placas": r.qtdPlacas,
                "KG Filtro (Teórico)": r.kgCalculado.toFixed(2),
                "KG Palete (Real)": r.kgPalete.toFixed(2),
                "Retrabalho (kg)": r.retrabalhoKg ? r.retrabalhoKg.toFixed(2) : "0.00",
                "% Efic. FT": eficFT.toFixed(2) + "%",
                "% Efic. Palete": eficPalete.toFixed(2) + "%",
                "Meta FT Utilizada": metaFT,
                "Observação": r.observacao || ""
            };
        });
        
        // 4. Gera o arquivo
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Producao_Massa");
        
        XLSX.writeFile(wb, `Massa_${obterDataLocalFormatada()}.xlsx`);

    } catch(e) { 
        console.error("Erro Excel Massa:", e); 
        alert("Erro ao exportar. Verifique o console."); 
    }
}

// =========================================================
// ATUALIZAÇÃO: DASHBOARD MASSA (LÓGICA COMPLETA)
// =========================================================

async function atualizarDashboard() {
    const dataInicio = document.getElementById('dashFiltroDataInicio').value;
    const dataFim = document.getElementById('dashFiltroDataFim').value;
    const turno = document.getElementById('dashFiltroTurno').value;

    if (!dataInicio || !dataFim) return;

    // Coloca "..." enquanto carrega
    ['kpiTotalMeta', 'kpiTotalRealizado', 'kpiEficiencia', 'kpiRetrabalho'].forEach(id => 
        document.getElementById(id).textContent = '...'
    );

    try {
        // 1. Busca dados no Firebase
        let constraints = [where("data", ">=", dataInicio), where("data", "<=", dataFim)];
        if (turno) constraints.push(where("turno", "==", turno));
        
        const q = query(massaCol, ...constraints);
        const querySnapshot = await getDocs(q);
        const dados = querySnapshot.docs.map(doc => doc.data());

        // 2. Calcula KPIs
        const totais = dados.reduce((acc, reg) => {
            acc.meta += reg.metaKgFT || 0;
            acc.realizado += reg.kgCalculado || 0; // Realizado FT (Filtro Prensa)
            acc.retrabalho += reg.retrabalhoKg || 0;
            return acc;
        }, { meta: 0, realizado: 0, retrabalho: 0 });

        const eficiencia = totais.meta > 0 ? (totais.realizado / totais.meta) * 100 : 0;

        // 3. Atualiza na Tela (KPIs)
        document.getElementById('kpiTotalMeta').textContent = totais.meta.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
        document.getElementById('kpiTotalRealizado').textContent = totais.realizado.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
        document.getElementById('kpiRetrabalho').textContent = totais.retrabalho.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
        
        const elEficiencia = document.getElementById('kpiEficiencia');
        elEficiencia.textContent = `${eficiencia.toFixed(2)}%`;
        
        // Cores da Eficiência
        elEficiencia.className = 'value'; // reseta classes
        if (eficiencia >= 98) elEficiencia.classList.add('good'); // Verde
        else if (eficiencia >= 90) elEficiencia.classList.add('efficiency-ok'); // Laranja (definir css se quiser)
        else elEficiencia.classList.add('bad'); // Vermelho

        // 4. Gera Gráfico de Pizza (Produção por Turno)
        gerarGraficoPizzaTurnos(dados);

    } catch (error) {
        console.error("Erro Dashboard Massa:", error);
    }
}

function gerarGraficoPizzaTurnos(dados) {
    const producaoPorTurno = dados.reduce((acc, reg) => {
        if (!acc[reg.turno]) acc[reg.turno] = 0;
        acc[reg.turno] += reg.kgPalete || 0; // Gráfico usa o KG Palete (Real)
        return acc;
    }, {});

    if (pieChartTurnosInstance) pieChartTurnosInstance.destroy();
    
    const ctx = document.getElementById('pieChartTurnos').getContext('2d');
    pieChartTurnosInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(producaoPorTurno),
            datasets: [{
                data: Object.values(producaoPorTurno),
                backgroundColor: ['#0077cc', '#28a745', '#ff9900', '#dc3545', '#6c757d', '#17a2b8'],
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' },
                datalabels: {
                    color: '#fff',
                    formatter: (value, ctx) => {
                        const sum = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                        return sum === 0 ? '0%' : (value * 100 / sum).toFixed(1) + '%';
                    }
                }
            }
        }
    });
}

async function gerarGraficoProducaoMensal() {
    const turnoFiltro = document.getElementById('filtroTurnoGraficoMes').value;
    
    // Data de 1 ano atrás
    const hoje = new Date();
    const dozeMesesAtras = new Date(hoje.getFullYear() - 1, hoje.getMonth(), 1);
    const dataInicioStr = dozeMesesAtras.toISOString().split('T')[0];

    try {
        let constraints = [where("data", ">=", dataInicioStr)];
        if (turnoFiltro) constraints.push(where("turno", "==", turnoFiltro));

        const q = query(massaCol, ...constraints);
        const querySnapshot = await getDocs(q);
        const dados = querySnapshot.docs.map(doc => doc.data());

        const producaoPorMes = {};
        // Cria chaves para os últimos 12 meses
        for(let i=11; i>=0; i--) {
            const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
            // Formato Chave: YYYY-MM
            const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            // Formato Label: MM/YY
            const label = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear().toString().substr(2)}`;
            producaoPorMes[chave] = { label: label, valor: 0 };
        }

        dados.forEach(reg => {
            const mesAno = reg.data.substring(0, 7); // Pega YYYY-MM
            if (producaoPorMes[mesAno]) {
                producaoPorMes[mesAno].valor += reg.kgPalete || 0;
            }
        });

        const labels = Object.values(producaoPorMes).map(item => item.label);
        const data = Object.values(producaoPorMes).map(item => item.valor);

        if (barChartMensalInstance) barChartMensalInstance.destroy();
        
        const ctx = document.getElementById('barChartMensal').getContext('2d');
        barChartMensalInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Produção Total (kg)',
                    data: data,
                    backgroundColor: '#0077cc',
                    borderRadius: 4
                }]
            },
            options: { 
                scales: { y: { beginAtZero: true } },
                plugins: {
                    datalabels: {
                        anchor: 'end', align: 'top', color: '#444',
                        formatter: (val) => val > 0 ? (val/1000).toFixed(0) + 'k' : ''
                    },
                    legend: { display: false }
                }
            }
        });
    } catch (error) { console.error("Erro Gráfico Mensal:", error); }
}
// =========================================================
// NOTIFICAÇÃO TELEGRAM - FÁBRICA DE MASSA
// =========================================================
async function enviarAlertaMassa(turno, eficFT, eficPalete, observacao) {
    // SEUS DADOS
    const TELEGRAM_TOKEN = "8470917811:AAFfAASPHXtIAfoEoh7OlGDWMUcqlZVXWJo"; 
    const CHAT_ID = "-5090707282"; 

    // Mensagem personalizada para Massa
    const mensagem = `🚨 *ALERTA FÁBRICA DE MASSA* 🚨\n\n` +
                     `⏰ *Turno:* ${turno}\n` +
                     `📉 *Efic. Filtro:* ${eficFT}%\n` +
                     `📉 *Efic. Palete:* ${eficPalete}%\n` +
                     `📝 *Obs:* ${observacao || "Sem observação"}\n\n` +
                     `VERIFIQUE COM O TURNO.`;

    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: mensagem,
                parse_mode: "Markdown"
            })
        });
        console.log("✅ Alerta de Massa enviado!");
    } catch (error) {
        console.error("Erro Telegram:", error);
    }
}

// =========================================================
// LÓGICA NOVA: MOAGEM E OPERADORES
// =========================================================

// 1. OUVINTES DE EVENTOS (Isso liga o botão ao código)
document.addEventListener('DOMContentLoaded', () => {
    // Liga os formulários novos
    const formMoagem = document.getElementById('formMoagem');
    if(formMoagem) formMoagem.addEventListener('submit', salvarMoagem);
    
    const formOp = document.getElementById('formOperador');
    if(formOp) formOp.addEventListener('submit', salvarOperador);
    
    // Liga o campo de cargas (para criar linhas dinamicamente)
    const inputCargas = document.getElementById('qtdCargasMoagem');
    if(inputCargas) inputCargas.addEventListener('input', atualizarCamposCargaMoagem);

    // Carrega os dados iniciais das novas abas
    carregarOperadoresDropdown();
    renderizarHistoricoMoagem();
    renderizarHistoricoOperadores();
});

// 2. FUNÇÃO: CRIA CAMPOS DE CARGA DINÂMICOS
function atualizarCamposCargaMoagem() {
    const qtd = parseInt(document.getElementById('qtdCargasMoagem').value) || 0;
    const div = document.getElementById('cargasContainerMoagem');
    div.innerHTML = ''; // Limpa
    
    for(let i=1; i<=qtd; i++) {
        div.innerHTML += `
            <div style="display:flex; gap:10px; margin-bottom:5px; align-items:center;">
                <label style="font-size:0.8rem">Moinho:</label>
                <select id="moinhoCarga_${i}" style="width:60px"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>
                <label style="font-size:0.8rem">Kg:</label>
                <input type="number" id="pesoCarga_${i}" step="0.1" style="width:80px">
            </div>`;
    }
}

// 3. FUNÇÃO: SALVAR MOAGEM
async function salvarMoagem(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const txtOriginal = btn.textContent;
    btn.disabled = true; btn.textContent = "Salvando...";

    // Coleta as cargas
    const qtdCargas = parseInt(document.getElementById('qtdCargasMoagem').value) || 0;
    let cargas = [], pesoTotal = 0;
    for(let i=1; i<=qtdCargas; i++) {
        const p = parseFloat(document.getElementById(`pesoCarga_${i}`).value) || 0;
        if(p > 0) { 
            cargas.push({ moinho: document.getElementById(`moinhoCarga_${i}`).value, peso: p }); 
            pesoTotal += p; 
        }
    }

    // Calcula Pontos (Básico)
    let pts = (pesoTotal * appConfigMoagem.pontosPorKgMoagem) + 
              (parseInt(document.getElementById('qtdDescargaMoagem').value||0) * appConfigMoagem.pontosDescarga);
    
    if(document.getElementById('arrumouBoxMoagem').value === 'sim') pts += 5;

    const registro = {
        data: document.getElementById('dataMoagem').value || new Date().toISOString().split('T')[0],
        turno: document.getElementById('turnoMoagem').value,
        operador: document.getElementById('operadorMoagemSelect').value,
        cargas, pesoTotalCargas: pesoTotal, pontosTotal: pts,
        observacao: document.getElementById('observacaoMoagem').value,
        timestamp: new Date().toISOString()
    };

    try {
        await addDoc(moagemCol, registro);
        alert('Moagem Salva! ✅');
        renderizarHistoricoMoagem();
        document.getElementById('formMoagem').reset();
        document.getElementById('cargasContainerMoagem').innerHTML = '';
    } catch (err) {
        console.error(err); alert('Erro ao salvar moagem.');
    } finally {
        btn.disabled = false; btn.textContent = txtOriginal;
    }
}

// 4. FUNÇÃO: SALVAR OPERADOR
async function salvarOperador(e) {
    e.preventDefault();
    const nome = document.getElementById('nomeOperador').value;
    try {
        await addDoc(operadoresCol, {
            dataCadastro: document.getElementById('dataCadastroOperador').value,
            nome: nome,
            turno: document.getElementById('turnoOperador').value,
            timestamp: new Date().toISOString()
        });
        alert('Operador Cadastrado!');
        renderizarHistoricoOperadores();
        carregarOperadoresDropdown();
        document.getElementById('formOperador').reset();
    } catch(err) { console.error(err); alert('Erro ao cadastrar.'); }
}

// 5. FUNÇÕES DE EXIBIÇÃO (TABELAS E SELECT)
async function renderizarHistoricoMoagem() { 
    const tbody = document.getElementById('tabelaHistoricoMoagem');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7">Carregando...</td></tr>';
    
    const snap = await getDocs(query(moagemCol, orderBy("data", "desc"), orderBy("timestamp", "desc")));
    tbody.innerHTML = '';
    
    snap.forEach(doc => {
        const d = doc.data();
        tbody.innerHTML += `<tr>
            <td>${new Date(d.data+'T03:00:00').toLocaleDateString('pt-BR')}</td>
            <td>${d.turno}</td><td>${d.operador}</td><td>${d.cargas ? d.cargas.length : 0}</td>
            <td>${d.pesoTotalCargas}</td><td>${d.pontosTotal ? d.pontosTotal.toFixed(2) : 0}</td>
            <td><button style="background:red; color:white; border:none; border-radius:3px;" onclick="deletarRegistroMoagem('${doc.id}')">X</button></td>
        </tr>`;
    });
}

async function renderizarHistoricoOperadores() {
    const tbody = document.getElementById('tabelaOperadoresBody');
    if(!tbody) return;
    const snap = await getDocs(query(operadoresCol, orderBy("nome")));
    tbody.innerHTML = '';
    snap.forEach(doc => {
        const d = doc.data();
        tbody.innerHTML += `<tr>
            <td>${d.nome}</td><td>${d.turno}</td>
            <td><button style="background:red; color:white; border:none; border-radius:3px;" onclick="deletarRegistroOperador('${doc.id}')">X</button></td>
        </tr>`;
    });
}

async function carregarOperadoresDropdown() {
    const sel = document.getElementById('operadorMoagemSelect');
    if(!sel) return;
    const snap = await getDocs(query(operadoresCol, orderBy("nome")));
    sel.innerHTML = '<option value="">Selecione...</option>';
    snap.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.data().nome; opt.textContent = d.data().nome;
        sel.appendChild(opt);
    });
}

// Funções globais de deletar
window.deletarRegistroMoagem = async (id) => { if(confirm("Excluir?")) { await deleteDoc(doc(db, "producao_moagem", id)); renderizarHistoricoMoagem(); } };
window.deletarRegistroOperador = async (id) => { if(confirm("Excluir?")) { await deleteDoc(doc(db, "operadores_moagem", id)); renderizarHistoricoOperadores(); carregarOperadoresDropdown(); } };
