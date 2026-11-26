/* ================================================
   ed_general-pins-manager.js — v1.1
   Repositório Geral de Peças Processuais (ED — Aba Oculta)
   Modelo Referencial ciente de Polo:
   topico.vinculosGerais[] (`docTipo|polo`) -> metadata.marcosExtracaoGerais[]
   ================================================ */
window.GeneralPinsManager = (function () {
    'use strict';

    const GENERAL_ID = '__JURIS_GERAL__';
    const VIRTUAL_TOPIC = Object.freeze({
        id: GENERAL_ID,
        nome: 'Peças Gerais (Processo)',
        cor: '#4f46e5',
        optionClass: 'jcs-option--geral',
        iconHtml: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:14px; height:14px; color:#4f46e5; flex-shrink:0;"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`
    });

    let _marcosGerais = [];
    let _autoVincularSet = new Set(); // Armazena chaves compostas normalizadas (`docTipo|polo`)
    let _forcarDestinoGeral = false;
    let _ultimoDestinoId = null;
    let _ultimoMarcoInicio = null; // { destinoId, docTipo, docLabel, polo }
    let _eventosModalRegistrados = false;
    let _confirmacaoTimer = null;

    function _escapar(str) {
        if (!str) return '';
        if (window.TopicsManager && typeof TopicsManager.escaparHTML === 'function') {
            return TopicsManager.escaparHTML(str);
        }
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _normalizarPolo(polo) {
        if (window.JurisPecas && typeof JurisPecas.normalizarPolo === 'function') {
            return JurisPecas.normalizarPolo(polo);
        }
        const limpo = polo ? String(polo).trim() : '';
        return limpo || 'Comum';
    }

    function _gerarChave(docTipo, polo = 'Comum') {
        if (window.JurisPecas && typeof JurisPecas.gerarChaveComposta === 'function') {
            return JurisPecas.gerarChaveComposta(docTipo, polo);
        }
        return `${String(docTipo || '').trim()}|${_normalizarPolo(polo)}`;
    }

    function _normalizarChave(chaveOuDocTipo, poloOpcional = null) {
        if (window.JurisPecas && typeof JurisPecas.normalizarChave === 'function') {
            return JurisPecas.normalizarChave(chaveOuDocTipo, poloOpcional);
        }
        if (poloOpcional !== null && poloOpcional !== undefined) {
            return _gerarChave(chaveOuDocTipo, poloOpcional);
        }
        const str = String(chaveOuDocTipo || '');
        const sepIdx = str.indexOf('|');
        if (sepIdx === -1) return _gerarChave(str, 'Comum');
        return _gerarChave(str.slice(0, sepIdx), str.slice(sepIdx + 1));
    }

    function _obterTotalPaginasPdf() {
        return window.PdfEngine?.getPdfDoc?.()?.numPages || null;
    }

    function _obterTopicoAtivo() {
        const activeId = (typeof TopicsManager !== 'undefined') ? TopicsManager.getActiveTabId() : null;
        if (!activeId || typeof topicos === 'undefined') return null;
        return topicos.find(t => t.id === activeId) || null;
    }

    function getMarcos() {
        return _marcosGerais.map(m => ({ ...m }));
    }

    function setMarcos(lista) {
        _marcosGerais = Array.isArray(lista)
            ? lista
                .filter(m => m && m.docTipo && m.fronteira)
                .map(m => ({ ...m, polo: _normalizarPolo(m.polo) }))
            : [];
        atualizarIndicadoresUI();
    }

    function getAutoVincular() {
        return Array.from(_autoVincularSet);
    }

    function setAutoVincular(lista) {
        _autoVincularSet = new Set(
            Array.isArray(lista)
                ? lista.filter(Boolean).map(v => _normalizarChave(v))
                : []
        );
    }

    function obterVinculosIniciaisParaNovoTopico() {
        const chavesExistentes = new Set(_marcosGerais.map(m => _gerarChave(m.docTipo, m.polo)));
        return Array.from(_autoVincularSet).filter(chave => chavesExistentes.has(chave));
    }

    /**
     * Conta quantos tópicos utilizam efetivamente esta peça geral (sem sobrescrita própria).
     * Aceita:
     *  - contarVinculos(chaveComposta, listaTopicos?)
     *  - contarVinculos(docTipo, polo, listaTopicos?)
     */
    function contarVinculos(chaveOuDocTipo, poloOuLista = null, listaTopicos = null) {
        let chaveAlvo;
        let lista;

        if (Array.isArray(poloOuLista)) {
            chaveAlvo = _normalizarChave(chaveOuDocTipo);
            lista = poloOuLista;
        } else if (typeof poloOuLista === 'string') {
            chaveAlvo = _gerarChave(chaveOuDocTipo, poloOuLista);
            lista = Array.isArray(listaTopicos) ? listaTopicos : (typeof topicos !== 'undefined' ? topicos : []);
        } else {
            chaveAlvo = _normalizarChave(chaveOuDocTipo);
            lista = Array.isArray(listaTopicos) ? listaTopicos : (typeof topicos !== 'undefined' ? topicos : []);
        }

        return lista.filter(t => {
            const temVinculo = Array.isArray(t.vinculosGerais)
                && t.vinculosGerais.some(v => _normalizarChave(v) === chaveAlvo);
            if (!temVinculo) return false;
            const temProprio = Array.isArray(t.marcosExtracao)
                && t.marcosExtracao.some(m => _gerarChave(m.docTipo, m.polo) === chaveAlvo);
            return !temProprio;
        }).length;
    }

    function reset() {
        _marcosGerais = [];
        _autoVincularSet.clear();
        _forcarDestinoGeral = false;
        _ultimoDestinoId = null;
        _ultimoMarcoInicio = null;
        clearTimeout(_confirmacaoTimer);
        fecharModal();
        atualizarIndicadoresUI();
    }

    function salvarMarco(payload) {
        const polo = _normalizarPolo(payload.polo);
        _marcosGerais = _marcosGerais.filter(
            m => !(m.docTipo === payload.docTipo && m.fronteira === payload.fronteira && _normalizarPolo(m.polo) === polo)
        );
        _marcosGerais.push({ ...payload, polo });
        atualizarIndicadoresUI();
    }

    function registrarUltimoMarcoSalvo(destinoId, docTipo, docLabel, fronteira, polo = 'Comum') {
        const poloNorm = _normalizarPolo(polo);
        _ultimoDestinoId = destinoId;

        if (fronteira === 'inicio') {
            _ultimoMarcoInicio = { destinoId, docTipo, docLabel: docLabel || null, polo: poloNorm };
        } else if (
            fronteira === 'fim' &&
            _ultimoMarcoInicio &&
            _ultimoMarcoInicio.destinoId === destinoId &&
            _ultimoMarcoInicio.docTipo === docTipo &&
            _normalizarPolo(_ultimoMarcoInicio.polo) === poloNorm
        ) {
            _ultimoMarcoInicio = null;
        }
    }

    function consumirSugestaoProximaMarcacao(listaTopicos, activeTabId) {
        const topicosValidos = Array.isArray(listaTopicos) ? listaTopicos : [];
        const existeDestino = (id) => id === GENERAL_ID || topicosValidos.some(t => t.id === id);

        if (_forcarDestinoGeral) {
            _forcarDestinoGeral = false;
            if (_ultimoMarcoInicio && _ultimoMarcoInicio.destinoId === GENERAL_ID) {
                const { docTipo, docLabel, polo } = _ultimoMarcoInicio;
                const poloNorm = _normalizarPolo(polo);
                const aindaTemInicio = _marcosGerais.some(
                    m => m.docTipo === docTipo && _normalizarPolo(m.polo) === poloNorm && m.fronteira === 'inicio'
                );
                const jaTemFim = _marcosGerais.some(
                    m => m.docTipo === docTipo && _normalizarPolo(m.polo) === poloNorm && m.fronteira === 'fim'
                );
                if (aindaTemInicio && !jaTemFim) {
                    return { destinoId: GENERAL_ID, docTipo, docLabel, polo: poloNorm, fronteira: 'fim' };
                }
                _ultimoMarcoInicio = null;
            }
            return { destinoId: GENERAL_ID, docTipo: null, docLabel: null, polo: 'Comum', fronteira: 'inicio' };
        }

        if (_ultimoMarcoInicio && existeDestino(_ultimoMarcoInicio.destinoId)) {
            const { destinoId, docTipo, docLabel, polo } = _ultimoMarcoInicio;
            const poloNorm = _normalizarPolo(polo);
            const marcosDoDestino = destinoId === GENERAL_ID
                ? _marcosGerais
                : (topicosValidos.find(t => t.id === destinoId)?.marcosExtracao || []);

            const jaTemFim = marcosDoDestino.some(
                m => m.docTipo === docTipo && _normalizarPolo(m.polo) === poloNorm && m.fronteira === 'fim'
            );
            const aindaTemInicio = marcosDoDestino.some(
                m => m.docTipo === docTipo && _normalizarPolo(m.polo) === poloNorm && m.fronteira === 'inicio'
            );

            if (aindaTemInicio && !jaTemFim) {
                return { destinoId, docTipo, docLabel, polo: poloNorm, fronteira: 'fim' };
            }
            _ultimoMarcoInicio = null;
        }

        let destinoPadrao = GENERAL_ID;
        if (topicosValidos.length > 0) {
            if (_ultimoDestinoId && existeDestino(_ultimoDestinoId)) {
                destinoPadrao = _ultimoDestinoId;
            } else {
                destinoPadrao = activeTabId && existeDestino(activeTabId) ? activeTabId : GENERAL_ID;
            }
        }

        return { destinoId: destinoPadrao, docTipo: null, docLabel: null, polo: 'Comum', fronteira: 'inicio' };
    }

    function obterPecasAgrupadas() {
        return window.JurisPecas
            ? JurisPecas.agruparPares(_marcosGerais, _obterTotalPaginasPdf())
            : [];
    }

    function atualizarIndicadoresUI() {
        const pecas = obterPecasAgrupadas();
        const totalProntas = pecas.filter(p => p.completa && !p.invalida).length;
        const totalGrupos = pecas.length;

        const btnTrigger = document.getElementById('btn-abrir-extrator-geral');
        const badge = document.getElementById('badge-count-geral');

        if (badge) badge.textContent = String(totalProntas > 0 ? totalProntas : totalGrupos);
        if (btnTrigger) {
            btnTrigger.classList.toggle('has-items', totalGrupos > 0);
            btnTrigger.title = totalGrupos > 0
                ? `Peças Gerais: ${totalProntas} pronta(s) de ${totalGrupos} marcada(s). Clique para gerenciar, exportar ou vincular.`
                : 'Abrir Peças Gerais do Processo (nenhuma peça marcada ainda)';
        }

        if (typeof window.atualizarVisibilidadeBotaoExportar === 'function') {
            window.atualizarVisibilidadeBotaoExportar();
        }
    }

    function _avaliarStatusNoTopico(topico, chavePeca) {
        if (!topico) return 'sem_topico';
        const chaveNorm = _normalizarChave(chavePeca);
        const temProprio = Array.isArray(topico.marcosExtracao)
            && topico.marcosExtracao.some(m => _gerarChave(m.docTipo, m.polo) === chaveNorm);
        if (temProprio) return 'proprio';
        const temVinculo = Array.isArray(topico.vinculosGerais)
            && topico.vinculosGerais.some(v => _normalizarChave(v) === chaveNorm);
        return temVinculo ? 'vinculado' : 'disponivel';
    }

    /**
     * Contabiliza separadamente peças exportáveis (todas marcadas) e vinculáveis (apenas status === 'disponivel'),
     * evitando habilitar "Vincular" para peças que já pertencem ou têm marcação própria no tópico ativo.
     */
    function _atualizarBotoesRodape() {
        const marcadas = Array.from(document.querySelectorAll('#extrator-geral-list .geral-peca-chk:checked'));
        const qtdExportaveis = marcadas.length;
        const qtdVinculaveis = marcadas.filter(chk => chk.dataset.statusTopico === 'disponivel').length;
        const topicoAtivo = _obterTopicoAtivo();

        const btnExportar = document.getElementById('btn-exportar-geral-txt');
        const btnVincular = document.getElementById('btn-incorporar-geral-topico');
        const lblVincular = document.getElementById('btn-incorporar-geral-label');

        if (btnExportar) {
            btnExportar.disabled = qtdExportaveis === 0;
            btnExportar.textContent = qtdExportaveis > 0
                ? `📥 Exportar Peças Gerais (${qtdExportaveis})`
                : '📥 Exportar Peças Gerais (.txt)';
        }

        if (btnVincular) {
            btnVincular.disabled = qtdVinculaveis === 0 || !topicoAtivo;
            if (!topicoAtivo) {
                btnVincular.title = 'Crie e selecione uma análise de embargo para vincular peças';
            } else if (qtdExportaveis > 0 && qtdVinculaveis === 0) {
                btnVincular.title = 'As peças marcadas já estão vinculadas ou possuem marcação própria neste tópico (mas podem ser exportadas pelo botão ao lado)';
            } else {
                btnVincular.title = `Vincula ${qtdVinculaveis} peça(s) em "${topicoAtivo.nome}" (vínculo vivo com Peças Gerais)`;
            }
        }

        if (lblVincular) {
            if (!topicoAtivo) {
                lblVincular.textContent = 'Vincular (Sem tópico ativo)';
            } else {
                const nomeCurto = topicoAtivo.nome.length > 22
                    ? topicoAtivo.nome.slice(0, 22) + '…'
                    : topicoAtivo.nome;
                lblVincular.textContent = qtdVinculaveis > 0
                    ? `Vincular (${qtdVinculaveis}) em "${nomeCurto}"`
                    : `Vincular em "${nomeCurto}"`;
            }
        }
    }

    function _registrarEventosListaUmaVez() {
        if (_eventosModalRegistrados) return;
        const listEl = document.getElementById('extrator-geral-list');
        if (!listEl) return;

        listEl.addEventListener('change', (e) => {
            if (e.target.classList.contains('geral-peca-chk')) {
                _atualizarBotoesRodape();
            }
        });

        listEl.addEventListener('click', (e) => {
            const btnAuto = e.target.closest('[data-geral-action="toggle-auto"]');
            if (btnAuto) {
                e.preventDefault();
                e.stopPropagation();
                toggleAutoVincular(btnAuto.dataset.pecaChave);
                return;
            }

            const btnBorracha = e.target.closest('[data-geral-action="borracha"]');
            if (btnBorracha) {
                e.preventDefault();
                e.stopPropagation();
                if (window.ExportManager && typeof ExportManager.abrirModalFiltro === 'function') {
                    ExportManager.abrirModalFiltro(
                        btnBorracha.dataset.docTipo,
                        btnBorracha.dataset.docNome,
                        {
                            onAfterSave: () => renderizarListaModal(),
                            chavePeca: btnBorracha.dataset.pecaChave
                        }
                    );
                }
                return;
            }

            const btnDel = e.target.closest('[data-geral-action="excluir-marco"]');
            if (btnDel) {
                e.preventDefault();
                e.stopPropagation();
                solicitarExclusaoMarco(
                    btnDel.dataset.docTipo,
                    btnDel.dataset.polo || 'Comum',
                    btnDel.dataset.fronteira,
                    btnDel
                );
            }
        });

        _eventosModalRegistrados = true;
    }

    function toggleAutoVincular(chavePeca) {
        if (!chavePeca) return;
        const chaveNorm = _normalizarChave(chavePeca);
        if (_autoVincularSet.has(chaveNorm)) {
            _autoVincularSet.delete(chaveNorm);
            exibirToast('Auto-vínculo em novos tópicos de embargo desativado para esta peça.', 'info');
        } else {
            _autoVincularSet.add(chaveNorm);
            exibirToast('Auto-vínculo ativado: novos tópicos de embargo já nascerão ligados a esta peça!', 'sucesso');
        }
        renderizarListaModal();
        if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
    }

    function solicitarExclusaoMarco(docTipo, polo, fronteira, btnEl) {
        const poloNorm = _normalizarPolo(polo);
        const chavePeca = _gerarChave(docTipo, poloNorm);
        const fronteiraLabel = fronteira === 'inicio' ? 'INÍCIO' : 'FIM';
        const chaveConfirm = `${chavePeca}::${fronteira}`;

        if (btnEl.dataset.confirming === chaveConfirm) {
            clearTimeout(_confirmacaoTimer);
            _marcosGerais = _marcosGerais.filter(
                m => !(m.docTipo === docTipo && _normalizarPolo(m.polo) === poloNorm && m.fronteira === fronteira)
            );

            const aindaExisteNoGeral = _marcosGerais.some(
                m => _gerarChave(m.docTipo, m.polo) === chavePeca
            );
            if (!aindaExisteNoGeral) {
                _autoVincularSet.delete(chavePeca);
                if (typeof topicos !== 'undefined' && Array.isArray(topicos)) {
                    topicos.forEach(t => {
                        if (Array.isArray(t.vinculosGerais)) {
                            t.vinculosGerais = t.vinculosGerais.filter(v => _normalizarChave(v) !== chavePeca);
                        }
                    });
                }
            }

            exibirToast(`Marco de ${fronteiraLabel} removido de Peças Gerais.`, 'sucesso');
            atualizarIndicadoresUI();
            renderizarListaModal();
            if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
            if (window.atualizarStatusBotaoExtrator) window.atualizarStatusBotaoExtrator();
            if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();

            const hubModal = document.getElementById('modal-exportacao-avancada');
            if (hubModal && hubModal.style.display !== 'none' && window.ExportManager) {
                ExportManager.abrirPainelExportacao();
            }
            return;
        }

        btnEl.dataset.confirming = chaveConfirm;
        btnEl.classList.add('is-confirming-delete');
        const qtdVinculados = contarVinculos(chavePeca);
        const avisoVinculos = qtdVinculados > 0 ? ` (vinculada a ${qtdVinculados} tópico(s)!)` : '';
        exibirToast(`Clique novamente no alfinete para confirmar a exclusão do ${fronteiraLabel}${avisoVinculos}.`, 'aviso');

        clearTimeout(_confirmacaoTimer);
        _confirmacaoTimer = setTimeout(() => {
            if (document.body.contains(btnEl)) {
                delete btnEl.dataset.confirming;
                btnEl.classList.remove('is-confirming-delete');
            }
        }, 3500);
    }

    function renderizarListaModal() {
        const listEl = document.getElementById('extrator-geral-list');
        const bannerEl = document.getElementById('extrator-geral-topic-context');
        if (!listEl) return;

        const topicoAtivo = _obterTopicoAtivo();

        if (bannerEl) {
            bannerEl.innerHTML = topicoAtivo
                ? `<strong>Análise de Embargo Ativa:</strong> ${_escapar(topicoAtivo.nome)}.<br>Peças vinculadas mantêm <strong>ligação viva</strong> com Peças Gerais: qualquer ajuste aqui reflete automaticamente em todos os tópicos vinculados.`
                : `<strong>Modo Independente (Sem tópico ativo):</strong> Gerencie e exporte a Decisão Embargada, Embargos e peças de confronto em <code>.txt</code>. Ao criar uma análise, você poderá vinculá-las em 1 clique.`;
        }

        const pecas = obterPecasAgrupadas();

        if (pecas.length === 0) {
            listEl.innerHTML = `
                <div class="extrator-geral-empty">
                    <span>Nenhuma peça marcada em <strong>Peças Gerais</strong> ainda.</span>
                    <span style="font-size: 0.76rem; color: #64748b;">Use o botão <strong>Alfinete</strong> no PDF e selecione <strong>"Peças Gerais (Processo)"</strong> para demarcar a Decisão Embargada, Embargos ou peças de confronto reutilizáveis em múltiplos vícios.</span>
                    <button type="button" class="btn-geral-marcar-pdf" onclick="GeneralPinsManager.iniciarMarcacaoDireta()">📍 Marcar Peça no PDF Agora</button>
                </div>`;
            _atualizarBotoesRodape();
            return;
        }

        const formatarFolha = (marco) => {
            if (!marco) return '—';
            const lbl = (window.PdfEngine && typeof PdfEngine.getDisplayLabel === 'function')
                ? PdfEngine.getDisplayLabel(marco.pagina)
                : marco.pagina;
            return `fl. ${lbl}`;
        };

        const svgPin = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M16 11.78L20.24 16H13v6l-1 2-1-2v-6H3.76L8 11.78V4h1V2h6v2h1v7.78z"></path></svg>`;
        const svgEraser = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;

        listEl.innerHTML = pecas.map(peca => {
            const podeSelecionar = peca.completa && !peca.invalida;
            const statusTopico = topicoAtivo ? _avaliarStatusNoTopico(topicoAtivo, peca.chave) : 'sem_topico';
            const qtdVinculos = contarVinculos(peca.chave);
            const isAuto = _autoVincularSet.has(peca.chave);
            const hasRegraFiltro = Boolean(window.ExportManager?.temRegraFiltro?.(peca.docTipo, peca.chave));

            let statusPill = '';
            if (peca.invalida) {
                statusPill = `<span class="extrator-geral-status-pill extrator-geral-status-pill--incomplete" title="${_escapar(peca.motivoInvalida)}">⚠️ Fora do PDF atual</span>`;
            } else if (!peca.completa) {
                statusPill = `<span class="extrator-geral-status-pill extrator-geral-status-pill--incomplete">⚠️ ${!peca.inicio ? 'Falta Início' : 'Falta Fim'}</span>`;
            } else if (statusTopico === 'vinculado') {
                statusPill = `<span class="extrator-geral-status-pill extrator-geral-status-pill--linked">🔗 Vinculada ao tópico</span>`;
            } else if (statusTopico === 'proprio') {
                statusPill = `<span class="extrator-geral-status-pill extrator-geral-status-pill--conflict">📌 Tópico usa marcação própria</span>`;
            }

            const resumoFolhas = peca.invalida
                ? peca.motivoInvalida
                : (peca.completa
                    ? `Fls. ${formatarFolha(peca.inicio)} a ${formatarFolha(peca.fim)}${qtdVinculos > 0 ? ` · Usada em ${qtdVinculos} tópico(s)` : ''}`
                    : `Início: ${formatarFolha(peca.inicio)} | Fim: ${formatarFolha(peca.fim)}`);

            const chaveAttr = _escapar(peca.chave);
            const docTipoAttr = _escapar(peca.docTipo);
            const poloAttr = _escapar(peca.polo);
            const docNomeAttr = _escapar(peca.nome);

            // Pré-marca APENAS peças prontas disponíveis para vínculo (ou todas prontas sem tópico ativo)
            const preMarcar = podeSelecionar && (statusTopico === 'disponivel' || statusTopico === 'sem_topico');
            const checkedAttr = preMarcar ? 'checked' : '';

            return `
            <label class="extrator-geral-card ${podeSelecionar ? '' : 'is-incomplete'}">
                <input type="checkbox" class="geral-peca-chk" value="${chaveAttr}" data-status-topico="${statusTopico}" ${podeSelecionar ? checkedAttr : 'disabled'}>
                <div class="extrator-geral-card-info">
                    <div class="extrator-geral-card-title">
                        <span>${docNomeAttr}</span>
                        ${statusPill}
                    </div>
                    <span class="extrator-geral-card-meta">${_escapar(resumoFolhas)}</span>
                </div>
                <div class="export-pin-controls">
                    <button type="button" class="btn-geral-auto-link ${isAuto ? 'is-active' : ''}"
                            data-geral-action="toggle-auto" data-peca-chave="${chaveAttr}"
                            aria-pressed="${isAuto ? 'true' : 'false'}"
                            title="${isAuto ? 'Auto-vínculo ATIVO: novos tópicos de embargo já nascem ligados a esta peça' : 'Ativar auto-vínculo desta peça em todo novo tópico criado'}">
                        ⚡ Auto
                    </button>
                    <button type="button" class="pin-eraser-btn ${hasRegraFiltro ? 'is-active' : ''}"
                            data-geral-action="borracha" data-doc-tipo="${docTipoAttr}" data-peca-chave="${chaveAttr}" data-doc-nome="${docNomeAttr}"
                            title="Borracha Inteligente (LGPD / Cabeçalhos repetidos)">
                        ${svgEraser}
                    </button>
                    <button type="button" class="pin-action-btn ${peca.inicio ? 'pin-start-active' : 'pin-missing'}"
                            data-geral-action="excluir-marco" data-doc-tipo="${docTipoAttr}" data-polo="${poloAttr}" data-fronteira="inicio"
                            title="${peca.inicio ? `Excluir marco de INÍCIO (${formatarFolha(peca.inicio)})` : 'Marco de INÍCIO não definido'}"
                            ${peca.inicio ? '' : 'disabled'}>
                        ${svgPin}
                    </button>
                    <button type="button" class="pin-action-btn ${peca.fim ? 'pin-end-active' : 'pin-missing'}"
                            data-geral-action="excluir-marco" data-doc-tipo="${docTipoAttr}" data-polo="${poloAttr}" data-fronteira="fim"
                            title="${peca.fim ? `Excluir marco de FIM (${formatarFolha(peca.fim)})` : 'Marco de FIM não definido'}"
                            ${peca.fim ? '' : 'disabled'}>
                        ${svgPin}
                    </button>
                </div>
            </label>`;
        }).join('');

        _atualizarBotoesRodape();
    }

    function abrirModal() {
        _registrarEventosListaUmaVez();
        renderizarListaModal();

        const backdrop = document.getElementById('extrator-geral-backdrop');
        const modal = document.getElementById('modal-extrator-geral');
        if (backdrop) {
            backdrop.style.display = 'block';
            requestAnimationFrame(() => backdrop.classList.add('is-visible'));
        }
        if (modal) modal.style.display = 'flex';
    }

    function fecharModal() {
        clearTimeout(_confirmacaoTimer);
        const backdrop = document.getElementById('extrator-geral-backdrop');
        const modal = document.getElementById('modal-extrator-geral');
        if (backdrop) {
            backdrop.classList.remove('is-visible');
            backdrop.style.display = 'none';
        }
        if (modal) modal.style.display = 'none';
    }

    function iniciarMarcacaoDireta() {
        fecharModal();
        if (window.ExportManager && typeof ExportManager.fecharPainelExportacao === 'function') {
            ExportManager.fecharPainelExportacao();
        }
        _forcarDestinoGeral = true;
        if (typeof trocarAba === 'function') trocarAba('leitura');
        requestAnimationFrame(() => {
            if (typeof window.iniciarMarcadorExtracao === 'function') {
                window.iniciarMarcadorExtracao();
            }
        });
    }

    function selecionarTodas(marcar) {
        document.querySelectorAll('#extrator-geral-list .geral-peca-chk:not(:disabled)').forEach(chk => {
            chk.checked = Boolean(marcar);
        });
        _atualizarBotoesRodape();
    }

    function vincularNoTopicoAtivo() {
        const topicoAtivo = _obterTopicoAtivo();
        if (!topicoAtivo) {
            exibirToast('Selecione ou crie uma análise de embargo antes de vincular.', 'aviso');
            return;
        }

        // Vincula apenas checkboxes marcadas que estejam efetivamente disponíveis no tópico
        const chavesDisponiveis = Array.from(
            document.querySelectorAll('#extrator-geral-list .geral-peca-chk:checked[data-status-topico="disponivel"]')
        ).map(chk => _normalizarChave(chk.value));

        if (chavesDisponiveis.length === 0) {
            exibirToast('Nenhuma nova peça disponível selecionada para vincular.', 'aviso');
            return;
        }

        if (!Array.isArray(topicoAtivo.vinculosGerais)) topicoAtivo.vinculosGerais = [];
        const mapaPecas = new Map(obterPecasAgrupadas().map(p => [p.chave, p]));
        const existentesNorm = new Set(topicoAtivo.vinculosGerais.map(v => _normalizarChave(v)));
        let vinculadas = 0;

        chavesDisponiveis.forEach(chave => {
            const peca = mapaPecas.get(chave);
            if (!peca || !peca.completa || peca.invalida) return;
            if (!existentesNorm.has(chave)) {
                topicoAtivo.vinculosGerais.push(chave);
                existentesNorm.add(chave);
                vinculadas++;
            }
        });

        if (vinculadas === 0) return;

        fecharModal();
        if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
        if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
        if (window.atualizarStatusBotaoExtrator) window.atualizarStatusBotaoExtrator();

        if (window.ExportManager && typeof ExportManager.abrirPainelExportacao === 'function') {
            ExportManager.abrirPainelExportacao();
        }
        atualizarIndicadoresUI();

        exibirToast(`${vinculadas} peça(s) vinculada(s) a "${topicoAtivo.nome}" (ligação viva com Peças Gerais).`, 'sucesso');
    }

    function desvincularDoTopico(topicoId, chaveOuDocTipo, poloOpcional = null) {
        if (typeof topicos === 'undefined') return;
        const topico = topicos.find(t => t.id === topicoId);
        if (!topico || !Array.isArray(topico.vinculosGerais)) return;

        const chaveAlvo = _normalizarChave(chaveOuDocTipo, poloOpcional);
        topico.vinculosGerais = topico.vinculosGerais.filter(v => _normalizarChave(v) !== chaveAlvo);

        exibirToast('Peça desvinculada deste tópico (permanece salva em Peças Gerais).', 'sucesso');
        if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
        if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
        if (window.atualizarStatusBotaoExtrator) window.atualizarStatusBotaoExtrator();
        if (window.ExportManager && typeof ExportManager.abrirPainelExportacao === 'function') {
            ExportManager.abrirPainelExportacao();
        }
    }

    async function exportarPecasSelecionadas() {
        const chavesSelecionadas = Array.from(
            document.querySelectorAll('#extrator-geral-list .geral-peca-chk:checked')
        ).map(chk => _normalizarChave(chk.value));

        if (chavesSelecionadas.length === 0) {
            exibirToast('Selecione ao menos uma peça pronta para exportar.', 'aviso');
            return;
        }

        if (!window.ExportManager || typeof ExportManager.gerarExportacaoGeral !== 'function') {
            exibirToast('Motor de exportação indisponível.', 'erro');
            return;
        }

        fecharModal();
        await ExportManager.gerarExportacaoGeral(chavesSelecionadas);
    }

    return {
        GENERAL_ID,
        VIRTUAL_TOPIC,
        getMarcos,
        setMarcos,
        getAutoVincular,
        setAutoVincular,
        obterVinculosIniciaisParaNovoTopico,
        contarVinculos,
        reset,
        salvarMarco,
        registrarUltimoMarcoSalvo,
        consumirSugestaoProximaMarcacao,
        obterPecasAgrupadas,
        atualizarIndicadoresUI,
        renderizarListaModal,
        toggleAutoVincular,
        abrirModal,
        fecharModal,
        iniciarMarcacaoDireta,
        selecionarTodas,
        vincularNoTopicoAtivo,
        desvincularDoTopico,
        exportarPecasSelecionadas
    };
})();