/* ================================================
   ferramentas/juris-pangea.js
   Controlador Compartilhado PangeaGAB (Zero CDN no Boot + Lazy Store/Collector)
   ================================================ */

/* SSOT de versionamento de cache: herda exatamente o ?v=... definido no HTML */
const MODULE_QUERY = new URL(import.meta.url).search;
const STORAGE_FILTER_KEY = 'juris_pangea_collector_cfg_v2';
const DEFAULT_CFG = { orgao: 'TRT23', localId: 3138, siglaLocal: 'GABRC', especies: '' };
const EXCERPT_MAX_CHARS = 280;

let storeModPromise = null;
let collectorModPromise = null;

function carregarStoreMod() {
    if (!storeModPromise) {
        storeModPromise = import(`./juris-pangea-store.js${MODULE_QUERY}`).catch((err) => {
            storeModPromise = null; /* permite nova tentativa caso o CDN volte */
            throw err;
        });
    }
    return storeModPromise;
}

function carregarCollectorMod() {
    if (!collectorModPromise) {
        collectorModPromise = import(`./juris-pangea-collector.js${MODULE_QUERY}`).catch((err) => {
            collectorModPromise = null;
            throw err;
        });
    }
    return collectorModPromise;
}

let modelos = [];
let searchIndex = new Map();
let metaAtual = null;
let currentViewingModel = null;
let pendingDiffPlan = null;
let lastTriggerElement = null;
let isSyncing = false;
let onlyFavorites = false;
let selectedSpecies = 'ALL';
let sortMode = 'numero_desc';
let searchDebounceTimer = null;

const AI_MAX_CATALOGO_CHARS = 9500;
const AI_TOP_COM_TRECHO_TESE = 20;
const AI_INICIO_TESE_CHARS = 90;
const AI_FIM_TESE_CHARS = 95;
const AI_MAX_RESULTADOS = 12;

const AI_STOPWORDS_PT = new Set([
    'que', 'com', 'por', 'para', 'dos', 'das', 'nos', 'nas', 'aos', 'uma', 'uns', 'umas',
    'pelo', 'pela', 'pelos', 'pelas', 'como', 'mais', 'menos', 'muito', 'muita', 'entre',
    'sobre', 'apos', 'antes', 'desde', 'contra', 'sem', 'sob', 'ate', 'ainda', 'tambem',
    'apenas', 'quando', 'onde', 'qual', 'quais', 'este', 'esta', 'estes', 'estas', 'esse',
    'essa', 'esses', 'essas', 'isso', 'isto', 'seu', 'sua', 'seus', 'suas', 'ser', 'sao',
    'foi', 'foram', 'seja', 'estao', 'tem', 'ter', 'pode', 'deve', 'nao', 'sim', 'mas',
    'porem', 'contudo', 'portanto', 'logo', 'pois', 'porque', 'caso', 'assim', 'mesmo',
    'outro', 'outra', 'todo', 'toda', 'cada', 'algum', 'nenhum',
    'processo', 'autos', 'recurso', 'recursais', 'recorrente', 'recorrido', 'recorrida',
    'reclamante', 'reclamada', 'autor', 'autora', 'reu', 'parte', 'partes', 'sentenca',
    'acordao', 'decisao', 'juizo', 'tribunal', 'turma', 'vara', 'relator', 'acao',
    'pedido', 'pedidos', 'inicial', 'contestacao', 'merito', 'topico', 'folha', 'folhas',
    'fls', 'art', 'artigo', 'lei', 'clt', 'cpc', 'direito', 'justica', 'trabalho',
    'trabalhista', 'alega', 'alegacoes', 'requer', 'postula', 'pugna', 'sustenta',
    'fato', 'fatos', 'prova', 'provas', 'modelo', 'modelos', 'tese', 'teses', 'questao'
]);

let aiFilterIds = null;
let aiMatchMeta = new Map();
let aiFilterTopicId = null;
let aiFilterTopicNome = '';
let aiFilterContextHash = null;
let aiFilterStale = false;
let aiFilterSummary = '';
let isAiSearching = false;
let aiSearchRequestId = 0;
let sortModeBeforeAi = null;

const getEl = (id) => document.getElementById(id);

function carregarConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_FILTER_KEY);
        if (raw) return { ...DEFAULT_CFG, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULT_CFG };
}

function salvarConfig(cfg) {
    try { localStorage.setItem(STORAGE_FILTER_KEY, JSON.stringify(cfg)); } catch {}
}

function normalizeText(str = '') {
    return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function reconstruirIndice(lista) {
    searchIndex = new Map();
    lista.forEach(m => {
        const teseStr = String(m.tese || '').trim();
        const excerpt = teseStr.length > EXCERPT_MAX_CHARS
            ? teseStr.slice(0, EXCERPT_MAX_CHARS).trimEnd() + '…'
            : teseStr;

        searchIndex.set(m.id, {
            numNorm: normalizeText(`${m.siglaLocal || ''} ${m.especie || ''} ${m.numero ?? ''}`),
            titleNorm: normalizeText(`${m.questao || ''} ${m.tituloOficial || ''}`),
            tagsNorm: normalizeText(Array.isArray(m.etiquetas) ? m.etiquetas.join(' ') : ''),
            teseNorm: normalizeText(teseStr),
            excerpt
        });
    });
}

function verificarSessaoVisual() {
    const btnLogin = getEl('btn-login-user');
    if (btnLogin && !btnLogin.classList.contains('is-logged-in')) {
        if (window.exibirToast) window.exibirToast('Você precisa estar conectado à nuvem.', 'aviso');
        btnLogin.click();
        return false;
    }
    return true;
}

async function copiarConteudoModelo(textoPuro, htmlFormatado = null) {
    if (htmlFormatado && navigator.clipboard && typeof window.ClipboardItem === 'function' && window.isSecureContext) {
        try {
            const item = new ClipboardItem({
                'text/html': new Blob([htmlFormatado], { type: 'text/html' }),
                'text/plain': new Blob([textoPuro], { type: 'text/plain' })
            });
            await navigator.clipboard.write([item]);
            return;
        } catch {}
    }

    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textoPuro);
        return;
    }

    const ta = document.createElement('textarea');
    ta.value = textoPuro;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Falha ao copiar para a área de transferência.');
}

function formatarDataSync(ts) {
    if (!ts) return 'Nenhuma sincronização realizada ainda';
    try {
        const dt = new Date(ts);
        return `Última sincronização: ${dt.toLocaleDateString('pt-BR')} às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
        return 'Sincronizado';
    }
}

function atualizarCabecalhoMeta() {
    const cfg = carregarConfig();
    const chipOrgao = getEl('pg-chip-orgao');
    const chipLocal = getEl('pg-chip-local');
    const chipEspecie = getEl('pg-chip-especie');
    const metaEl = getEl('pg-sync-meta');

    if (chipOrgao) chipOrgao.textContent = metaAtual?.orgao || cfg.orgao;
    if (chipLocal) {
        const sigla = metaAtual?.siglaLocal || cfg.siglaLocal;
        const localId = metaAtual?.localId ?? cfg.localId;
        chipLocal.textContent = `${sigla} · #${localId}`;
    }
    if (chipEspecie) {
        const esp = metaAtual?.especiesFiltro;
        if (Array.isArray(esp) && esp.length > 0) {
            chipEspecie.textContent = esp.join(', ');
            chipEspecie.style.display = 'inline-block';
        } else {
            chipEspecie.style.display = 'none';
        }
    }
    if (metaEl) {
        metaEl.textContent = metaAtual?.ultimaSincronizacao
            ? `${formatarDataSync(metaAtual.ultimaSincronizacao)} · ${modelos.length} item${modelos.length === 1 ? '' : 'ns'} ativo${modelos.length === 1 ? '' : 's'}`
            : 'Nenhum modelo sincronizado na nuvem ainda';
    }
}

function renderizarFiltroEspecies() {
    const bar = getEl('pg-species-filter-bar');
    if (!bar) return;

    const especies = Array.from(new Set(modelos.map(m => m.especie).filter(e => e && e !== 'DESCONHECIDA'))).sort();
    if (especies.length <= 1) {
        selectedSpecies = 'ALL';
        bar.style.display = 'none';
        bar.innerHTML = '';
        return;
    }

    if (selectedSpecies !== 'ALL' && !especies.includes(selectedSpecies)) {
        selectedSpecies = 'ALL';
    }

    bar.style.display = 'inline-flex';
    bar.innerHTML = [
        `<button type="button" class="pg-species-btn ${selectedSpecies === 'ALL' ? 'is-active' : ''}" data-species="ALL">Todas</button>`,
        ...especies.map(sp =>
            `<button type="button" class="pg-species-btn ${selectedSpecies === sp ? 'is-active' : ''}" data-species="${escapeHtml(sp)}">${escapeHtml(sp)}</button>`
        )
    ].join('');
}

function sortModels(list) {
    return [...list].sort((a, b) => {
        if (sortMode === 'relevancia_ia' && aiFilterIds) {
            const rankA = aiMatchMeta.get(a.id)?.rank ?? Number.MAX_SAFE_INTEGER;
            const rankB = aiMatchMeta.get(b.id)?.rank ?? Number.MAX_SAFE_INTEGER;
            if (rankA !== rankB) return rankA - rankB;
        }

        const favA = Boolean(a.favorite);
        const favB = Boolean(b.favorite);
        if (favA !== favB) return favA ? -1 : 1;

        if (sortMode === 'alfabetica') {
            return (searchIndex.get(a.id)?.titleNorm || '').localeCompare(searchIndex.get(b.id)?.titleNorm || '', 'pt-BR');
        }
        const numA = typeof a.numero === 'number' ? a.numero : -1;
        const numB = typeof b.numero === 'number' ? b.numero : -1;
        if (numA !== numB) {
            return sortMode === 'numero_asc' ? numA - numB : numB - numA;
        }
        return (searchIndex.get(a.id)?.titleNorm || '').localeCompare(searchIndex.get(b.id)?.titleNorm || '', 'pt-BR');
    });
}

function renderList(items, contentMatchIds = null) {
    const listEl = getEl('pg-list');
    const counterEl = getEl('pg-result-counter');
    if (!listEl) return;

    if (counterEl) counterEl.textContent = `${items.length} modelo${items.length === 1 ? '' : 's'}`;

    if (modelos.length === 0) {
        listEl.innerHTML = `
            <div class="pg-empty-state">
                <h4>Nenhum modelo do PangeaGAB sincronizado</h4>
                <p>Clique em <strong>Sincronizar</strong> para gerar o coletor do seu gabinete (TRT23 · GABRC · #3138) e importar os modelos com prévia de segurança.</p>
                <button type="button" class="pg-btn-primary" onclick="window.PangeaGabController?.openSyncModal()">↻ Abrir Sincronização</button>
            </div>
        `;
        return;
    }

    if (items.length === 0) {
        if (aiFilterIds) {
            listEl.innerHTML = `
                <div class="pg-empty-state">
                    <h4>Nenhum modelo da seleção IA corresponde aos filtros atuais</h4>
                    <p>Limpe a busca textual, ajuste os filtros de favoritos/espécie ou remova o filtro inteligente para exibir todo o acervo.</p>
                    <button type="button" class="pg-btn-secondary" onclick="window.PangeaGabController?.limparFiltroIA()">Limpar filtro IA</button>
                </div>
            `;
            return;
        }
        listEl.innerHTML = `
            <div class="pg-empty-state">
                <h4>Nenhum modelo encontrado</h4>
                <p>Altere o termo de busca ou ajuste os filtros de favoritos/espécie.</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = items.map(m => {
        const idx = searchIndex.get(m.id);
        const badgeTexto = m.numero !== null && m.numero !== undefined
            ? `${m.siglaLocal || 'GABRC'} ${m.numero}`
            : (m.siglaLocal || 'MODELO');
        const speciesTag = m.especie && m.especie !== 'DESCONHECIDA'
            ? `<span class="pg-species-tag">${escapeHtml(m.especie)}</span>`
            : '';
        const isFav = Boolean(m.favorite);
        const badgeMatch = contentMatchIds && contentMatchIds.has(m.id)
            ? `<span class="pg-badge-match" title="Termo encontrado no teor interno">Contém no texto</span>`
            : '';

        const aiMeta = aiFilterIds ? aiMatchMeta.get(m.id) : null;
        const aiRankBadge = aiMeta
            ? `<span class="pg-ai-rank-badge" title="Ordem de afinidade identificada pela IA">✦ #${escapeHtml(String(aiMeta.rank))}</span>`
            : '';
        const aiReasonHtml = (aiMeta && aiMeta.motivo)
            ? `<div class="pg-ai-reason">${escapeHtml(aiMeta.motivo)}</div>`
            : '';

        return `
            <div class="pg-card${aiMeta ? ' is-ai-recommended' : ''}" data-model-id="${escapeHtml(m.id)}">
                <div class="pg-card-info">
                    <div class="pg-card-head">
                        ${aiRankBadge}
                        <span class="pg-num-badge">${escapeHtml(badgeTexto)}</span>
                        ${speciesTag}
                        <button type="button" class="pg-card-title" data-action="view" title="${escapeHtml(m.tituloOficial || m.questao)}">${escapeHtml(m.questao)}</button>
                        ${badgeMatch}
                    </div>
                    ${aiReasonHtml}
                    <div class="pg-card-excerpt">${escapeHtml(idx ? idx.excerpt : '')}</div>
                </div>
                <div class="pg-card-actions">
                    <button type="button" class="pg-icon-btn pg-fav ${isFav ? 'is-fav' : ''}" data-action="fav" aria-pressed="${isFav}" title="${isFav ? 'Remover dos favoritos' : 'Favoritar modelo'}">
                        <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    </button>
                    <button type="button" class="pg-icon-btn pg-view" data-action="view" title="Visualizar modelo completo">
                        <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    </button>
                    <button type="button" class="pg-icon-btn pg-copy" data-action="copy" title="Copiar modelo (Shift+Clique inclui a Questão)">
                        <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function filter() {
    const rawTerm = getEl('pg-search')?.value || '';
    const normTerm = normalizeText(rawTerm);

    const pool = modelos.filter(m => {
        if (aiFilterIds && !aiFilterIds.has(m.id)) return false;
        if (onlyFavorites && !m.favorite) return false;
        if (selectedSpecies !== 'ALL' && m.especie !== selectedSpecies) return false;
        return true;
    });

    if (!normTerm) {
        renderList(sortModels(pool));
        return;
    }

    const numMatches = [];
    const titleMatches = [];
    const contentMatches = [];
    const contentMatchIds = new Set();

    pool.forEach(m => {
        const idx = searchIndex.get(m.id);
        if (!idx) return;

        const inNum = m.numero !== null && (String(m.numero) === normTerm || idx.numNorm.includes(normTerm));
        if (inNum) {
            numMatches.push(m);
        } else if (idx.titleNorm.includes(normTerm) || idx.tagsNorm.includes(normTerm)) {
            titleMatches.push(m);
        } else if (idx.teseNorm.includes(normTerm)) {
            contentMatches.push(m);
            contentMatchIds.add(m.id);
        }
    });

    renderList(
        [...sortModels(numMatches), ...sortModels(titleMatches), ...sortModels(contentMatches)],
        contentMatchIds
    );
}

async function abrirModal() {
    if (!verificarSessaoVisual()) return;

    getEl('backdrop-pangea-gab')?.classList.add('active');
    const modal = getEl('modal-pangea-gab');
    if (modal) {
        modal.style.display = 'flex';
        modal.removeAttribute('aria-hidden');
    }

    sincronizarInvalidacaoFiltroIA(false);
    atualizarBannerFiltroIA();
    atualizarBotaoBuscaIA();

    const listEl = getEl('pg-list');
    if (listEl) {
        listEl.innerHTML = `<div style="text-align: center; padding: 2rem; color: #64748b;">⏳ Conectando à nuvem...</div>`;
    }

    try {
        const { PangeaStore } = await carregarStoreMod();
        const res = await PangeaStore.carregar();
        if (!res.autenticado) {
            if (listEl) listEl.innerHTML = `<div class="pg-empty-state"><h4>Sessão não autenticada</h4><p>Faça login na nuvem do Juris Notes para acessar o acervo PangeaGAB.</p></div>`;
            atualizarBotaoBuscaIA();
            return;
        }
        modelos = res.modelos;
        metaAtual = res.meta;
        reconstruirIndice(modelos);
        atualizarCabecalhoMeta();
        renderizarFiltroEspecies();
        sincronizarInvalidacaoFiltroIA(true);
        atualizarBannerFiltroIA();
        atualizarBotaoBuscaIA();
        filter();
        requestAnimationFrame(() => getEl('pg-search')?.focus());
    } catch (error) {
        console.error('PangeaGAB [Erro ao carregar]:', error);
        atualizarBotaoBuscaIA();
        if (listEl) {
            listEl.innerHTML = `<div class="pg-empty-state"><h4>Falha ao carregar da nuvem</h4><p>${escapeHtml(error.message || 'Verifique sua conexão e as Security Rules do Firestore.')}</p></div>`;
        }
    }
}

function fecharModalPrincipal() {
    if (isAiSearching) {
        aiSearchRequestId++;
        isAiSearching = false;
        atualizarBotaoBuscaIA();
        atualizarBannerFiltroIA();
    }
    getEl('backdrop-pangea-gab')?.classList.remove('active');
    const modal = getEl('modal-pangea-gab');
    if (modal) modal.style.display = 'none';
}

function openViewModal(id, triggerEl = null) {
    const model = modelos.find(m => m.id === id);
    if (!model) return;
    currentViewingModel = model;
    lastTriggerElement = triggerEl || document.activeElement;

    getEl('modal-pangea-gab')?.setAttribute('aria-hidden', 'true');
    getEl('pg-view-badge').textContent = model.numero !== null ? `${model.siglaLocal || 'GABRC'} ${model.numero}` : (model.siglaLocal || 'MODELO');
    getEl('pg-view-title').textContent = model.tituloOficial || model.questao;
    getEl('pg-view-questao').textContent = model.questao || '';
    getEl('pg-view-tese').textContent = model.tese || '';

    const tagsEl = getEl('pg-view-tags');
    if (tagsEl) {
        const pills = [];
        if (model.especie && model.especie !== 'DESCONHECIDA') pills.push(`<span class="pg-tag-pill">${escapeHtml(model.especie)}</span>`);
        if (Array.isArray(model.etiquetas)) {
            model.etiquetas.forEach(t => pills.push(`<span class="pg-tag-pill">#${escapeHtml(t)}</span>`));
        }
        tagsEl.innerHTML = pills.join('');
    }

    const extLink = getEl('pg-view-external-link');
    if (extLink) {
        if (model.urlPangea) {
            extLink.href = model.urlPangea;
            extLink.style.display = 'inline-flex';
        } else {
            extLink.style.display = 'none';
        }
    }

    getEl('backdrop-pangea-view')?.classList.add('active');
    const modal = getEl('modal-pangea-view');
    if (modal) modal.style.display = 'flex';
}

function closeViewModal() {
    currentViewingModel = null;
    getEl('backdrop-pangea-view')?.classList.remove('active');
    const modal = getEl('modal-pangea-view');
    if (modal) modal.style.display = 'none';
    getEl('modal-pangea-gab')?.removeAttribute('aria-hidden');
    if (lastTriggerElement && document.contains(lastTriggerElement)) {
        lastTriggerElement.focus();
    }
    lastTriggerElement = null;
}

function invalidarPreviaDiff() {
    pendingDiffPlan = null;
    const box = getEl('pg-diff-preview-box');
    const btnConfirm = getEl('pg-btn-confirm-sync');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    if (btnConfirm) {
        btnConfirm.disabled = true;
        const sp = btnConfirm.querySelector('span');
        if (sp) sp.textContent = '✓ Confirmar Gravação';
    }
}

function lerConfigDoForm() {
    return {
        orgao: (getEl('pg-cfg-orgao')?.value || 'TRT23').trim().toUpperCase(),
        localId: parseInt(getEl('pg-cfg-local')?.value, 10) || 3138,
        siglaLocal: (getEl('pg-cfg-sigla-local')?.value || 'GABRC').trim().toUpperCase(),
        especies: (getEl('pg-cfg-especies')?.value || '').trim().toUpperCase()
    };
}

async function montarConfigCompletaColetor() {
    const cfg = lerConfigDoForm();
    salvarConfig(cfg);
    let idKeys = ['id'];
    try {
        const { PANGEA_SCHEMA } = await carregarStoreMod();
        idKeys = [...PANGEA_SCHEMA.id];
    } catch {}
    return { ...cfg, idKeys };
}

async function atualizarBookmarklet(mostrarAvisoReinstalar = false) {
    try {
        const [{ gerarBookmarkletHref }, cfgCompleta] = await Promise.all([
            carregarCollectorMod(),
            montarConfigCompletaColetor()
        ]);
        const link = getEl('pg-bookmarklet-link');
        if (link) {
            link.href = gerarBookmarkletHref(cfgCompleta);
            link.textContent = `↻ Coletar PangeaGAB (${cfgCompleta.siglaLocal})`;
        }
        const warn = getEl('pg-bookmarklet-dirty-warn');
        if (warn && mostrarAvisoReinstalar) warn.style.display = 'block';
    } catch (err) {
        console.error('PangeaGAB [Erro ao gerar bookmarklet]:', err);
    }
}

async function openSyncModal() {
    if (isAiSearching) {
        aiSearchRequestId++;
        isAiSearching = false;
        atualizarBotaoBuscaIA();
        atualizarBannerFiltroIA();
    }
    lastTriggerElement = document.activeElement;
    getEl('modal-pangea-gab')?.setAttribute('aria-hidden', 'true');

    const cfg = carregarConfig();
    if (getEl('pg-cfg-orgao')) getEl('pg-cfg-orgao').value = cfg.orgao;
    if (getEl('pg-cfg-local')) getEl('pg-cfg-local').value = cfg.localId;
    if (getEl('pg-cfg-sigla-local')) getEl('pg-cfg-sigla-local').value = cfg.siglaLocal;
    if (getEl('pg-cfg-especies')) getEl('pg-cfg-especies').value = cfg.especies;
    if (getEl('pg-bookmarklet-dirty-warn')) getEl('pg-bookmarklet-dirty-warn').style.display = 'none';

    if (getEl('pg-sync-json-input')) getEl('pg-sync-json-input').value = '';
    if (getEl('pg-sync-file-input')) getEl('pg-sync-file-input').value = '';
    if (getEl('pg-sync-full-mode')) getEl('pg-sync-full-mode').checked = false;
    if (getEl('pg-sync-preview-status')) {
        getEl('pg-sync-preview-status').className = 'pg-sync-preview-status';
        getEl('pg-sync-preview-status').textContent = 'Aguardando pacote de dados...';
    }
    if (getEl('pg-sync-schema-hint')) getEl('pg-sync-schema-hint').style.display = 'none';
    invalidarPreviaDiff();

    getEl('backdrop-pangea-sync')?.classList.add('active');
    getEl('modal-pangea-sync').style.display = 'flex';
    await atualizarBookmarklet(false);
}

function closeSyncModal(recarregarLista = false) {
    invalidarPreviaDiff();
    getEl('backdrop-pangea-sync')?.classList.remove('active');
    getEl('modal-pangea-sync').style.display = 'none';
    getEl('modal-pangea-gab')?.removeAttribute('aria-hidden');

    if (recarregarLista) {
        reconstruirIndice(modelos);
        atualizarCabecalhoMeta();
        renderizarFiltroEspecies();
        limparFiltroIA(true);
        atualizarBotaoBuscaIA();
        filter();
    }
    if (lastTriggerElement && document.contains(lastTriggerElement)) {
        lastTriggerElement.focus();
    }
    lastTriggerElement = null;
}

function parsePacoteEntrada(rawText) {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
        return {
            completo: false,
            modoTexto: 'nao_verificado',
            evidenciaIntegralidade: { confirmadaFase0: false },
            totalInformado: null,
            filtro: {},
            resultados: parsed
        };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.resultados)) {
        return parsed;
    }
    throw new Error('JSON não reconhecido: esperado objeto com campo "resultados" (gerado pelo coletor).');
}

function atualizarStatusEntrada(rawText) {
    invalidarPreviaDiff();
    const status = getEl('pg-sync-preview-status');
    const hint = getEl('pg-sync-schema-hint');
    const fullChk = getEl('pg-sync-full-mode');
    const fullLbl = getEl('pg-sync-full-label');
    if (!status) return;

    const trimmed = (rawText || '').trim();
    if (!trimmed) {
        status.className = 'pg-sync-preview-status';
        status.textContent = 'Aguardando pacote de dados...';
        if (hint) hint.style.display = 'none';
        return;
    }

    try {
        const pacote = parsePacoteEntrada(trimmed);
        const completoOk = Boolean(
            pacote.completo === true &&
            !pacote.erroParcial &&
            typeof pacote.totalInformado === 'number' &&
            pacote.totalInformado === pacote.resultados.length
        );
        status.className = 'pg-sync-preview-status is-valid';
        status.textContent = `✓ Pacote lido: ${pacote.resultados.length} item(ns) · ${completoOk ? 'Coleta completa confirmada' : 'Coleta parcial/avulsa (arquivamento bloqueado)'}.`;

        if (fullChk && fullLbl) {
            fullChk.disabled = !completoOk;
            if (!completoOk) fullChk.checked = false;
            fullLbl.classList.toggle('is-disabled', !completoOk);
        }
        if (hint && pacote.resultados[0] && typeof pacote.resultados[0] === 'object') {
            hint.textContent = `Chaves no 1º item: ${Object.keys(pacote.resultados[0]).join(', ')}`;
            hint.style.display = 'block';
        }
    } catch (err) {
        status.className = 'pg-sync-preview-status is-error';
        status.textContent = `✕ ${err.message}`;
        if (hint) hint.style.display = 'none';
    }
}

async function analisarDiferencas() {
    if (isSyncing || !verificarSessaoVisual()) return;
    const rawText = (getEl('pg-sync-json-input')?.value || '').trim();
    if (!rawText) {
        if (window.exibirToast) window.exibirToast('Importe ou cole o pacote JSON antes de analisar.', 'aviso');
        return;
    }

    let pacote;
    try {
        pacote = parsePacoteEntrada(rawText);
    } catch (err) {
        if (window.exibirToast) window.exibirToast(err.message, 'erro');
        return;
    }

    const btnAnalyze = getEl('pg-btn-analyze-sync');
    const permitirArquivamento = Boolean(getEl('pg-sync-full-mode')?.checked);

    try {
        if (btnAnalyze) { btnAnalyze.disabled = true; btnAnalyze.textContent = '⏳ Analisando...'; }
        const { PangeaStore } = await carregarStoreMod();
        const plano = await PangeaStore.calcularDiff(pacote, { permitirArquivamento });
        pendingDiffPlan = plano;

        const box = getEl('pg-diff-preview-box');
        if (box) {
            const avisosHtml = plano.avisos.map(a => `<div class="pg-diff-warning">⚠️ ${escapeHtml(a)}</div>`).join('');
            const itensListados = [
                ...plano.detalhes.novos.map(i => `<div><strong>+ Novo:</strong> ${escapeHtml(i.questao)}</div>`),
                ...plano.detalhes.atualizados.map(i => `<div><strong>✎ Alterado:</strong> ${escapeHtml(i.questao)}</div>`),
                ...plano.detalhes.aArquivar.map(i => `<div style="color:#991b1b;"><strong>⊘ Arquivar:</strong> ${escapeHtml(i.questao || i.id)}</div>`)
            ];

            box.innerHTML = `
                <div class="pg-diff-pills">
                    <span class="pg-diff-pill pg-diff-pill--new">+ ${plano.resumo.novos} novo(s)</span>
                    <span class="pg-diff-pill pg-diff-pill--upd">✎ ${plano.resumo.atualizados} alterado(s)</span>
                    <span class="pg-diff-pill pg-diff-pill--eq">= ${plano.resumo.inalterados} inalterado(s)</span>
                    ${plano.resumo.arquivados > 0 ? `<span class="pg-diff-pill pg-diff-pill--arc">⊘ ${plano.resumo.arquivados} a arquivar</span>` : ''}
                </div>
                ${avisosHtml}
                <div class="pg-diff-list">
                    ${itensListados.length > 0 ? itensListados.join('') : '<div>Nenhuma alteração pendente — sua base já está idêntica ao pacote.</div>'}
                </div>
            `;
            box.style.display = 'block';
        }

        const btnConfirm = getEl('pg-btn-confirm-sync');
        if (btnConfirm) {
            const totalOps = plano.operacoes.length;
            btnConfirm.disabled = totalOps === 0;
            const sp = btnConfirm.querySelector('span');
            if (sp) {
                sp.textContent = totalOps === 0
                    ? '✓ Base já atualizada'
                    : (plano.resumo.arquivados > 0
                        ? `✓ Confirmar Gravação (${totalOps} ops · ${plano.resumo.arquivados} arquiv.)`
                        : `✓ Confirmar Gravação (${totalOps} alterações)`);
            }
        }
    } catch (error) {
        invalidarPreviaDiff();
        if (window.exibirToast) window.exibirToast(error.message || 'Falha na validação do pacote.', 'erro');
    } finally {
        if (btnAnalyze) { btnAnalyze.disabled = false; btnAnalyze.textContent = '🔍 Analisar Diferenças'; }
    }
}

async function confirmarSincronizacao() {
    if (isSyncing || !pendingDiffPlan || !verificarSessaoVisual()) return;

    const btnConfirm = getEl('pg-btn-confirm-sync');
    try {
        isSyncing = true;
        if (btnConfirm) { btnConfirm.disabled = true; btnConfirm.querySelector('span').textContent = '⏳ Gravando...'; }

        const { PangeaStore } = await carregarStoreMod();
        const resumo = await PangeaStore.aplicarDiff(pendingDiffPlan);
        const recarregado = await PangeaStore.carregar(true);
        modelos = recarregado.modelos;
        metaAtual = recarregado.meta;

        closeSyncModal(true);
        if (window.exibirToast) {
            window.exibirToast(
                `Sincronizado: +${resumo.novos} novos, ✎${resumo.atualizados} atualizados, =${resumo.inalterados} mantidos${resumo.arquivados ? `, ⊘${resumo.arquivados} arquivados` : ''}.`,
                'sucesso'
            );
        }
    } catch (error) {
        console.error('PangeaGAB [Erro ao gravar]:', error);
        if (window.exibirToast) window.exibirToast(error.message || 'Falha ao gravar no Firebase.', 'erro');
    } finally {
        isSyncing = false;
    }
}

async function colarPacoteClipboard() {
    try {
        if (!navigator.clipboard?.readText) throw new Error('Leitura bloqueada. Use Ctrl+V ou Importar .json.');
        const texto = await navigator.clipboard.readText();
        const ta = getEl('pg-sync-json-input');
        if (ta) { ta.value = texto; atualizarStatusEntrada(texto); }
    } catch (err) {
        if (window.exibirToast) window.exibirToast(err.message || 'Use Ctrl+V na caixa de texto.', 'aviso');
        getEl('pg-sync-json-input')?.focus();
    }
}

async function copiarScriptColetor() {
    try {
        const [{ gerarScriptConsole }, cfgCompleta] = await Promise.all([
            carregarCollectorMod(),
            montarConfigCompletaColetor()
        ]);
        await copiarConteudoModelo(gerarScriptConsole(cfgCompleta), null);
        if (window.exibirToast) window.exibirToast('Script coletor copiado! Cole no Console (F12) do PangeaGAB.', 'sucesso');
    } catch {
        if (window.exibirToast) window.exibirToast('Falha ao copiar script.', 'erro');
    }
}

async function copiarModeloPorId(id, incluirQuestao = false) {
    const model = modelos.find(m => m.id === id);
    if (!model) return;

    const textoPuro = incluirQuestao
        ? `${model.questao}\n\n${model.tese}`.trim()
        : String(model.tese || '').trim();

    const htmlFormatado = model.teseHtml
        ? (incluirQuestao ? `<p><strong>${escapeHtml(model.questao)}</strong></p>${model.teseHtml}` : model.teseHtml)
        : null;

    try {
        await copiarConteudoModelo(textoPuro, htmlFormatado);
        const cardEl = document.querySelector(`#pg-list .pg-card[data-model-id="${CSS.escape(id)}"]`);
        if (cardEl) {
            cardEl.classList.add('just-copied-flash');
            clearTimeout(cardEl._flashTimer);
            cardEl._flashTimer = setTimeout(() => cardEl.classList.remove('just-copied-flash'), 1200);
        }
        if (window.exibirToast) {
            const rotulo = model.numero !== null ? `${model.siglaLocal} ${model.numero}` : 'Modelo';
            window.exibirToast(`${rotulo} copiado!`, 'sucesso');
        }
    } catch {
        if (window.exibirToast) window.exibirToast('Não foi possível copiar o modelo.', 'erro');
    }
}

async function toggleFavorite(id) {
    if (isSyncing || !verificarSessaoVisual()) return;
    const idx = modelos.findIndex(m => m.id === id);
    if (idx === -1) return;

    const anterior = Boolean(modelos[idx].favorite);
    modelos[idx].favorite = !anterior;
    filter();

    try {
        const { PangeaStore } = await carregarStoreMod();
        await PangeaStore.atualizarFavorito(id, !anterior);
    } catch {
        modelos[idx].favorite = anterior;
        filter();
        if (window.exibirToast) window.exibirToast('Falha ao atualizar favorito na nuvem.', 'erro');
    }
}

function clearSearch() {
    clearTimeout(searchDebounceTimer);
    const input = getEl('pg-search');
    const btnClear = getEl('pg-btn-clear-search');
    if (input) { input.value = ''; input.focus(); }
    if (btnClear) btnClear.style.display = 'none';
    filter();
}

function garantirOpcaoOrdenacaoIA() {
    const select = getEl('pg-sort-select');
    if (!select) return;
    if (!getEl('pg-sort-opt-ai')) {
        const opt = document.createElement('option');
        opt.id = 'pg-sort-opt-ai';
        opt.value = 'relevancia_ia';
        opt.textContent = 'Relevância (IA)';
        select.insertBefore(opt, select.firstChild);
    }
    select.value = sortMode;
}

function removerOpcaoOrdenacaoIA() {
    const opt = getEl('pg-sort-opt-ai');
    if (opt) opt.remove();
    const select = getEl('pg-sort-select');
    if (select) select.value = sortMode;
}

/**
 * Extrai sinal compacto da abertura e do encerramento da `tese` (onde normalmente reside
 * a conclusão/dispositivo), evitando corte no meio de palavras e sem enviar o inteiro teor.
 */
function extrairSinalTese(teseBruta) {
    const limpo = String(teseBruta || '').replace(/\s+/g, ' ').trim();
    if (!limpo) return '';
    if (limpo.length <= AI_INICIO_TESE_CHARS + AI_FIM_TESE_CHARS) {
        return ` | Teor: ${limpo}`;
    }

    const corteInicio = limpo.slice(0, AI_INICIO_TESE_CHARS);
    const ultimoEspacoInicio = corteInicio.lastIndexOf(' ');
    const inicio = (ultimoEspacoInicio > 45 ? corteInicio.slice(0, ultimoEspacoInicio) : corteInicio).trimEnd();

    const corteFim = limpo.slice(-AI_FIM_TESE_CHARS);
    const primeiroEspacoFim = corteFim.indexOf(' ');
    const fim = (primeiroEspacoFim > 0 && primeiroEspacoFim < 30 ? corteFim.slice(primeiroEspacoFim + 1) : corteFim).trimStart();

    return ` | Início: ${inicio}… | Fim: …${fim}`;
}

/**
 * Pontua modelos localmente reaproveitando `searchIndex` (zero NFD no acervo, tokenização sem
 * pontuação residual) e monta catálogo por teto de caracteres (AI_MAX_CATALOGO_CHARS),
 * enriquecendo os top 20 candidatos com abertura + encerramento da tese.
 */
function montarCatalogoParaIA(contexto) {
    const textoConsulta = [
        contexto.topicoNome || '',
        contexto.alegacoes || '',
        contexto.veredito || '',
        ...(contexto.nosIdeias || []).map(n => `${n.contextoTese || ''} ${n.texto || ''}`)
    ].join(' ');

    const termos = Array.from(new Set(
        normalizeText(textoConsulta)
            .split(/[^a-z0-9]+/)
            .filter(tk => tk.length >= 3 && !AI_STOPWORDS_PT.has(tk))
    ));

    const pontuados = modelos.map(m => {
        const idx = searchIndex.get(m.id);
        const titleNorm = idx?.titleNorm || '';
        const tagsNorm = idx?.tagsNorm || '';
        const teseNorm = idx?.teseNorm || '';

        // Tokenização limpa remove pontuação jurídica (".", ",", ";", ":") antes do lookup exato
        const tokensTitulo = titleNorm ? titleNorm.split(/[^a-z0-9]+/).filter(Boolean) : [];
        const setTitulo = new Set(tokensTitulo);
        const tokensTags = tagsNorm ? tagsNorm.split(/[^a-z0-9]+/).filter(Boolean) : [];
        const setTags = new Set(tokensTags);

        let score = 0;
        for (let i = 0; i < termos.length; i++) {
            const termo = termos[i];
            if (setTitulo.has(termo)) {
                score += 5;
            } else if (termo.length >= 5) {
                const radical = termo.slice(0, 5);
                if (tokensTitulo.some(tk => tk.length >= 5 && tk.startsWith(radical))) {
                    score += 2;
                }
            }
            if (setTags.has(termo) || (termo.length >= 5 && tagsNorm.includes(termo))) {
                score += 4;
            }
            if (teseNorm && teseNorm.includes(termo)) {
                score += 1;
            }
        }
        return { modelo: m, score };
    });

    pontuados.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const favA = a.modelo.favorite ? 1 : 0;
        const favB = b.modelo.favorite ? 1 : 0;
        if (favB !== favA) return favB - favA;
        const numA = typeof a.modelo.numero === 'number' ? a.modelo.numero : -1;
        const numB = typeof b.modelo.numero === 'number' ? b.modelo.numero : -1;
        return numB - numA;
    });

    const catalogo = [];
    let charsAcumulados = 0;

    for (let i = 0; i < pontuados.length; i++) {
        const { modelo: m } = pontuados[i];
        const numeroStr = (m.numero !== null && m.numero !== undefined && m.numero !== '') ? `Nº ${m.numero}` : 'S/N';
        const especieStr = (m.especie && m.especie !== 'DESCONHECIDA') ? ` (${m.especie})` : '';
        const questao = String(m.questao || m.tituloOficial || 'Sem título').replace(/\s+/g, ' ').trim().slice(0, 150);
        const tags = Array.isArray(m.etiquetas)
            ? m.etiquetas.map(t => String(t || '').trim()).filter(Boolean).slice(0, 4).join(', ').slice(0, 60)
            : '';

        let linha = `${numeroStr}${especieStr} | ${questao}`;
        if (tags) linha += ` | Tags: ${tags}`;
        if (i < AI_TOP_COM_TRECHO_TESE && m.tese) {
            linha += extrairSinalTese(m.tese);
        }

        const custoLinha = linha.length + 8;
        if (charsAcumulados + custoLinha > AI_MAX_CATALOGO_CHARS && catalogo.length > 0) {
            break;
        }
        catalogo.push({ id: m.id, linha });
        charsAcumulados += custoLinha;
    }

    const preFiltrado = catalogo.length < modelos.length;
    console.debug(`[PangeaGAB IA] Catálogo preparado: ${catalogo.length}/${modelos.length} modelos (${charsAcumulados} chars, pré-filtrado=${preFiltrado})`);
    return { catalogo, preFiltrado };
}

function atualizarBotaoBuscaIA() {
    const btn = getEl('pg-btn-ai-search');
    if (!btn) return;

    const labelEl = btn.querySelector('.pg-ai-label');
    // Usa getter leve O(N) sem travessia de nós nem cálculo de hash
    const resumoTopico = (window.TopicsManager && typeof window.TopicsManager.obterResumoTopicoAtivo === 'function')
        ? window.TopicsManager.obterResumoTopicoAtivo()
        : null;
    const temAcervo = modelos.length > 0;
    const temFiltroAtivo = Boolean(aiFilterIds && aiFilterIds.size > 0);

    btn.classList.toggle('is-thinking', isAiSearching);
    btn.classList.toggle('is-active', !isAiSearching && temFiltroAtivo);
    btn.setAttribute('aria-busy', isAiSearching ? 'true' : 'false');
    btn.setAttribute('aria-pressed', temFiltroAtivo ? 'true' : 'false');
    btn.disabled = isAiSearching || isSyncing || !temAcervo;

    if (isAiSearching) {
        if (labelEl) labelEl.textContent = 'Analisando...';
        btn.title = 'Analisando Razões Recursais e Nós de Ideias com IA...';
    } else if (!temAcervo) {
        if (labelEl) labelEl.textContent = 'Busca Inteligente';
        btn.title = 'Sincronize os modelos do PangeaGAB antes de usar a busca inteligente';
    } else if (temFiltroAtivo) {
        if (labelEl) labelEl.textContent = `Busca Inteligente (${aiFilterIds.size})`;
        btn.title = `Filtro IA ativo para "${aiFilterTopicNome || 'Tópico Ativo'}" — clique para reexecutar`;
    } else {
        if (labelEl) labelEl.textContent = 'Busca Inteligente';
        btn.title = resumoTopico
            ? `Confrontar "${resumoTopico.topicoNome}" com o acervo PangeaGAB usando IA`
            : 'Buscar modelos compatíveis com o tópico recursal ativo usando IA';
    }
}

function atualizarBannerFiltroIA() {
    const banner = getEl('pg-ai-banner');
    if (!banner) return;

    const textEl = getEl('pg-ai-banner-text');
    const metaEl = getEl('pg-ai-banner-meta');
    const btnRerun = getEl('pg-btn-ai-rerun');
    const btnClear = getEl('pg-btn-ai-clear');
    const temFiltroAtivo = Boolean(aiFilterIds && aiFilterIds.size > 0);

    banner.hidden = !temFiltroAtivo;
    banner.classList.toggle('is-stale', temFiltroAtivo && aiFilterStale);

    if (temFiltroAtivo) {
        const qtd = aiFilterIds.size;
        if (textEl) {
            textEl.textContent = aiFilterStale
                ? `⚠ O tópico "${aiFilterTopicNome || 'Tópico Ativo'}" foi alterado desde esta análise (${qtd} modelo${qtd === 1 ? '' : 's'})`
                : `✦ Seleção IA — ${aiFilterTopicNome || 'Tópico Ativo'} (${qtd} modelo${qtd === 1 ? '' : 's'})`;
        }
        if (metaEl) {
            metaEl.textContent = aiFilterStale
                ? 'Clique em "Reanalisar" para atualizar as sugestões com as edições mais recentes.'
                : (aiFilterSummary || '');
        }
        if (btnRerun) btnRerun.disabled = isAiSearching;
        if (btnClear) btnClear.disabled = isAiSearching;
    } else {
        if (textEl) textEl.textContent = '';
        if (metaEl) metaEl.textContent = '';
    }
}

function sincronizarInvalidacaoFiltroIA(verificarModelos = true) {
    if (!aiFilterIds) return;

    const ctxAtivo = (window.TopicsManager && typeof window.TopicsManager.obterContextoParaBuscaIA === 'function')
        ? window.TopicsManager.obterContextoParaBuscaIA()
        : null;
    const activeTopicId = ctxAtivo?.topicoId || null;

    // Tópico trocado ou processo encerrado: invalida filtro anterior
    if (!activeTopicId || activeTopicId !== aiFilterTopicId) {
        limparFiltroIA(true);
        return;
    }

    // Mesmo tópico editado entre aberturas: preserva resultados e sinaliza defasagem
    aiFilterStale = Boolean(aiFilterContextHash && ctxAtivo.assinaturaContexto !== aiFilterContextHash);

    if (verificarModelos) {
        const idsDisponiveis = new Set(modelos.map(m => m.id));
        for (const id of Array.from(aiFilterIds)) {
            if (!idsDisponiveis.has(id)) {
                aiFilterIds.delete(id);
                aiMatchMeta.delete(id);
            }
        }
        if (aiFilterIds.size === 0) {
            limparFiltroIA(true);
        }
    }
}

function limparFiltroIA(silencioso = false) {
    const tinhaEstadoIA = Boolean(aiFilterIds !== null || sortMode === 'relevancia_ia' || sortModeBeforeAi !== null);

    aiFilterIds = null;
    aiMatchMeta = new Map();
    aiFilterTopicId = null;
    aiFilterTopicNome = '';
    aiFilterContextHash = null;
    aiFilterStale = false;
    aiFilterSummary = '';

    if (tinhaEstadoIA) {
        sortMode = (sortModeBeforeAi && sortModeBeforeAi !== 'relevancia_ia')
            ? sortModeBeforeAi
            : 'numero_desc';
    }
    sortModeBeforeAi = null;

    removerOpcaoOrdenacaoIA();
    atualizarBannerFiltroIA();
    atualizarBotaoBuscaIA();

    if (!silencioso) {
        filter();
    }
}

async function executarBuscaInteligente() {
    if (isAiSearching || isSyncing) return;

    if (modelos.length === 0) {
        window.exibirToast?.('Sincronize os modelos do PangeaGAB antes de usar a busca inteligente.', 'aviso');
        return;
    }
    if (!window.TopicsManager || typeof window.TopicsManager.obterContextoParaBuscaIA !== 'function') {
        window.exibirToast?.('Módulo de tópicos indisponível para leitura do contexto recursal.', 'erro');
        return;
    }
    if (!window.AIRecommendationManager || typeof window.AIRecommendationManager.rankearCatalogoPorContexto !== 'function') {
        window.exibirToast?.('Serviço de Inteligência Artificial indisponível.', 'erro');
        return;
    }

    const contexto = window.TopicsManager.obterContextoParaBuscaIA();
    if (!contexto) {
        window.exibirToast?.('Selecione ou crie um Tópico Recursal na aba Anotações antes de acionar a busca inteligente.', 'aviso');
        return;
    }

    const temAlegacoes = Boolean(contexto.alegacoes);
    const temVeredito = Boolean(contexto.veredito);
    const totalNos = contexto.nosIdeias.length;
    if (!temAlegacoes && !temVeredito && totalNos === 0) {
        window.exibirToast?.(`O tópico "${contexto.topicoNome}" ainda não possui Razões Recursais nem Nós de Ideias válidos para análise.`, 'aviso');
        return;
    }

    const { catalogo, preFiltrado } = montarCatalogoParaIA(contexto);
    if (catalogo.length === 0) {
        window.exibirToast?.('Nenhum modelo elegível foi encontrado para análise.', 'aviso');
        return;
    }

    const reqId = ++aiSearchRequestId;
    isAiSearching = true;
    atualizarBotaoBuscaIA();
    atualizarBannerFiltroIA();

    const fontesLabel = [
        temAlegacoes ? 'Razões' : null,
        temVeredito ? 'Veredito' : null,
        totalNos > 0 ? `${totalNos} nó${totalNos === 1 ? '' : 's'} de ideia` : null
    ].filter(Boolean).join(' + ');

    window.exibirToast?.(`Analisando "${contexto.topicoNome}" (${fontesLabel}) com IA...`, 'info');

    try {
        const resultados = await window.AIRecommendationManager.rankearCatalogoPorContexto({
            contexto,
            catalogo,
            maxResultados: AI_MAX_RESULTADOS
        });

        const modalAberto = getEl('modal-pangea-gab')?.style.display === 'flex';
        const syncAberto = getEl('modal-pangea-sync')?.style.display === 'flex';
        if (reqId !== aiSearchRequestId || !modalAberto || syncAberto) return;

        if (!Array.isArray(resultados) || resultados.length === 0) {
            const tinhaFiltroAnterior = Boolean(aiFilterIds);
            limparFiltroIA(true);
            if (tinhaFiltroAnterior) filter();
            window.exibirToast?.(`Nenhum modelo do PangeaGAB apresentou alta compatibilidade com "${contexto.topicoNome}".`, 'aviso');
            return;
        }

        aiFilterIds = new Set(resultados.map(r => r.id));
        aiMatchMeta = new Map(resultados.map(r => [r.id, { rank: r.rank, motivo: r.motivo || '' }]));
        aiFilterTopicId = contexto.topicoId;
        aiFilterTopicNome = contexto.topicoNome || 'Tópico Ativo';
        aiFilterContextHash = contexto.assinaturaContexto;
        aiFilterStale = false;

        const escopo = preFiltrado
            ? `Pré-filtrados ${catalogo.length} de ${modelos.length} modelos`
            : `${catalogo.length} modelo${catalogo.length === 1 ? '' : 's'} analisado${catalogo.length === 1 ? '' : 's'}`;
        aiFilterSummary = `Confronto: ${fontesLabel} · ${escopo}`;

        clearTimeout(searchDebounceTimer);
        const searchInput = getEl('pg-search');
        const btnClearSearch = getEl('pg-btn-clear-search');
        if (searchInput && searchInput.value !== '') searchInput.value = '';
        if (btnClearSearch) btnClearSearch.style.display = 'none';

        if (sortMode !== 'relevancia_ia') sortModeBeforeAi = sortMode;
        sortMode = 'relevancia_ia';
        garantirOpcaoOrdenacaoIA();

        filter();
        getEl('pg-scroll-body')?.scrollTo({ top: 0, behavior: 'smooth' });

        window.exibirToast?.(
            `${resultados.length} modelo${resultados.length === 1 ? '' : 's'} compatíve${resultados.length === 1 ? 'l encontrado' : 'is encontrados'} pela IA ✨`,
            'sucesso'
        );
    } catch (error) {
        if (reqId !== aiSearchRequestId) return;
        console.warn('PangeaGAB [Erro na Busca Inteligente]:', error);

        const modalIaAberto = getEl('modal-ia-config')?.style.display === 'flex';
        if (error?.code === 'MISSING_API_KEY' || error?.code === 'AUTH_ERROR' || modalIaAberto) {
            fecharModalPrincipal();
            window.exibirToast?.('Configure sua chave de IA e reabra o PangeaGAB para continuar.', 'aviso');
            return;
        }
        window.exibirToast?.(error?.message || 'Falha ao executar a busca inteligente com IA.', 'erro');
    } finally {
        if (reqId === aiSearchRequestId) {
            isAiSearching = false;
            atualizarBotaoBuscaIA();
            atualizarBannerFiltroIA();
        }
    }
}

document.addEventListener('input', (e) => {
    if (!e.target) return;
    if (e.target.id === 'pg-search') {
        const btnClear = getEl('pg-btn-clear-search');
        if (btnClear) btnClear.style.display = e.target.value.length > 0 ? 'flex' : 'none';
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(filter, 120);
    } else if (e.target.id === 'pg-sync-json-input') {
        atualizarStatusEntrada(e.target.value);
    } else if (['pg-cfg-orgao', 'pg-cfg-local', 'pg-cfg-sigla-local', 'pg-cfg-especies'].includes(e.target.id)) {
        atualizarBookmarklet(true);
    }
});

document.addEventListener('change', (e) => {
    if (!e.target) return;
    if (e.target.id === 'pg-only-favs-toggle') {
        onlyFavorites = Boolean(e.target.checked);
        filter();
    } else if (e.target.id === 'pg-sort-select') {
        sortMode = e.target.value;
        filter();
    } else if (e.target.id === 'pg-sync-full-mode') {
        invalidarPreviaDiff();
    } else if (e.target.id === 'pg-sync-file-input') {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const ta = getEl('pg-sync-json-input');
            if (ta) { ta.value = String(reader.result || ''); atualizarStatusEntrada(ta.value); }
        };
        reader.readAsText(file, 'utf-8');
    }
});

document.addEventListener('click', (e) => {
    const speciesBtn = e.target?.closest?.('#pg-species-filter-bar .pg-species-btn');
    if (speciesBtn) {
        selectedSpecies = speciesBtn.dataset.species || 'ALL';
        renderizarFiltroEspecies();
        filter();
        return;
    }

    const card = e.target?.closest?.('#pg-list .pg-card');
    if (!card) return;
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const id = card.dataset.modelId;
    const action = actionEl.dataset.action;

    if (action === 'copy') copiarModeloPorId(id, Boolean(e.shiftKey));
    else if (action === 'view') openViewModal(id, actionEl);
    else if (action === 'fav') toggleFavorite(id);
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (getEl('modal-pangea-sync')?.style.display === 'flex') {
        e.preventDefault();
        closeSyncModal(false);
        return;
    }
    if (getEl('modal-pangea-view')?.style.display === 'flex') {
        e.preventDefault();
        closeViewModal();
        return;
    }
    if (getEl('modal-pangea-gab')?.style.display === 'flex') {
        const searchInput = getEl('pg-search');
        if (document.activeElement === searchInput && searchInput.value !== '') {
            e.preventDefault();
            clearSearch();
        } else {
            e.preventDefault();
            fecharModalPrincipal();
        }
    }
});

window.addEventListener('aiAuthError', () => {
    if (getEl('modal-pangea-view')?.style.display === 'flex') closeViewModal();
    if (getEl('modal-pangea-gab')?.style.display === 'flex') fecharModalPrincipal();
});

window.PangeaGabController = {
    abrirModal,
    fecharModalPrincipal,
    openViewModal,
    closeViewModal,
    openSyncModal,
    closeSyncModal,
    colarPacoteClipboard,
    copiarScriptColetor,
    analisarDiferencas,
    confirmarSincronizacao,
    clearSearch,
    executarBuscaInteligente,
    limparFiltroIA,
    copyActiveView: (comQuestao = false) => {
        if (currentViewingModel) copiarModeloPorId(currentViewingModel.id, comQuestao);
    }
};

const btnSidebar = getEl('btn-pangea-gab');
if (btnSidebar) btnSidebar.disabled = false;