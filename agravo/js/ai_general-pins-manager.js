/* ================================================
   ai_general-pins-manager.js — v1.1 (Agravo de Instrumento)
   Repositório Geral de Peças Processuais (Aba Oculta)
   Modelo Referencial: topico.vinculosGerais[] -> metadata.marcosExtracaoGerais[]
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
    let _autoVincularSet = new Set();
    let _forcarDestinoGeral = false;
    let _ultimoDestinoId = null;
    let _ultimoMarcoInicio = null; // { destinoId, docTipo, docLabel }
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

    function _notificar(mensagem, tipo = 'info') {
        if (typeof exibirToast === 'function') {
            exibirToast(mensagem, tipo);
        }
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
            ? lista.filter(m => m && m.docTipo && m.fronteira).map(m => ({ ...m }))
            : [];
        atualizarIndicadoresUI();
    }

    function getAutoVincular() {
        return Array.from(_autoVincularSet);
    }

    function setAutoVincular(lista) {
        _autoVincularSet = new Set(Array.isArray(lista) ? lista.filter(Boolean) : []);
    }

    function obterVinculosIniciaisParaNovoTopico() {
        const existentes = new Set(_marcosGerais.map(m => m.docTipo));
        return Array.from(_autoVincularSet).filter(dt => existentes.has(dt));
    }

    function contarVinculos(docTipo, listaTopicos = null) {
        const lista = Array.isArray(listaTopicos) ? listaTopicos : (typeof topicos !== 'undefined' ? topicos : []);
        return lista.filter(t => {
            const temVinculo = Array.isArray(t.vinculosGerais) && t.vinculosGerais.includes(docTipo);
            if (!temVinculo) return false;
            const temProprio = Array.isArray(t.marcosExtracao) && t.marcosExtracao.some(m => m.docTipo === docTipo);
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
        _marcosGerais = _marcosGerais.filter(
            m => !(m.docTipo === payload.docTipo && m.fronteira === payload.fronteira)
        );
        _marcosGerais.push({ ...payload });
        atualizarIndicadoresUI();
    }

    function registrarUltimoMarcoSalvo(destinoId, docTipo, docLabel, fronteira) {
        _ultimoDestinoId = destinoId;
        if (fronteira === 'inicio') {
            _ultimoMarcoInicio = { destinoId, docTipo, docLabel: docLabel || null };
        } else if (
            fronteira === 'fim' &&
            _ultimoMarcoInicio &&
            _ultimoMarcoInicio.destinoId === destinoId &&
            _ultimoMarcoInicio.docTipo === docTipo
        ) {
            _ultimoMarcoInicio = null;
        }
    }

    function consumirSugestaoProximaMarcacao(listaTopicos, activeTabId) {
        const topicosValidos = Array.isArray(listaTopicos) ? listaTopicos : [];
        const existeDestino = (id) => id === GENERAL_ID || topicosValidos.some(t => t.id === id);

        if (_forcarDestinoGeral) {
            _forcarDestinoGeral = false;
            const parAbertoGeral = (_ultimoMarcoInicio && _ultimoMarcoInicio.destinoId === GENERAL_ID)
                ? _ultimoMarcoInicio
                : null;
            return {
                destinoId: GENERAL_ID,
                docTipo: parAbertoGeral ? parAbertoGeral.docTipo : null,
                docLabel: parAbertoGeral ? parAbertoGeral.docLabel : null,
                fronteira: parAbertoGeral ? 'fim' : 'inicio'
            };
        }

        if (_ultimoMarcoInicio && existeDestino(_ultimoMarcoInicio.destinoId)) {
            const { destinoId, docTipo, docLabel } = _ultimoMarcoInicio;
            const marcosDoDestino = destinoId === GENERAL_ID
                ? _marcosGerais
                : (topicosValidos.find(t => t.id === destinoId)?.marcosExtracao || []);
            const jaTemFim = marcosDoDestino.some(m => m.docTipo === docTipo && m.fronteira === 'fim');
            const aindaTemInicio = marcosDoDestino.some(m => m.docTipo === docTipo && m.fronteira === 'inicio');

            if (aindaTemInicio && !jaTemFim) {
                return { destinoId, docTipo, docLabel, fronteira: 'fim' };
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

        return { destinoId: destinoPadrao, docTipo: null, docLabel: null, fronteira: 'inicio' };
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

    function _avaliarStatusNoTopico(topico, docTipo) {
        if (!topico) return 'sem_topico';
        const temProprio = Array.isArray(topico.marcosExtracao) && topico.marcosExtracao.some(m => m.docTipo === docTipo);
        if (temProprio) return 'proprio';
        const temVinculo = Array.isArray(topico.vinculosGerais) && topico.vinculosGerais.includes(docTipo);
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
                btnVincular.title = 'Crie e selecione um tópico recursal para vincular peças';
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
                toggleAutoVincular(btnAuto.dataset.docTipo);
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
                        { onAfterSave: () => renderizarListaModal() }
                    );
                }
                return;
            }

            const btnDel = e.target.closest('[data-geral-action="excluir-marco"]');
            if (btnDel) {
                e.preventDefault();
                e.stopPropagation();
                solicitarExclusaoMarco(btnDel.dataset.docTipo, btnDel.dataset.fronteira, btnDel);
            }
        });

        _eventosModalRegistrados = true;
    }

    function toggleAutoVincular(docTipo) {
        if (!docTipo) return;
        if (_autoVincularSet.has(docTipo)) {
            _autoVincularSet.delete(docTipo);
            _notificar('Auto-vínculo em novos tópicos desativado para esta peça.', 'info');
        } else {
            _autoVincularSet.add(docTipo);
            _notificar('Auto-vínculo ativado: novos tópicos já nascerão ligados a esta peça!', 'sucesso');
        }
        renderizarListaModal();
        if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
    }

    function solicitarExclusaoMarco(docTipo, fronteira, btnEl) {
        const fronteiraLabel = fronteira === 'inicio' ? 'INÍCIO' : 'FIM';
        const chave = `${docTipo}::${fronteira}`;

        if (btnEl.dataset.confirming === chave) {
            clearTimeout(_confirmacaoTimer);
            _marcosGerais = _marcosGerais.filter(m => !(m.docTipo === docTipo && m.fronteira === fronteira));

            const aindaExisteNoGeral = _marcosGerais.some(m => m.docTipo === docTipo);
            if (!aindaExisteNoGeral) {
                _autoVincularSet.delete(docTipo);
                if (typeof topicos !== 'undefined' && Array.isArray(topicos)) {
                    topicos.forEach(t => {
                        if (Array.isArray(t.vinculosGerais)) {
                            t.vinculosGerais = t.vinculosGerais.filter(dt => dt !== docTipo);
                        }
                    });
                }
            }

            _notificar(`Marco de ${fronteiraLabel} removido de Peças Gerais.`, 'sucesso');
            atualizarIndicadoresUI();
            renderizarListaModal();
            if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
            if (window.atualizarStatusBotaoExtrator) window.atualizarStatusBotaoExtrator();
            if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();

            const hubModal = document.getElementById('modal-exportacao-avancada');
            if (hubModal && hubModal.style.display !== 'none' && window.ExportManager) {
                ExportManager.abrirPainelExportacao({ pularGuardrail: true });
            }
            return;
        }

        // Garante que apenas um alfinete permaneça em estado de confirmação por vez
        document.querySelectorAll('#extrator-geral-list .pin-action-btn.is-confirming-delete').forEach(el => {
            if (el !== btnEl) {
                delete el.dataset.confirming;
                el.classList.remove('is-confirming-delete');
            }
        });

        btnEl.dataset.confirming = chave;
        btnEl.classList.add('is-confirming-delete');
        const qtdVinculados = contarVinculos(docTipo);
        const avisoVinculos = qtdVinculados > 0 ? ` (vinculada a ${qtdVinculados} tópico(s)!)` : '';
        _notificar(`Clique novamente no alfinete para confirmar a exclusão do ${fronteiraLabel}${avisoVinculos}.`, 'aviso');

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
                ? `<strong>Tópico Recursal Ativo:</strong> ${_escapar(topicoAtivo.nome)}.<br>Peças vinculadas mantêm <strong>ligação viva</strong> com Peças Gerais: qualquer ajuste aqui reflete automaticamente em todos os tópicos vinculados.`
                : `<strong>Modo Independente (Sem tópico ativo):</strong> Gerencie e exporte as peças essenciais do processo em <code>.txt</code>. Ao criar um tópico, você poderá vinculá-las em 1 clique.`;
        }

        const pecas = obterPecasAgrupadas();

        if (pecas.length === 0) {
            listEl.innerHTML = `
                <div class="extrator-geral-empty">
                    <span>Nenhuma peça marcada em <strong>Peças Gerais</strong> ainda.</span>
                    <span style="font-size: 0.76rem; color: #64748b;">Use o botão <strong>Alfinete</strong> no PDF e selecione <strong>"Peças Gerais (Processo)"</strong> para demarcar peças reutilizáveis em múltiplos tópicos.</span>
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
            const statusTopico = topicoAtivo ? _avaliarStatusNoTopico(topicoAtivo, peca.docTipo) : 'sem_topico';
            const qtdVinculos = contarVinculos(peca.docTipo);
            const isAuto = _autoVincularSet.has(peca.docTipo);
            const hasRegraFiltro = Boolean(window.ExportManager?.temRegraFiltro?.(peca.docTipo));

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

            const docTipoAttr = _escapar(peca.docTipo);
            const docNomeAttr = _escapar(peca.nome);
            const folhaInicioSeguro = _escapar(formatarFolha(peca.inicio));
            const folhaFimSeguro = _escapar(formatarFolha(peca.fim));

            // Pré-marca APENAS peças prontas que estejam disponíveis para vínculo (ou todas prontas se não houver tópico)
            const preMarcar = podeSelecionar && (statusTopico === 'disponivel' || statusTopico === 'sem_topico');
            const checkedAttr = preMarcar ? 'checked' : '';

            return `
            <label class="extrator-geral-card ${podeSelecionar ? '' : 'is-incomplete'}">
                <input type="checkbox" class="geral-peca-chk" value="${docTipoAttr}" data-status-topico="${statusTopico}" ${podeSelecionar ? checkedAttr : 'disabled'}>
                <div class="extrator-geral-card-info">
                    <div class="extrator-geral-card-title">
                        <span>${docNomeAttr}</span>
                        ${statusPill}
                    </div>
                    <span class="extrator-geral-card-meta">${_escapar(resumoFolhas)}</span>
                </div>
                <div class="export-pin-controls">
                    <button type="button" class="btn-geral-auto-link ${isAuto ? 'is-active' : ''}"
                            data-geral-action="toggle-auto" data-doc-tipo="${docTipoAttr}"
                            aria-pressed="${isAuto ? 'true' : 'false'}"
                            title="${isAuto ? 'Auto-vínculo ATIVO: novos tópicos já nascem ligados a esta peça' : 'Ativar auto-vínculo desta peça em todo tópico novo criado'}">
                        ⚡ Auto
                    </button>
                    <button type="button" class="pin-eraser-btn ${hasRegraFiltro ? 'is-active' : ''}"
                            data-geral-action="borracha" data-doc-tipo="${docTipoAttr}" data-doc-nome="${docNomeAttr}"
                            title="Borracha Mágica (LGPD / Cabeçalhos repetidos)">
                        ${svgEraser}
                    </button>
                    <button type="button" class="pin-action-btn ${peca.inicio ? 'pin-start-active' : 'pin-missing'}"
                            data-geral-action="excluir-marco" data-doc-tipo="${docTipoAttr}" data-fronteira="inicio"
                            title="${peca.inicio ? `Excluir marco de INÍCIO (${folhaInicioSeguro})` : 'Marco de INÍCIO não definido'}"
                            ${peca.inicio ? '' : 'disabled'}>
                        ${svgPin}
                    </button>
                    <button type="button" class="pin-action-btn ${peca.fim ? 'pin-end-active' : 'pin-missing'}"
                            data-geral-action="excluir-marco" data-doc-tipo="${docTipoAttr}" data-fronteira="fim"
                            title="${peca.fim ? `Excluir marco de FIM (${folhaFimSeguro})` : 'Marco de FIM não definido'}"
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
            _notificar('Selecione ou crie um tópico recursal antes de vincular.', 'aviso');
            return;
        }

        // Vincula apenas checkboxes marcadas que estejam efetivamente disponíveis no tópico
        const docTiposDisponiveis = Array.from(
            document.querySelectorAll('#extrator-geral-list .geral-peca-chk:checked[data-status-topico="disponivel"]')
        ).map(chk => chk.value);

        if (docTiposDisponiveis.length === 0) {
            _notificar('Nenhuma nova peça disponível selecionada para vincular.', 'aviso');
            return;
        }

        if (!Array.isArray(topicoAtivo.vinculosGerais)) topicoAtivo.vinculosGerais = [];
        const mapaPecas = new Map(obterPecasAgrupadas().map(p => [p.docTipo, p]));
        let vinculadas = 0;

        docTiposDisponiveis.forEach(docTipo => {
            const peca = mapaPecas.get(docTipo);
            if (!peca || !peca.completa || peca.invalida) return;
            if (!topicoAtivo.vinculosGerais.includes(docTipo)) {
                topicoAtivo.vinculosGerais.push(docTipo);
                vinculadas++;
            }
        });

        if (vinculadas === 0) return;

        fecharModal();
        if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
        if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
        if (window.atualizarStatusBotaoExtrator) window.atualizarStatusBotaoExtrator();

        if (window.ExportManager && typeof ExportManager.abrirPainelExportacao === 'function') {
            ExportManager.abrirPainelExportacao({ pularGuardrail: true });
        }
        atualizarIndicadoresUI();

        _notificar(`${vinculadas} peça(s) vinculada(s) a "${topicoAtivo.nome}" (ligação viva com Peças Gerais).`, 'sucesso');
    }

    function desvincularDoTopico(topicoId, docTipo) {
        if (typeof topicos === 'undefined') return;
        const topico = topicos.find(t => t.id === topicoId);
        if (!topico || !Array.isArray(topico.vinculosGerais)) return;

        topico.vinculosGerais = topico.vinculosGerais.filter(dt => dt !== docTipo);

        _notificar('Peça desvinculada deste tópico (permanece salva em Peças Gerais).', 'sucesso');
        if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
        if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
        if (window.atualizarStatusBotaoExtrator) window.atualizarStatusBotaoExtrator();
        if (window.ExportManager && typeof ExportManager.abrirPainelExportacao === 'function') {
            ExportManager.abrirPainelExportacao({ pularGuardrail: true });
        }
    }

    async function exportarPecasSelecionadas() {
        const docTiposSelecionados = Array.from(
            document.querySelectorAll('#extrator-geral-list .geral-peca-chk:checked')
        ).map(chk => chk.value);

        if (docTiposSelecionados.length === 0) {
            _notificar('Selecione ao menos uma peça pronta para exportar.', 'aviso');
            return;
        }

        if (!window.ExportManager || typeof ExportManager.gerarExportacaoGeral !== 'function') {
            _notificar('Motor de exportação indisponível.', 'erro');
            return;
        }

        fecharModal();
        await ExportManager.gerarExportacaoGeral(docTiposSelecionados);
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