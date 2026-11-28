/* ================================================
   ai-recommendation-service.js
   Módulo de Integração IA (Multi-Provider & Fallback)
   ================================================ */
window.AIRecommendationManager = (function() {
    'use strict';

    const GROQ_MODELS = [
        'openai/gpt-oss-20b', 
        'qwen/qwen3.6-27b',   
        'openai/gpt-oss-120b' 
    ];

    const GEMINI_MODELS = [
        'gemini-2.5-flash',
        'gemini-2.0-flash'
    ];

    function emitirErroAuth(provedor) {
        window.dispatchEvent(new CustomEvent('aiAuthError', { detail: { provider: provedor } }));
    }

    function _criarErroIA(code, message) {
        const err = new Error(message);
        err.code = code;
        return err;
    }

    function _ehErroExcessoContexto(msg = '', code = '') {
        const texto = `${code} ${msg}`.toLowerCase();
        return texto.includes('context_length')
            || texto.includes('reduce the length')
            || texto.includes('too large')
            || texto.includes('exceeds the maximum')
            || texto.includes('token limit')
            || texto.includes('request too large');
    }

    function _ehErroSegurancaIA(msg = '', code = '') {
        const texto = `${code} ${msg}`.toLowerCase();
        return texto.includes('safety')
            || texto.includes('blocked')
            || texto.includes('prohibited')
            || texto.includes('recitation');
    }

    // --- ESTRATÉGIAS DE EXECUÇÃO DE REDE ---

    async function executarGroq(prompt, key, opcoes = {}) {
        for (let i = 0; i < GROQ_MODELS.length; i++) {
            const model = GROQ_MODELS[i];
            if (i > 0) await new Promise(r => setTimeout(r, 1500));

            const payload = {
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1
            };
            if (opcoes.json) {
                payload.response_format = { type: 'json_object' };
            }

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify(payload)
            });

            if (response.status === 401 || response.status === 403) {
                emitirErroAuth('groq');
                throw _criarErroIA('AUTH_ERROR', 'AUTH_ERROR');
            }
            if (response.status === 413) {
                throw _criarErroIA('PAYLOAD_ERROR', 'PAYLOAD_ERROR');
            }
            if (response.ok) {
                const data = await response.json();
                const texto = data?.choices?.[0]?.message?.content;
                if (typeof texto === 'string' && texto.trim() !== '') return texto;
                continue;
            }

            let errCode = '';
            let errMsg = '';
            try {
                const errData = await response.json();
                errCode = errData?.error?.code || '';
                errMsg = errData?.error?.message || '';
            } catch {}

            if (response.status === 400 && _ehErroExcessoContexto(errMsg, errCode)) {
                throw _criarErroIA('PAYLOAD_ERROR', 'PAYLOAD_ERROR');
            }
            if (response.status === 400 && opcoes.json) {
                console.warn(`[Juris IA] Modelo Groq "${model}" rejeitou modo JSON (400: ${errCode || errMsg}). Tentando sem response_format...`);
                delete payload.response_format;
                const retryResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                    body: JSON.stringify(payload)
                });
                if (retryResp.status === 401 || retryResp.status === 403) {
                    emitirErroAuth('groq');
                    throw _criarErroIA('AUTH_ERROR', 'AUTH_ERROR');
                }
                if (retryResp.status === 413) {
                    throw _criarErroIA('PAYLOAD_ERROR', 'PAYLOAD_ERROR');
                }
                if (retryResp.ok) {
                    const retryData = await retryResp.json();
                    const retryTexto = retryData?.choices?.[0]?.message?.content;
                    if (typeof retryTexto === 'string' && retryTexto.trim() !== '') return retryTexto;
                }
                continue;
            }
            if (response.status === 404) {
                console.warn(`[Juris IA] Modelo Groq indisponível (404): ${model}`);
            } else {
                console.warn(`[Juris IA] Groq status ${response.status} em ${model}:`, errCode || errMsg);
            }
        }
        throw _criarErroIA('RATE_LIMIT_ERROR', 'RATE_LIMIT_ERROR');
    }

    async function executarGemini(prompt, key, opcoes = {}) {
        const enviarRequisicaoGemini = (model, usarJson) => {
            const bodyObj = { contents: [{ parts: [{ text: prompt }] }] };
            if (usarJson) {
                bodyObj.generationConfig = {
                    responseMimeType: 'application/json',
                    temperature: 0.1
                };
            }
            return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyObj)
            });
        };

        const extrairTextoGemini = async (response) => {
            const data = await response.json();
            const blockReason = data?.promptFeedback?.blockReason;
            const finishReason = data?.candidates?.[0]?.finishReason;
            if (blockReason || finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
                throw _criarErroIA('PROMPT_BLOCKED_ERROR', 'PROMPT_BLOCKED_ERROR');
            }
            const texto = data?.candidates?.[0]?.content?.parts
                ?.map(p => (typeof p?.text === 'string' ? p.text : ''))
                .join('')
                .trim();
            if (!texto) {
                throw _criarErroIA('EMPTY_RESPONSE_ERROR', 'A IA Gemini retornou uma resposta vazia.');
            }
            return texto;
        };

        let todos404 = true;

        for (let i = 0; i < GEMINI_MODELS.length; i++) {
            const model = GEMINI_MODELS[i];
            const response = await enviarRequisicaoGemini(model, Boolean(opcoes.json));

            if (response.status !== 404) todos404 = false;

            if (response.ok) {
                return await extrairTextoGemini(response);
            }

            if (response.status === 401 || response.status === 403) {
                emitirErroAuth('gemini');
                throw _criarErroIA('AUTH_ERROR', 'AUTH_ERROR');
            }

            if (response.status === 400) {
                let errorMessage = '';
                let errorStatus = '';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData?.error?.message || '';
                    errorStatus = errorData?.error?.status || '';
                } catch {
                    console.warn('[Juris IA] Falha ao ler corpo do erro 400 do Gemini.');
                }

                if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API_KEY_EXPIRED') || errorMessage.includes('API key not valid')) {
                    emitirErroAuth('gemini');
                    throw _criarErroIA('AUTH_ERROR', 'AUTH_ERROR');
                }
                if (_ehErroExcessoContexto(errorMessage, errorStatus)) {
                    throw _criarErroIA('PAYLOAD_ERROR', 'PAYLOAD_ERROR');
                }
                if (_ehErroSegurancaIA(errorMessage, errorStatus)) {
                    throw _criarErroIA('PROMPT_BLOCKED_ERROR', 'PROMPT_BLOCKED_ERROR');
                }

                // Simetria com Groq: se o 400 ocorreu com modo JSON ativo e não é segurança, tenta 1x sem responseMimeType
                if (opcoes.json) {
                    console.warn(`[Juris IA] Gemini "${model}" rejeitou modo JSON (400: ${errorStatus || errorMessage}). Tentando sem responseMimeType...`);
                    const retryResp = await enviarRequisicaoGemini(model, false);
                    if (retryResp.ok) {
                        return await extrairTextoGemini(retryResp);
                    }
                    if (retryResp.status === 401 || retryResp.status === 403) {
                        emitirErroAuth('gemini');
                        throw _criarErroIA('AUTH_ERROR', 'AUTH_ERROR');
                    }
                    if (retryResp.status === 404) {
                        console.warn(`[Juris IA] Modelo Gemini indisponível (404): ${model}`);
                        continue;
                    }
                    throw _criarErroIA('PROMPT_BLOCKED_ERROR', 'PROMPT_BLOCKED_ERROR');
                }

                throw _criarErroIA('PROMPT_BLOCKED_ERROR', 'PROMPT_BLOCKED_ERROR');
            }

            if (response.status === 404) {
                console.warn(`[Juris IA] Modelo Gemini não encontrado (404): ${model}. Tentando próximo da cascata...`);
                continue;
            }

            console.warn(`[Juris IA] Gemini status ${response.status} em ${model}.`);
        }

        if (todos404) {
            throw _criarErroIA('MODEL_NOT_FOUND', `Nenhum modelo Gemini configurado (${GEMINI_MODELS.join(', ')}) está disponível na conta (404).`);
        }
        throw _criarErroIA('RATE_LIMIT_ERROR', 'RATE_LIMIT_ERROR');
    }

    // --- ORQUESTRADOR / DISPATCHER ---

    async function processarIA(promptCompleto, opcoes = {}) {
        if (!window.AIManager) throw _criarErroIA('NO_AI_MANAGER', 'AIManager não encontrado.');

        const config = window.AIManager.getConfig();
        const primary = config.provedor;
        const secondary = primary === 'groq' ? 'gemini' : 'groq';

        const primaryKey = primary === 'groq' ? config.groqKey : config.geminiKey;
        const secondaryKey = secondary === 'groq' ? config.groqKey : config.geminiKey;

        // Bloqueio imediato com código tipado (dispensa duplicação de verificação de chave nos modais)
        if (!primaryKey) {
            window.AIManager.abrirModal();
            throw _criarErroIA(
                'MISSING_API_KEY',
                `A chave do seu provedor selecionado (${primary.toUpperCase()}) não está configurada. Cole a chave e clique em "Testar".`
            );
        }

        const executarNoProvedor = (prov, key) =>
            prov === 'groq' ? executarGroq(promptCompleto, key, opcoes) : executarGemini(promptCompleto, key, opcoes);

        try {
            return await executarNoProvedor(primary, primaryKey);
        } catch (e) {
            const code = e?.code || e?.message;
            if (code === 'AUTH_ERROR') {
                throw _criarErroIA('AUTH_ERROR', `A chave do provedor ${primary.toUpperCase()} é inválida ou expirou.`);
            }
            if (code === 'PROMPT_BLOCKED_ERROR') {
                throw _criarErroIA('PROMPT_BLOCKED_ERROR', 'A IA recusou o texto (Filtro de Segurança). Reveja o conteúdo.');
            }

            const motivoFallback = code === 'PAYLOAD_ERROR'
                ? `Limite de tamanho atingido no ${primary.toUpperCase()}.`
                : `Provedor ${primary.toUpperCase()} indisponível.`;

            if (!secondaryKey) {
                if (code === 'PAYLOAD_ERROR') {
                    throw _criarErroIA('PAYLOAD_ERROR', `A solicitação excedeu o limite de tokens do ${primary.toUpperCase()}. Configure também o ${secondary.toUpperCase()} para recuperação automática.`);
                }
                if (code === 'MODEL_NOT_FOUND') throw e;
                throw _criarErroIA('NETWORK_ERROR', `O serviço ${primary.toUpperCase()} falhou e não há chave do ${secondary.toUpperCase()} configurada para recuperação automática.`);
            }

            window.exibirToast?.(`${motivoFallback} Tentando ${secondary.toUpperCase()}...`, 'aviso');

            try {
                return await executarNoProvedor(secondary, secondaryKey);
            } catch (fallbackError) {
                const fbCode = fallbackError?.code || fallbackError?.message;
                if (fbCode === 'AUTH_ERROR') {
                    throw _criarErroIA('AUTH_ERROR', `A chave do provedor alternativo (${secondary.toUpperCase()}) é inválida.`);
                }
                if (fbCode === 'PROMPT_BLOCKED_ERROR') {
                    throw _criarErroIA('PROMPT_BLOCKED_ERROR', 'A IA alternativa também bloqueou o texto por filtros de segurança.');
                }
                if (fbCode === 'PAYLOAD_ERROR') {
                    throw _criarErroIA('PAYLOAD_ERROR', 'A solicitação excedeu o limite de tamanho aceito pelos provedores de IA.');
                }
                if (fbCode === 'MODEL_NOT_FOUND') throw fallbackError;
                throw _criarErroIA('NETWORK_ERROR', 'Ambos os provedores de IA falharam por sobrecarga ou erro de rede.');
            }
        }
    }

    // --- LÓGICA DE NEGÓCIO ---

    async function buscarModelosCompativeis(topicoId, textoAlegacoes) {
        if (!textoAlegacoes || textoAlegacoes.trim() === '') return window.exibirToast?.('Redija as Razões Recursais primeiro.', 'aviso');
        
        const modelos = await window.AcervoManager.carregarModelos();
        if (modelos.length === 0) return window.exibirToast?.('Seu acervo está vazio.', 'aviso');

        const catalogoComprimido = modelos.map(m => `ID: ${m.id} | Título: ${m.nome}`).join("\n");

        const btnIcon = document.querySelector('.preamble-alegacao .ai-trigger-btn');
        if (btnIcon) btnIcon.classList.add('is-thinking');
        window.exibirToast?.('A iniciar análise de IA...', 'info');

        const alegacoesSeguras = (window.JurisUtils && typeof window.JurisUtils.sanitizarParaIA === 'function')
            ? window.JurisUtils.sanitizarParaIA(textoAlegacoes, 1800)
            : textoAlegacoes.trim();

        const fullPrompt = `Atue como um indexador jurídico especialista e rigoroso. 
Sua única função é analisar a tese e encontrar os modelos compatíveis no acervo fornecido. 
REGRA ESTABELECIDA:
- Se houver modelos compatíveis, responda OBRIGATORIAMENTE no formato exato: [IDs: mod-xxx, mod-yyy]
- Se NÃO houver NENHUM modelo compatível com o tema, responda OBRIGATORIAMENTE: [IDs: NENHUM]
- Não adicione explicações, saudações, markdown ou qualquer outro texto fora do formato exigido.

TESE: "${alegacoesSeguras}"

ACERVO:
${catalogoComprimido}`;

        try {
            let respostaBruta = await processarIA(fullPrompt);

            // Sanitização de resposta (Clean Tags)
            respostaBruta = respostaBruta.replace(/<think>[\s\S]*?(?:<\/think>|$)\s*/gi, '').trim();
            if (respostaBruta.includes('</think>')) respostaBruta = respostaBruta.split('</think>').pop().trim();
            respostaBruta = respostaBruta.replace(/^```(?:markdown|text|json)?\r?\n?([\s\S]*?)\r?\n?```[\s\S]*$/i, '$1').trim();

            if (respostaBruta.includes("NENHUM")) {
                window.exibirToast?.('Nenhum modelo de alta afinidade encontrado.', 'aviso');
                return; 
            }

            const idsExtraidos = respostaBruta.match(/mod-[a-zA-Z0-9_-]+/g);

            if (!idsExtraidos || idsExtraidos.length === 0) {
                window.exibirToast?.('A IA não retornou IDs válidos. Tente reformular a tese.', 'aviso');
                return;
            }

            if (typeof window.aplicarFiltroIAAcervo === 'function') {
                window.aplicarFiltroIAAcervo(idsExtraidos);
                window.exibirToast?.('Filtro de Inteligência Artificial aplicado ✨', 'sucesso');
            }

        } catch (error) {
            console.warn("[Juris IA Error]", error);
            window.exibirToast?.(error.message, 'erro');
        } finally {
            if (btnIcon) btnIcon.classList.remove('is-thinking');
        }
    }

    function _limparRespostaBrutaIA(respostaBruta) {
        if (!respostaBruta || typeof respostaBruta !== 'string') return '';
        let limpo = respostaBruta.replace(/<think>[\s\S]*?(?:<\/think>|$)\s*/gi, '').trim();
        if (limpo.includes('</think>')) {
            limpo = limpo.split('</think>').pop().trim();
        }
        return limpo.replace(/```(?:json|markdown|text)?/gi, '').replace(/```/g, '').trim();
    }

    function _extrairBlocoBalanceado(str, openChar, closeChar) {
        const startIdx = str.indexOf(openChar);
        if (startIdx === -1) return null;
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = startIdx; i < str.length; i++) {
            const ch = str[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (!inString) {
                if (ch === openChar) depth++;
                else if (ch === closeChar) {
                    depth--;
                    if (depth === 0) return str.substring(startIdx, i + 1);
                }
            }
        }
        return null;
    }

    /**
     * Extrai o primeiro objeto `{...}` ou array `[...]` JSON válido da resposta limpa.
     * Compartilhado entre `_extrairJsonAutoTeseSeguro` e `_interpretarRankingIA`.
     */
    function _extrairPrimeiroJson(textoLimpo) {
        if (!textoLimpo) return null;

        const idxObj = textoLimpo.indexOf('{');
        const idxArr = textoLimpo.indexOf('[');
        const pares = (idxArr !== -1 && (idxObj === -1 || idxArr < idxObj))
            ? [['[', ']'], ['{', '}']]
            : [['{', '}'], ['[', ']']];

        for (const [abre, fecha] of pares) {
            const bloco = _extrairBlocoBalanceado(textoLimpo, abre, fecha);
            if (!bloco) continue;
            try {
                return JSON.parse(bloco);
            } catch {}
        }
        return null;
    }

    function _extrairJsonAutoTeseSeguro(respostaBruta) {
        if (!respostaBruta || typeof respostaBruta !== 'string') {
            throw new Error('A IA retornou uma resposta vazia.');
        }

        const limpo = _limparRespostaBrutaIA(respostaBruta);
        const parsed = _extrairPrimeiroJson(limpo);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }

        // Fallback de Contingência: Extrai campos via Regex se o JSON tiver aspas internas mal escapadas
        const matchTese = limpo.match(/"tese"\s*:\s*"([^"]+)"/i);
        const matchClass = limpo.match(/"classificacao"\s*:\s*"(autora|re|juizo|neutro)"/i);
        if (matchTese) {
            return {
                tese: matchTese[1],
                classificacao: matchClass ? matchClass[1].toLowerCase() : 'neutro'
            };
        }

        throw new Error('Não foi possível interpretar a sugestão da IA. Tente novamente.');
    }

    async function gerarAutoTese(contextoCardTexto) {
        if (!contextoCardTexto || contextoCardTexto.trim() === '') {
            throw new Error('O bloco não possui conteúdo textual suficiente para análise.');
        }

        const fullPrompt = `Atue como um Assessor de Desembargador Trabalhista sênior.
Sua tarefa é ler os elementos probatórios e anotações delimitados na tag <bloco_probatorio> e sintetizar a Tese Jurídica correspondente.

REGRAS DE ELABORAÇÃO:
1. "tese": Elabore um título ou resumo técnico, formal e direto (máximo de 180 caracteres) que identifique o tema e o cerne do argumento ou prova (Ex: "Horas extras. Invalidade dos controles de ponto britânicos. Prova oral dividida" ou "Nulidade processual. Cerceamento de defesa pelo indeferimento de contradita"). Não inclua nomes próprios de pessoas ou empresas.
2. "classificacao": Identifique a autoria/origem predominante da tese escolhendo ESTRITAMENTE uma das 4 opções:
   - "autora" (insurgência, pedido ou argumento da Parte Autora / Reclamante / Exequente)
   - "re" (defesa, contestação ou recurso da Parte Ré / Reclamada / Executada)
   - "juizo" (fundamento decisório estrito da Sentença / Acórdão / Magistrado)
   - "neutro" (fato objetivo, perícia ou registro sem polarização recursal definida)

<bloco_probatorio>
${contextoCardTexto}
</bloco_probatorio>

FORMATO DE RESPOSTA OBRIGATÓRIO:
Responda EXCLUSIVAMENTE com um objeto JSON válido em uma única linha, sem markdown e sem comentários:
{"tese": "Texto formal da tese", "classificacao": "autora"}`;

        const respostaBruta = await processarIA(fullPrompt);
        const dados = _extrairJsonAutoTeseSeguro(respostaBruta);

        const classesValidas = ['autora', 're', 'juizo', 'neutro'];
        const classificacaoSegura = classesValidas.includes(String(dados.classificacao || '').toLowerCase().trim())
            ? String(dados.classificacao).toLowerCase().trim()
            : 'neutro';

        const teseLimpa = String(dados.tese || '').replace(/\s+/g, ' ').trim();
        if (!teseLimpa) {
            throw new Error('A IA não retornou um texto de tese válido.');
        }

        return {
            tese: teseLimpa,
            classificacao: classificacaoSegura
        };
    }

    const _PRIORIDADE_INTENCAO = Object.freeze({
        veredito: 1,
        comando: 2,
        preliminar: 3,
        fundamentacao: 4,
        refutacao: 5,
        premissa: 6,
        jurisprudencia: 7,
        texto: 8
    });

    const _ROTULO_ORIGEM = Object.freeze({
        global: 'GLOBAL',
        tese: 'TESE',
        prova: 'PROVA'
    });

    function _sanitizarContexto(texto, limite) {
        if (window.JurisUtils && typeof window.JurisUtils.sanitizarParaIA === 'function') {
            return window.JurisUtils.sanitizarParaIA(texto, limite);
        }
        const limpo = String(texto || '').replace(/</g, '‹').replace(/>/g, '›').replace(/\s+/g, ' ').trim();
        return limpo.length > limite ? limpo.slice(0, limite).trimEnd() + '...' : limpo;
    }

    function _normalizarResultadosRank(arr, totalCatalogo, maxResultados) {
        const vistos = new Set();
        const saida = [];
        for (const item of arr) {
            if (!item || typeof item !== 'object' || typeof item.idx === 'boolean') continue;
            const idxNum = Number(item.idx);
            if (!Number.isInteger(idxNum) || idxNum < 1 || idxNum > totalCatalogo) continue;
            if (vistos.has(idxNum)) continue;
            vistos.add(idxNum);

            const motivo = String(item.motivo || '').replace(/\s+/g, ' ').trim().slice(0, 110);
            saida.push({ idx: idxNum, motivo });
            if (saida.length >= maxResultados) break;
        }
        return saida;
    }

    function _interpretarRankingIA(respostaBruta, totalCatalogo, maxResultados) {
        const limpo = _limparRespostaBrutaIA(respostaBruta);
        if (!limpo) throw new Error('A IA retornou uma resposta vazia.');
        if (/^\[?\s*(?:IDs:\s*)?NENHUM\s*\]?$/i.test(limpo)) return [];

        const parsed = _extrairPrimeiroJson(limpo);
        if (Array.isArray(parsed)) {
            return _normalizarResultadosRank(parsed, totalCatalogo, maxResultados);
        }
        if (parsed && typeof parsed === 'object') {
            const lista = Array.isArray(parsed.resultados)
                ? parsed.resultados
                : Array.isArray(parsed.recomendados)
                    ? parsed.recomendados
                    : Array.isArray(parsed.modelos)
                        ? parsed.modelos
                        : null;
            if (lista !== null) {
                return _normalizarResultadosRank(lista, totalCatalogo, maxResultados);
            }
        }

        // Fallback leve para JSON parcialmente malformado
        const extraidos = [];
        const regexItem = /"idx"\s*:\s*"?(\d+)"?(?:[^}]*?"motivo"\s*:\s*"([^"\r\n}]*)")?/gi;
        let match;
        while ((match = regexItem.exec(limpo)) !== null) {
            extraidos.push({ idx: match[1], motivo: match[2] || '' });
        }
        const validos = _normalizarResultadosRank(extraidos, totalCatalogo, maxResultados);
        if (validos.length > 0) return validos;

        if (/^\[\s*\]$/.test(limpo) || /"(?:resultados|recomendados|modelos)"\s*:\s*\[\s*\]/i.test(limpo)) {
            return [];
        }
        throw new Error('Não foi possível interpretar os modelos indicados pela IA. Tente novamente.');
    }

    /**
     * Serviço agnóstico de ranqueamento semântico de catálogo por contexto recursal.
     * Recebe `catalogo` já filtrado e formatado como `Array<{ id, linha }>`.
     *
     * @param {{ contexto: { topicoNome: string, alegacoes?: string, veredito?: string, nosIdeias?: Array }, catalogo: Array<{ id: string, linha: string }>, maxResultados?: number }} params
     * @returns {Promise<Array<{ id: string, rank: number, motivo: string }>>}
     */
    async function rankearCatalogoPorContexto({ contexto, catalogo, maxResultados = 12 }) {
        if (!contexto || typeof contexto !== 'object') {
            throw new Error('Nenhum contexto recursal foi fornecido para análise.');
        }
        if (!Array.isArray(catalogo) || catalogo.length === 0) {
            throw new Error('O catálogo fornecido para comparação está vazio.');
        }

        // 1. Sanitização LGPD exclusivamente sobre o contexto do processo (teto total <= 3.500 chars)
        const topicoNome = _sanitizarContexto(contexto.topicoNome || 'Tópico Ativo', 140);
        const alegacoes = _sanitizarContexto(contexto.alegacoes || '', 1400);
        const veredito = _sanitizarContexto(contexto.veredito || '', 400);

        const nosOrdenados = (Array.isArray(contexto.nosIdeias) ? contexto.nosIdeias : [])
            .filter(n => n && n.intencao !== 'nota' && n.intencao !== 'degravacao' && typeof n.texto === 'string' && n.texto.trim() !== '')
            .sort((a, b) => (_PRIORIDADE_INTENCAO[a.intencao] || 99) - (_PRIORIDADE_INTENCAO[b.intencao] || 99));

        const LIMITE_BLOCO_NOS = 1700;
        const linhasNos = [];
        let charsNos = 0;

        for (const no of nosOrdenados) {
            const textoNo = _sanitizarContexto(no.texto, 280);
            if (!textoNo) continue;
            const intencaoTag = String(no.intencao || 'premissa').toUpperCase();
            const origemTag = _ROTULO_ORIGEM[no.origem] || 'NO';
            const teseTag = no.contextoTese ? ` | Tese: ${_sanitizarContexto(no.contextoTese, 80)}` : '';
            const linha = `- [${intencaoTag} | ${origemTag}${teseTag}] ${textoNo}`;

            if (charsNos + linha.length + 1 > LIMITE_BLOCO_NOS) {
                if (linhasNos.length === 0) linhasNos.push(linha.slice(0, LIMITE_BLOCO_NOS));
                break;
            }
            linhasNos.push(linha);
            charsNos += linha.length + 1;
        }

        const blocoNos = linhasNos.join('\n');
        if (!alegacoes && !veredito && !blocoNos) {
            throw new Error('Redija as Razões Recursais ou adicione ao menos um Nó de Ideia válido antes de executar a busca.');
        }

        // 2. Catálogo indexado 1..N (sem sanitização LGPD/DOM em títulos institucionais)
        const blocoCatalogo = catalogo.map((item, i) => {
            const linhaSegura = String(item.linha || '').replace(/</g, '‹').replace(/>/g, '›').replace(/\s+/g, ' ').trim();
            return `[${i + 1}] ${linhaSegura}`;
        }).join('\n');

        const blocoVeredito = veredito
            ? `\n<veredito_previo>\n${veredito}\n</veredito_previo>\n`
            : '';

        const fullPrompt = `Atue como Assessor Jurídico Sênior de Gabinete Trabalhista (2º Grau), especialista em selecionar modelos de minuta de acórdão.
Confronte o tópico recursal, as Razões Recursais (<razoes_recursais>), o Veredito Prévio (se presente) e os Nós de Ideia/Diretrizes (<nos_de_ideias>) contra o catálogo em <catalogo>.

REGRAS:
1. Selecione APENAS modelos realmente aproveitáveis (no máximo ${maxResultados}), do mais aderente ao menos aderente. Considere sinônimos jurídicos trabalhistas.
2. Quando houver modelos com orientações opostas sobre o mesmo tema (ex.: deferimento vs. indeferimento, provimento vs. desprovimento) e o catálogo trouxer "Início:", "Fim:" ou "Teor:" (ou o título indicar o desfecho), priorize estritamente os compatíveis com <veredito_previo> e <nos_de_ideias>.
3. Use somente índices inteiros entre 1 e ${catalogo.length}, sem repetição.
4. Para cada item, escreva "motivo" conciso e técnico (máx. 90 caracteres) explicando o vínculo com o tópico.
5. Se nenhum modelo servir, responda exatamente: {"resultados":[]}

<topico_recursal>${topicoNome}</topico_recursal>
<razoes_recursais>${alegacoes || '(Não redigidas)'}</razoes_recursais>${blocoVeredito}
<nos_de_ideias>
${blocoNos || '(Nenhum nó de ideia registrado)'}
</nos_de_ideias>

<catalogo total="${catalogo.length}">
${blocoCatalogo}
</catalogo>

Responda EXCLUSIVAMENTE com um objeto JSON válido em uma única linha:
{"resultados":[{"idx":1,"motivo":"Justificativa curta (máx 90 chars)"}]}`;

        const respostaBruta = await processarIA(fullPrompt, { json: true });
        const itensExtraidos = _interpretarRankingIA(respostaBruta, catalogo.length, maxResultados);

        const resultados = [];
        itensExtraidos.forEach(item => {
            const alvo = catalogo[item.idx - 1];
            if (!alvo || !alvo.id) return;
            resultados.push({
                id: alvo.id,
                rank: resultados.length + 1,
                motivo: item.motivo
            });
        });
        return resultados;
    }

    return { buscarModelosCompativeis, gerarAutoTese, rankearCatalogoPorContexto };
})();