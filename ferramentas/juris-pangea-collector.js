/* ================================================
   ferramentas/juris-pangea-collector.js
   Função Coletora Real (Lazy Loaded) — Serializada via fn.toString() sem regex
   ================================================ */

/* GOVERNANÇA: manter FALSE até a Fase 0 Híbrida comprovar se resultadoCompleto:true
   (ou false, ou endpoint de detalhe) devolve o texto integral dos modelos. */
export const INTEGRALIDADE_VERIFICADA_FASE0 = false;

/* IMPORTANTE: não use comentários de linha dupla-barra dentro desta função. */
export async function executarColetaPangea(CFG) {
    if (!location.hostname.includes('pangea')) {
        alert('Abra o PangeaGAB (pangea.trt4.jus.br) autenticado e execute o coletor a partir daquela aba.');
        return;
    }

    const oldHud = document.getElementById('jn-pg-hud');
    if (oldHud) oldHud.remove();

    const hud = document.createElement('div');
    hud.id = 'jn-pg-hud';
    hud.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#0f172a;color:#f8fafc;padding:14px 16px;border-radius:10px;border:2px solid #fbc02d;box-shadow:0 12px 32px rgba(0,0,0,.38);font-family:system-ui,sans-serif;font-size:13px;max-width:380px;line-height:1.45;';
    hud.innerHTML = '<div style="font-weight:800;color:#fbc02d;margin-bottom:6px;">✦ Coletor Juris Notes · PangeaGAB</div><div id="jn-pg-msg">Iniciando coleta...</div><div id="jn-pg-btns" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;"></div>';
    document.body.appendChild(hud);

    const setMsg = (texto) => {
        const el = document.getElementById('jn-pg-msg');
        if (el) el.textContent = texto;
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /* Ponto de extensão real de autenticação (cookie por padrão; Bearer só é ativado
       com chave explícita caso a Fase 0 confirme o header "authorization") */
    const resolverAuthHeaders = (config) => {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (config.authMode === 'storage_key' && config.authStorageKey) {
            const rawVal = sessionStorage.getItem(config.authStorageKey) || localStorage.getItem(config.authStorageKey);
            if (rawVal) {
                headers['Authorization'] = rawVal.startsWith('Bearer ') ? rawVal : ('Bearer ' + rawVal);
            }
        }
        return headers;
    };

    const extrairChaveDedup = (item, idKeys) => {
        if (item && typeof item === 'object') {
            for (const k of (idKeys || ['id'])) {
                if (item[k] !== undefined && item[k] !== null && item[k] !== '') {
                    return k + ':' + String(item[k]);
                }
            }
        }
        return JSON.stringify(item);
    };

    const fetchPagina = async (pagina) => {
        const payload = {
            filtro: {
                buscaGeral: '',
                todasPalavras: '',
                quaisquerPalavras: '',
                semPalavras: '',
                trechoExato: '',
                fundamentos: '',
                etiquetas: '',
                atualizacaoDesde: '',
                atualizacaoAte: '',
                cancelados: false,
                suspensao: false,
                resultadoCompleto: Boolean(CFG.resultadoCompleto),
                ordenacaoTipo: 'Axio',
                ordenacaoModo: 'Desc',
                numero: '',
                pagina: pagina,
                orgaos: [CFG.orgao],
                especies: Array.isArray(CFG.especies) ? CFG.especies : [],
                locais: [CFG.localId]
            }
        };

        const resp = await fetch('/api/documentos/pesquisa', {
            method: 'POST',
            credentials: 'include',
            headers: resolverAuthHeaders(CFG),
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            throw new Error('HTTP ' + resp.status + ' na página ' + pagina);
        }
        return resp.json();
    };

    const all = [];
    const seen = new Set();
    let totalInformado = 0;
    let erroParcial = null;
    let tetoAtingido = false;

    const acumular = (lista) => {
        let novos = 0;
        for (const item of (lista || [])) {
            const chave = extrairChaveDedup(item, CFG.idKeys);
            if (!seen.has(chave)) {
                seen.add(chave);
                all.push(item);
                novos++;
            }
        }
        return novos;
    };

    try {
        setMsg('Consultando página 1 (' + CFG.orgao + ' · ' + CFG.siglaLocal + ')...');
        const first = await fetchPagina(1);
        totalInformado = typeof first.total === 'number' ? first.total : 0;
        const pageSize = Array.isArray(first.resultados) ? first.resultados.length : 0;
        acumular(first.resultados);

        const paginasEstimadas = pageSize > 0 ? Math.ceil(totalInformado / pageSize) : 1;
        const maxPaginas = Math.min(120, paginasEstimadas + 2);

        setMsg('Página 1/' + Math.max(1, paginasEstimadas) + ': ' + all.length + ' de ' + totalInformado + ' coletados...');

        for (let p = 2; p <= maxPaginas; p++) {
            if (totalInformado > 0 && all.length >= totalInformado) break;
            await sleep(180);
            try {
                const data = await fetchPagina(p);
                const adicionados = acumular(data.resultados);
                setMsg('Página ' + p + '/' + Math.max(1, paginasEstimadas) + ': ' + all.length + ' de ' + totalInformado + ' coletados...');
                if (!Array.isArray(data.resultados) || data.resultados.length === 0 || adicionados === 0) {
                    break;
                }
            } catch (errPag) {
                erroParcial = errPag && errPag.message ? errPag.message : String(errPag);
                break;
            }
        }

        if (totalInformado > 0 && all.length < totalInformado && !erroParcial) {
            tetoAtingido = true;
            erroParcial = 'Coleta encerrada antes do total informado (' + all.length + '/' + totalInformado + ').';
        }

        const completo = Boolean(!erroParcial && !tetoAtingido && totalInformado > 0 && all.length === totalInformado);
        const pacoteObj = {
            origem: 'PangeaGAB',
            versaoColetor: '2.1.0',
            coletadoEm: new Date().toISOString(),
            completo: completo,
            erroParcial: erroParcial,
            modoTexto: CFG.integralidadeConfirmadaFase0 ? 'integral' : 'nao_verificado',
            evidenciaIntegralidade: {
                confirmadaFase0: Boolean(CFG.integralidadeConfirmadaFase0),
                resultadoCompletoEnviado: Boolean(CFG.resultadoCompleto)
            },
            totalInformado: totalInformado,
            totalColetado: all.length,
            filtro: {
                orgao: CFG.orgao,
                localId: CFG.localId,
                siglaLocal: CFG.siglaLocal,
                especies: CFG.especies || []
            },
            resultados: all
        };
        const pacoteJson = JSON.stringify(pacoteObj);

        setMsg(
            (completo ? '✅ Coleta completa: ' : '⚠️ Coleta parcial: ') +
            all.length + ' / ' + totalInformado + ' itens. Escolha como levar ao Juris Notes:'
        );

        const btns = document.getElementById('jn-pg-btns');

        const bCopy = document.createElement('button');
        bCopy.textContent = '📋 Copiar Pacote (' + all.length + ')';
        bCopy.style.cssText = 'background:#fbc02d;color:#000;border:none;border-radius:6px;padding:7px 12px;font-weight:800;cursor:pointer;';
        bCopy.onclick = async () => {
            try {
                await navigator.clipboard.writeText(pacoteJson);
                bCopy.textContent = '✓ Copiado!';
            } catch {
                const ta = document.createElement('textarea');
                ta.value = pacoteJson;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                bCopy.textContent = '✓ Copiado!';
            }
        };

        const bDown = document.createElement('button');
        bDown.textContent = '⬇ Baixar .json';
        bDown.style.cssText = 'background:#38bdf8;color:#0f172a;border:none;border-radius:6px;padding:7px 12px;font-weight:800;cursor:pointer;';
        bDown.onclick = () => {
            const blob = new Blob([pacoteJson], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pangeagab_' + CFG.orgao + '_' + CFG.siglaLocal + '_' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        };

        const bClose = document.createElement('button');
        bClose.textContent = 'Fechar';
        bClose.style.cssText = 'background:transparent;color:#cbd5e1;border:1px solid #475569;border-radius:6px;padding:7px 10px;cursor:pointer;';
        bClose.onclick = () => hud.remove();

        btns.append(bCopy, bDown, bClose);
    } catch (err) {
        setMsg('❌ Erro na coleta: ' + (err && err.message ? err.message : err) + '. Verifique se está autenticado no PangeaGAB.');
        const bClose = document.createElement('button');
        bClose.textContent = 'Fechar';
        bClose.style.cssText = 'background:transparent;color:#cbd5e1;border:1px solid #475569;border-radius:6px;padding:6px 10px;cursor:pointer;';
        bClose.onclick = () => hud.remove();
        document.getElementById('jn-pg-btns').appendChild(bClose);
    }
}

function normalizarConfigColetor(cfg = {}) {
    const especiesArr = Array.isArray(cfg.especies)
        ? cfg.especies
        : String(cfg.especies || '').split(/[;,]/).map(s => s.trim().toUpperCase()).filter(Boolean);

    return {
        orgao: String(cfg.orgao || 'TRT23').trim().toUpperCase(),
        localId: parseInt(cfg.localId, 10) || 3138,
        siglaLocal: String(cfg.siglaLocal || 'GABRC').trim().toUpperCase(),
        especies: especiesArr,
        idKeys: Array.isArray(cfg.idKeys) && cfg.idKeys.length > 0 ? cfg.idKeys : ['id'],
        resultadoCompleto: Boolean(cfg.resultadoCompleto),
        integralidadeConfirmadaFase0: INTEGRALIDADE_VERIFICADA_FASE0,
        authMode: cfg.authMode || 'cookie',
        authStorageKey: cfg.authStorageKey || null
    };
}

export function gerarScriptConsole(cfg) {
    const safeCfg = normalizarConfigColetor(cfg);
    return `(${executarColetaPangea.toString()})(${JSON.stringify(safeCfg)});`;
}

export function gerarBookmarkletHref(cfg) {
    const safeCfg = normalizarConfigColetor(cfg);
    const code = `void((${executarColetaPangea.toString()})(${JSON.stringify(safeCfg)}));`;
    return 'javascript:' + encodeURIComponent(code);
}