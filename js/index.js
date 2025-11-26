// IMPORTAÇÕES
import { db, producoesCol, operadoresCol } from './config/firebase.js';
import { obterDataLocalFormatada } from './utils/helpers.js';
import { 
    addDoc, getDocs, query, where, orderBy, deleteDoc, doc, limit, startAfter, getDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// VARIÁVEIS GLOBAIS
const ITENS_POR_PAGINA = 30;
let ultimoDocumentoVisivel = null;
let primeiroDocumentoStack = [null];
let paginaAtual = 1;
let filtroAtual = null;
let pieChart = null; 
let barChart = null;

// MAQUINAS POR SETOR
const maquinasPorSetor = {
    "Conformação":["Secador 2","Secador 3","Secador 4","Secador 10","Máquina de Xícara 1","Máquina de Xícara 2","Máquina de Prato","Prensa"],
    "Esmaltação":["Disco 1","Disco 2","Disco 3","Disco 4","Robô 1","Robô 2","Spray","Imersão"],
    "Embalagem":["Linha 1","Linha 2","Linha 3","Linha 4","Linha 5"],
    "Forno Vidrado":["Forno 1","Forno 2"],
    "Forno chacote":["Forno 3"]
};

// INICIALIZAÇÃO
document.addEventListener("DOMContentLoaded", () => {
    // Configura datas iniciais
    const today = obterDataLocalFormatada();
    ['data', 'dataCadastroOp', 'filtroDataInicio', 'filtroDataFim', 'dashFiltroDataInicio', 'dashFiltroDataFim']
        .forEach(id => {
            const el = document.getElementById(id);
            if(el) el.value = today;
        });

    // Event Listeners
    document.getElementById("setor").addEventListener("change", carregarOperadores);
    document.getElementById("formOperador").addEventListener("submit", cadastrarOperador);
    document.getElementById('filtroSetor').addEventListener('change', () => atualizarDatalistMaquina('filtroSetor', 'listaMaquinasFiltro'));
    document.getElementById('dashFiltroSetor').addEventListener('change', () => atualizarDatalistMaquina('dashFiltroSetor', 'listaMaquinasDash'));
    
    document.getElementById('formEdicaoProducao').addEventListener('submit', salvarEdicaoProducao);
    document.getElementById('formEdicaoOperador').addEventListener('submit', salvarEdicaoOperador);
    document.getElementById("formProducao").addEventListener("submit", salvarLancamentoProducao);

    // Inicializa Chart.js
    if(typeof Chart !== 'undefined') Chart.register(ChartDataLabels);
});

// --- FUNÇÕES DE NAVEGAÇÃO E UI ---
// Precisamos anexar ao 'window' porque o HTML chama onclick="mostrarPagina(...)"
window.mostrarPagina = function(pg){
    document.querySelectorAll("section").forEach(s => s.style.display="none");
    document.getElementById(pg).style.display="block";
    document.querySelectorAll(".nav a").forEach(a => a.classList.remove("active"));
    
    // Ajuste seguro para o seletor do link
    const mapLinks = { 'lancamento': 'linkLanc', 'operadores': 'linkOper', 'historico': 'linkHist', 'dashboard': 'linkDash' };
    if(mapLinks[pg]) document.getElementById(mapLinks[pg]).classList.add("active");
    
    if(pg==="historico") filtrarHistorico(); 
    if(pg==="dashboard") atualizarDashboard();
    if(pg==="operadores") atualizarTabelaOperadores();
}

window.toggleDetalhes = function(index) {
    const detalhesRow = document.getElementById(`detalhes-${index}`);
    // O evento precisa ser capturado de forma global ou passado como argumento, 
    // mas aqui simplificamos buscando o botão pelo contexto se possível, ou apenas alternando o display.
    // Melhor abordagem para módulos: passar o elemento 'this' no HTML onclick="toggleDetalhes(1, this)"
    // Como o HTML antigo não passa 'this', vamos apenas abrir. Para girar o ícone, precisaríamos refazer o HTML gerado no JS.
    // Vamos assumir que o usuário clica no botão e o CSS cuida ou deixamos sem animação por enquanto.
    if (detalhesRow.style.display === "table-row") {
        detalhesRow.style.display = "none";
    } else {
        detalhesRow.style.display = "table-row";
    }
};

window.fecharModal = function(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

window.limparFormulario = function(){
    document.getElementById("formProducao").reset();
    document.getElementById("operadorSelect").innerHTML = '<option value="">Selecione o setor</option>';
}

// --- LÓGICA DE NEGÓCIO ---

function atualizarDatalistMaquina(idSetor, idDatalist) {
    const setor = document.getElementById(idSetor).value;
    const datalist = document.getElementById(idDatalist);
    datalist.innerHTML = ''; 
    if (maquinasPorSetor[setor]) {
        maquinasPorSetor[setor].forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            datalist.appendChild(option);
        });
    }
}

// CARREGAR OPERADORES NO SELECT
async function carregarOperadores() {
    const setor = document.getElementById("setor").value;
    const opSelect = document.getElementById("operadorSelect");
    opSelect.innerHTML = '<option value="">Carregando...</option>';
    opSelect.disabled = true;

    if (!setor) {
        opSelect.innerHTML = '<option value="">Selecione o setor</option>';
        opSelect.disabled = false;
        return;
    }

    try {
        const q = query(operadoresCol, where("setor", "==", setor), orderBy("nome"));
        const snapshot = await getDocs(q);
        
        opSelect.innerHTML = '';
        if (snapshot.empty) {
            opSelect.innerHTML = '<option value="">Nenhum operador neste setor</option>';
        } else {
            opSelect.innerHTML = '<option value="">Selecione um operador</option>';
            snapshot.forEach(doc => {
                const nome = doc.data().nome;
                opSelect.add(new Option(nome, nome));
            });
        }
    } catch(error) {
        console.error("Erro ao carregar operadores:", error);
        opSelect.innerHTML = '<option value="">Erro ao carregar</option>';
    } finally {
        opSelect.disabled = false;
    }
}

// =========================================================
// ATUALIZAÇÃO: SALVAR LANÇAMENTO (COM PROTEÇÃO DUPLO CLIQUE)
// =========================================================
async function salvarLancamentoProducao(e) {
    e.preventDefault();
    
    // 1. Pega o botão de salvar e bloqueia
    const btnSalvar = document.querySelector('#formProducao button[type="submit"]');
    const textoOriginal = btnSalvar.textContent;
    btnSalvar.disabled = true;
    btnSalvar.textContent = "Salvando...";

    const data = {
        data: document.getElementById("data").value,
        setor: document.getElementById("setor").value,
        turno: document.getElementById("turno").value,
        operador: document.getElementById("operadorSelect").value,
        maquina: document.getElementById("maquinaSelect").value, 
        massa: document.getElementById("massa").value,
        refCpb: document.getElementById("refCpb").value,
        prevista: parseFloat(document.getElementById("prevista").value),
        realizada: parseFloat(document.getElementById("realizada").value),
        quebras: parseFloat(document.getElementById("quebras").value),
        observacao: document.getElementById("observacao").value,
        timestamp: new Date().toISOString()
    };

    try {
        await addDoc(producoesCol, data);
        alert("Lançamento salvo com sucesso no Firebase! ✅");
        window.limparFormulario();
    } catch (error) {
        console.error("Erro ao adicionar documento: ", error);
        alert("Erro ao salvar o lançamento. Verifique o console. ❌"); 
    } finally {
        // 2. Sempre libera o botão no final, mesmo se der erro
        btnSalvar.disabled = false;
        btnSalvar.textContent = textoOriginal;
    }
}

// =========================================================
// ATUALIZAÇÃO: CADASTRAR OPERADOR (COM PROTEÇÃO DUPLO CLIQUE)
// =========================================================
async function cadastrarOperador(e) {
    e.preventDefault();
    
    const nome = document.getElementById("nomeOperador").value.trim();
    if (!nome) return;

    // 1. Bloqueia botão
    const btnSalvar = document.querySelector('#formOperador button[type="submit"]');
    const textoOriginal = btnSalvar.textContent;
    btnSalvar.disabled = true;
    btnSalvar.textContent = "Salvando...";

    const novoOperador = {
        dataCadastro: document.getElementById("dataCadastroOp").value,
        nome: nome,
        setor: document.getElementById("setorOperador").value,
        turno: document.getElementById("turnoOperador").value
    };

    try {
        await addDoc(operadoresCol, novoOperador);
        alert(`Operador "${nome}" cadastrado com sucesso! ✅`);
        document.getElementById("formOperador").reset();
        document.getElementById("dataCadastroOp").value = obterDataLocalFormatada();
        atualizarTabelaOperadores();
    } catch (error) {
        console.error("Erro: ", error);
        alert("Erro ao cadastrar.");
    } finally {
        // 2. Libera botão
        btnSalvar.disabled = false;
        btnSalvar.textContent = textoOriginal;
    }
}

window.atualizarTabelaOperadores = async function() {
    const tbody = document.querySelector("#tabelaOperadores tbody");
    tbody.innerHTML = "<tr><td colspan='5'>Carregando...</td></tr>";
    try {
        const q = query(operadoresCol, orderBy("nome"));
        const snapshot = await getDocs(q);
        tbody.innerHTML = "";
        if (snapshot.empty) {
            tbody.innerHTML = "<tr><td colspan='5'>Nenhum operador cadastrado.</td></tr>";
            return;
        }
        snapshot.forEach(docSnap => {
            const op = docSnap.data();
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${op.dataCadastro}</td><td>${op.nome}</td><td>${op.setor}</td><td>${op.turno}</td>
                <td>
                    <button class="edit-btn" onclick="abrirModalOperador('${docSnap.id}')">Editar</button>
                    <button class="delete-btn" onclick="deletarOperador('${docSnap.id}')">Deletar</button>
                </td>`;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error(error);
        tbody.innerHTML = "<tr><td colspan='5'>Erro ao carregar dados.</td></tr>";
    }
}

// --- HISTÓRICO ---
window.filtrarHistorico = function(){
    filtroAtual = {
        dataInicio: document.getElementById("filtroDataInicio").value,
        dataFim: document.getElementById("filtroDataFim").value,
        setor: document.getElementById("filtroSetor").value,
        turno: document.getElementById("filtroTurno").value,
        maquina: document.getElementById("filtroMaquina").value,
        refCpb: document.getElementById("filtroRefCpb").value
    };
    paginaAtual = 1; ultimoDocumentoVisivel = null; primeiroDocumentoStack = [null];
    atualizarTabela(filtroAtual);
}

window.buscarTodos = function(){
    // Limpa inputs
    ['filtroDataInicio','filtroDataFim','filtroSetor','filtroTurno','filtroMaquina','filtroRefCpb']
        .forEach(id => document.getElementById(id).value = "");
    filtroAtual = null; paginaAtual = 1; ultimoDocumentoVisivel = null; primeiroDocumentoStack = [null];
    atualizarTabela(null);
}

async function atualizarTabela(filtro, direcao = null) {
    const tbody = document.querySelector("#tabelaHistorico tbody");
    tbody.innerHTML = `<tr><td colspan="6">Carregando dados...</td></tr>`;

    let queryConstraints = [];
    if (filtro && filtro.dataInicio) queryConstraints.push(where("data", ">=", filtro.dataInicio));
    if (filtro && filtro.dataFim) queryConstraints.push(where("data", "<=", filtro.dataFim));
    queryConstraints.push(orderBy("data", "desc"), orderBy("timestamp", "desc"));
    
    if (direcao === 'proxima' && ultimoDocumentoVisivel) {
        queryConstraints.push(startAfter(ultimoDocumentoVisivel));
    } else if (direcao === 'anterior') {
        primeiroDocumentoStack.pop();
        const cursorAnterior = primeiroDocumentoStack[primeiroDocumentoStack.length - 1];
        if(cursorAnterior) queryConstraints.push(startAfter(cursorAnterior));
    }
    queryConstraints.push(limit(ITENS_POR_PAGINA));
    
    try {
        const q = query(producoesCol, ...queryConstraints);
        const querySnapshot = await getDocs(q);
        const documentos = querySnapshot.docs;

        // Filtragem no cliente para campos que não estão no índice composto simples
        let filtrados = documentos.map(doc => ({ id: doc.id, ...doc.data() }));
        if (filtro) {
            filtrados = filtrados.filter(r =>
                (!filtro.setor || r.setor === filtro.setor) &&
                (!filtro.turno || r.turno === filtro.turno) &&
                (!filtro.maquina || (r.maquina && r.maquina.toLowerCase().includes(filtro.maquina.toLowerCase()))) &&
                (!filtro.refCpb || (r.refCpb && r.refCpb.toLowerCase().includes(filtro.refCpb.toLowerCase())))
            );
        }

        tbody.innerHTML = "";
        if (filtrados.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6">${paginaAtual > 1 ? 'Fim dos resultados.' : 'Nenhum registro encontrado.'}</td></tr>`;
            document.getElementById('btnProxima').disabled = true;
            return;
        }

        if(direcao === 'proxima') primeiroDocumentoStack.push(documentos[0]);
        ultimoDocumentoVisivel = documentos[documentos.length - 1];
        
        filtrados.forEach((r, index) => {
            const prev = parseFloat(r.prevista) || 0;
            const real = parseFloat(r.realizada) || 0;
            const queb = parseFloat(r.quebras) || 0;
            const percRealizadoPrevisto = prev > 0 ? ((real / prev) * 100).toFixed(2) + '%' : 'N/A';
            const totalProd = real + queb;
            const percQuebrasRealizado = totalProd > 0 ? ((queb / totalProd) * 100).toFixed(2) + '%' : 'N/A';
            
            const trPrincipal = document.createElement("tr");
            // Nota: Adicionei classes ao botão para tentar manter o estilo, mas a rotação depende de manipular classes no JS toggleDetalhes
            trPrincipal.innerHTML = `
                <td><button class="expand-btn" onclick="toggleDetalhes('${index}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>
                </button></td>
                <td>${r.data}</td><td>${r.setor}</td><td>${r.maquina}</td><td>${percRealizadoPrevisto}</td><td>${percQuebrasRealizado}</td>`;            
            
            const trDetalhes = document.createElement("tr");
            trDetalhes.classList.add("linha-detalhes");
            trDetalhes.id = `detalhes-${index}`;
            trDetalhes.innerHTML = `
                <td colspan="6"><div class="detalhe-grid">
                    <div><span>Operador:</span> ${r.operador}</div><div><span>Turno:</span> ${r.turno}</div>
                    <div><span>Massa:</span> ${r.massa}</div><div><span>Ref/CPB:</span> ${r.refCpb || 'N/A'}</div>
                    <div><span>Prevista:</span> ${prev}</div><div><span>Realizada:</span> ${real}</div>
                    <div><span>Quebras:</span> ${queb}</div><div><span>Observação:</span> ${r.observacao || 'Nenhuma'}</div>
                    <div><span>Ações:</span> 
                        <button class="edit-btn" onclick="abrirModalEdicao('${r.id}')">Editar</button> 
                        <button class="delete-btn" onclick="deletarRegistro('${r.id}')">Deletar</button>
                    </div>
                </div></td>`;
            
            tbody.appendChild(trPrincipal);
            tbody.appendChild(trDetalhes);
        });

        document.getElementById('infoPagina').textContent = `Página ${paginaAtual}`;
        document.getElementById('btnAnterior').disabled = (paginaAtual === 1);
        document.getElementById('btnProxima').disabled = (documentos.length < ITENS_POR_PAGINA);

    } catch (error) {
       console.error("Erro busca: ", error);
       tbody.innerHTML=`<tr><td colspan='6'>Erro ao carregar dados.</td></tr>`;
    }
}

window.proximaPagina = function() { paginaAtual++; atualizarTabela(filtroAtual, 'proxima'); }
window.paginaAnterior = function() { if (paginaAtual > 1) { paginaAtual--; atualizarTabela(filtroAtual, 'anterior'); } }

// --- EDIÇÃO E DELEÇÃO ---
window.deletarRegistro = async function(docId) {
    if (prompt("Senha:") !== "pb2025") return alert("Senha incorreta.");
    if (confirm("Deletar registro?")) {
        try { await deleteDoc(doc(db, "producoes", docId)); alert("Deletado!"); filtrarHistorico(); } 
        catch (e) { console.error(e); alert("Erro ao deletar."); }
    }
}
window.deletarOperador = async function(docId) {
    if (prompt("Senha:") !== "pb2025") return alert("Senha incorreta.");
    if (confirm("Deletar operador?")) {
        try { await deleteDoc(doc(db, "operadores", docId)); alert("Deletado!"); atualizarTabelaOperadores(); } 
        catch (e) { console.error(e); alert("Erro ao deletar."); }
    }
}

window.abrirModalEdicao = async function(docId) {
    try {
        const docSnap = await getDoc(doc(db, "producoes", docId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('editDocId').value = docId;
            document.getElementById('editData').value = data.data;
            document.getElementById('editSetor').value = data.setor;
            document.getElementById('editTurno').value = data.turno;
            document.getElementById('editOperador').value = data.operador;
            document.getElementById('editMaquina').value = data.maquina;
            document.getElementById('editMassa').value = data.massa;
            document.getElementById('editRefCpb').value = data.refCpb || '';
            document.getElementById('editPrevista').value = data.prevista;
            document.getElementById('editRealizada').value = data.realizada;
            document.getElementById('editQuebras').value = data.quebras;
            document.getElementById('editObservacao').value = data.observacao || '';
            document.getElementById('modalEdicaoProducao').style.display = 'flex';
        }
    } catch (e) { console.error(e); alert("Erro ao abrir edição."); }
}

async function salvarEdicaoProducao(e) {
    e.preventDefault();
    const docId = document.getElementById('editDocId').value;
    const dados = {
        data: document.getElementById('editData').value,
        setor: document.getElementById('editSetor').value,
        turno: document.getElementById('editTurno').value,
        operador: document.getElementById('editOperador').value,
        maquina: document.getElementById('editMaquina').value,
        massa: document.getElementById('editMassa').value,
        refCpb: document.getElementById('editRefCpb').value,
        prevista: parseFloat(document.getElementById('editPrevista').value),
        realizada: parseFloat(document.getElementById('editRealizada').value),
        quebras: parseFloat(document.getElementById('editQuebras').value),
        observacao: document.getElementById('editObservacao').value,
    };
    try { await updateDoc(doc(db, "producoes", docId), dados); alert("Atualizado!"); fecharModal('modalEdicaoProducao'); filtrarHistorico(); }
    catch(e){ console.error(e); alert("Erro ao salvar."); }
}

window.abrirModalOperador = async function(docId) {
    try {
        const docSnap = await getDoc(doc(db, "operadores", docId));
        if(docSnap.exists()){
            const d = docSnap.data();
            document.getElementById('editOpDocId').value = docId;
            document.getElementById('editOpData').value = d.dataCadastro;
            document.getElementById('editOpNome').value = d.nome;
            document.getElementById('editOpSetor').value = d.setor;
            document.getElementById('editOpTurno').value = d.turno;
            document.getElementById('modalEdicaoOperador').style.display = 'flex';
        }
    } catch(e){ console.error(e); alert("Erro ao abrir."); }
}

async function salvarEdicaoOperador(e) {
    e.preventDefault();
    const docId = document.getElementById('editOpDocId').value;
    const dados = {
        dataCadastro: document.getElementById('editOpData').value,
        nome: document.getElementById('editOpNome').value,
        setor: document.getElementById('editOpSetor').value,
        turno: document.getElementById('editOpTurno').value,
    };
    try { await updateDoc(doc(db, "operadores", docId), dados); alert("Atualizado!"); fecharModal('modalEdicaoOperador'); atualizarTabelaOperadores(); }
    catch(e){ console.error(e); alert("Erro ao salvar."); }
}

// --- EXPORTAÇÃO EXCEL ---
window.exportarExcel = async function() {
    alert("Exportando...");
    const filtro = {
        dataInicio: document.getElementById("filtroDataInicio").value,
        dataFim: document.getElementById("filtroDataFim").value,
        setor: document.getElementById("filtroSetor").value,
        turno: document.getElementById("filtroTurno").value,
        maquina: document.getElementById("filtroMaquina").value,
        refCpb: document.getElementById("filtroRefCpb").value
    };
    let q = query(producoesCol, orderBy("data", "desc"));
    // Simples filtro para exportação (pode melhorar com where se tiver índices)
    if(filtro.dataInicio) q = query(q, where("data", ">=", filtro.dataInicio));
    if(filtro.dataFim) q = query(q, where("data", "<=", filtro.dataFim));

    try {
        const snap = await getDocs(q);
        const filtrados = snap.docs.map(d=>d.data()).filter(r => 
            (!filtro.setor || r.setor === filtro.setor) &&
            (!filtro.turno || r.turno === filtro.turno) &&
            (!filtro.maquina || (r.maquina && r.maquina.toLowerCase().includes(filtro.maquina.toLowerCase())))
        );
        
        if (filtrados.length === 0) return alert("Nada encontrado.");

        const dataToExport = filtrados.map(r => ({
            "Data": r.data,
            "Setor": r.setor, "Turno": r.turno, "Operador": r.operador,
            "Máquina": r.maquina, "Massa": r.massa, "Realizada": r.realizada, "Quebras": r.quebras
        }));
        
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Dados");
        XLSX.writeFile(wb, `Producao_${obterDataLocalFormatada()}.xlsx`);
    } catch(e){ console.error(e); alert("Erro na exportação."); }
}

// --- DASHBOARD ---
window.atualizarDashboard = async function(){
    const filtro = {
        dataInicio: document.getElementById("dashFiltroDataInicio").value,
        dataFim: document.getElementById("dashFiltroDataFim").value,
        setor: document.getElementById("dashFiltroSetor").value,
        turno: document.getElementById("dashFiltroTurno").value,
        maquina: document.getElementById("dashFiltroMaquina").value,
        refCpb: document.getElementById("dashFiltroRefCpb").value,
        operador: document.getElementById("dashFiltroOperador").value.toLowerCase()
    };
    
    // Simplificado para exemplo: busca tudo no range de data e filtra na memória
    let q = query(producoesCol, where("data", ">=", filtro.dataInicio), where("data", "<=", filtro.dataFim));
    
    try {
        const snap = await getDocs(q);
        const dados = snap.docs.map(d=>d.data()).filter(d => 
            (!filtro.setor || d.setor === filtro.setor) &&
            (!filtro.turno || d.turno === filtro.turno) &&
            (!filtro.operador || (d.operador && d.operador.toLowerCase().includes(filtro.operador)))
        );

        // Atualiza KPIs
        let prev=0, real=0, quebra=0;
        dados.forEach(d => { prev+=d.prevista||0; real+=d.realizada||0; quebra+=d.quebras||0; });
        document.getElementById('kpiPrevisto').innerText = prev;
        document.getElementById('kpiRealizado').innerText = real;
        document.getElementById('kpiQuebras').innerText = quebra;
        
        // Atualiza Gráfico Pizza
        if (pieChart) pieChart.destroy();
        const turnos = {};
        dados.forEach(d => { turnos[d.turno] = (turnos[d.turno]||0) + (d.realizada||0); });
        
        const ctxP = document.getElementById('pieChartTurno').getContext('2d');
        pieChart = new Chart(ctxP, {
            type: 'pie',
            data: { labels: Object.keys(turnos), datasets: [{ data: Object.values(turnos), backgroundColor: ['#36A2EB','#FFCE56','#FF6384','#4BC0C0','#9966FF','#FF9F40'] }] },
            options: { plugins: { datalabels: { color: '#fff' } } }
        });

        // (O gráfico de barras mensal exigiria outra query de 12 meses, omitido para brevidade, mas segue lógica similar)

    } catch(e){ console.error(e); }
}
