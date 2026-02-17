// IMPORTAÇÕES DO MÓDULO CENTRAL
import { db, massaCol, pesagemCol } from './config/firebase.js';
import { obterDataLocalFormatada } from './utils/helpers.js';
import { 
    addDoc, getDocs, query, where, orderBy, deleteDoc, doc, getDoc, setDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// ESTADO DA APLICAÇÃO
let appConfig = { 
    pesoFiltro: 4100, pesoPlaca: 39.1, 
    pesoFiltro3: 0, pesoPlaca3: 0, // Novos campos iniciam zerados
    metaKgFT: 12300, metaKgPalete: 12500 
};
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
    // Valores Padrão
    document.getElementById('pesoFiltro').value = appConfig.pesoFiltro;
    document.getElementById('pesoPlaca').value = appConfig.pesoPlaca;
    
    // Novos Valores (Filtro 3)
    document.getElementById('pesoFiltro3').value = appConfig.pesoFiltro3 || 0;
    document.getElementById('pesoPlaca3').value = appConfig.pesoPlaca3 || 0;

    // Metas
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
        
        // NOVOS CAMPOS SALVOS NO BANCO
        pesoFiltro3: parseFloat(document.getElementById('pesoFiltro3').value) || 0,
        pesoPlaca3: parseFloat(document.getElementById('pesoPlaca3').value) || 0,

        metaKgFT: parseFloat(document.getElementById('metaKgFT').value) || 0,
        metaKgPalete: parseFloat(document.getElementById('metaKgPalete').value) || 0
    };

    try {
        await setDoc(doc(db, "configuracoes", "massaConfig"), newConfig, { merge: true });
        appConfig = newConfig;
        alert('Configurações salvas!');
        document.getElementById('configSenha').value = '';
        window.closeConfigModal(null, true);
        renderizarHistorico(); 
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

    const btnSalvar = document.querySelector('#formMassa button[type="submit"]');
    const textoOriginal = btnSalvar.textContent;
    btnSalvar.disabled = true;
    btnSalvar.textContent = "Salvando...";

    const kgPaleteReal = parseFloat(document.getElementById('kgPalete').value);

    if (kgPaleteReal <= 0) {
        alert("O KG Total de Paletes deve ser maior que zero.");
        btnSalvar.disabled = false;
        btnSalvar.textContent = textoOriginal;
        return;
    }

    // --- PEGA OS VALORES DOS 4 CAMPOS (Se estiver vazio, conta como 0) ---
    const qtdFT = parseInt(document.getElementById('qtdFT').value) || 0;
    const qtdPlacas = parseInt(document.getElementById('qtdPlacas').value) || 0;
    
    const qtdFT3 = parseInt(document.getElementById('qtdFT3').value) || 0;
    const qtdPlacas3 = parseInt(document.getElementById('qtdPlacas3').value) || 0;

    // --- VALIDA SE DIGITOU PELO MENOS ALGUMA COISA ---
    if (qtdFT === 0 && qtdPlacas === 0 && qtdFT3 === 0 && qtdPlacas3 === 0) {
        alert("Você precisa preencher a quantidade de Filtros ou Placas (Padrão ou Filtro 3).");
        btnSalvar.disabled = false;
        btnSalvar.textContent = textoOriginal;
        return;
    }

    // --- CÁLCULO HÍBRIDO (SOMA TUDO) ---
    // Grupo 1: Antigos
    const pesoTotalPadrao = (qtdFT * appConfig.pesoFiltro) + (qtdPlacas * appConfig.pesoPlaca);
    
    // Grupo 2: Novo (Filtro 3)
    // Verifica se configurou o peso, senão avisa (opcional, ou usa 0)
    const pesoFiltro3Config = appConfig.pesoFiltro3 || 0;
    const pesoPlaca3Config = appConfig.pesoPlaca3 || 0;
    const pesoTotalNovo = (qtdFT3 * pesoFiltro3Config) + (qtdPlacas3 * pesoPlaca3Config);

    // Soma final
    const kgCalculado = pesoTotalPadrao + pesoTotalNovo;
    // ----------------------------------------------------

    const retrabalhoCalculado = kgPaleteReal - kgCalculado;
    const retrabalhoKg = Math.max(0, retrabalhoCalculado);

    const novoRegistro = {
        data: document.getElementById('data').value,
        turno: document.getElementById('turno').value,
        
        // Salvamos todos os detalhes agora
        qtdFT, 
        qtdPlacas,
        qtdFT3,     // Novo campo no banco
        qtdPlacas3, // Novo campo no banco
        
        kgPalete: kgPaleteReal,
        observacao: document.getElementById('observacao').value,
        kgCalculado, 
        retrabalhoKg,
        timestamp: new Date().toISOString(),
        metaKgFT: appConfig.metaKgFT, 
        metaKgPalete: appConfig.metaKgPalete
    };

    try {
        await addDoc(massaCol, novoRegistro);
        
        // Lógica de Alerta (Mantém igual)
        const metaFT = appConfig.metaKgFT || 1;
        const metaPalete = appConfig.metaKgPalete || 1;
        const eficFT = (kgCalculado / metaFT) * 100;
        const eficPalete = (kgPaleteReal / metaPalete) * 100;

        if (eficFT < 66 || eficPalete < 70) {
             enviarAlertaMassa(
                document.getElementById('turno').value,
                eficFT.toFixed(1),
                eficPalete.toFixed(1),
                document.getElementById('observacao').value
            );
        }

        alert('Produção lançada com sucesso! ✅');
        renderizarHistorico();
        
        // Limpar campos
        document.getElementById('formMassa').reset();
        // Recarregar data e config se necessário
        document.getElementById('data').value = obterDataLocalFormatada();
        
    } catch (e) { 
        console.error(e); 
        alert("Erro ao salvar."); 
    } finally {
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
    // ADICIONEI , 12, 0, 0 NO FINAL
    dataFormatada = new Date(partes[0], partes[1] - 1, partes[2], 12, 0, 0);
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
