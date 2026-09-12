/* ================================================
   ai-recommendation-service.js
   Módulo de Integração com IA (Groq API) Padrão BYOK
   ================================================ */
window.AIRecommendationManager = (function() {
    'use strict';

    const STORAGE_KEY = 'juris_groq_api_key';
    
    // FILA DE RESILIÊNCIA: Tenta o modelo mais inteligente primeiro. 
    // Se falhar (404, 429), faz fallback automático para o modelo mais leve.
    const MODELS_QUEUE = [
        'llama-3.3-70b-versatile', 
        'llama-3.1-8b-instant'
    ];

    // MODAL DINÂMICO E SEGURO: Substitui o 'prompt()' nativo do navegador.
    // Cria uma interface de senha (password) sem congelar a thread principal.
    function _solicitarChaveAPI() {
        return new Promise((resolve, reject) => {
            if (document.getElementById('juris-ai-modal-overlay')) return reject('Modal já aberto');

            const overlay = document.createElement('div');
            overlay.id = 'juris-ai-modal-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(2px);';
            
            const modal = document.createElement('div');
            modal.style.cssText = 'background:#ffffff;padding:28px;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.2);width:90%;max-width:420px;font-family:system-ui, -apple-system, sans-serif;';
            modal.innerHTML = `
                <h3 style="margin-top:0;color:#1a1a1a;font-size:18px;">🔑 Configurações de IA (Groq)</h3>
                <p style="font-size:14px;color:#666;line-height:1.5;margin-bottom:20px;">
                    Insira sua API Key da Groq para habilitar a recomendação inteligente de modelos. 
                    <strong>Sua chave é criptografada e salva apenas localmente no seu navegador.</strong>
                </p>
                <input type="password" id="juris-ai-key-input" placeholder="gsk_..." autocomplete="off" style="width:100%;padding:12px;margin-bottom:20px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;transition:border 0.2s;">
                <div style="display:flex;justify-content:flex-end;gap:12px;">
                    <button id="juris-ai-cancel" style="padding:10px 18px;border:1px solid #ddd;background:white;color:#333;border-radius:6px;cursor:pointer;font-weight:500;">Cancelar</button>
                    <button id="juris-ai-save" style="padding:10px 18px;border:none;background:#2563eb;color:white;border-radius:6px;cursor:pointer;font-weight:500;box-shadow:0 2px 4px rgba(37,99,235,0.2);">Salvar e Analisar</button>
                </div>
            `;
            
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            const input = document.getElementById('juris-ai-key-input');
            input.focus();
            
            document.getElementById('juris-ai-cancel').onclick = () => {
                overlay.remove();
                reject('Cancelado pelo usuário');
            };
            
            document.getElementById('juris-ai-save').onclick = () => {
                const key = input.value.trim();
                if (key.length > 10) {
                    localStorage.setItem(STORAGE_KEY, key);
                    overlay.remove();
                    resolve(key);
                } else {
                    input.style.borderColor = '#ef4444';
                    window.exibirToast?.('A chave parece inválida ou muito curta.', 'erro');
                }
            };
            
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') document.getElementById('juris-ai-save').click();
            });
        });
    }

    async function _obterChaveAPI() {
        let key = localStorage.getItem(STORAGE_KEY);
        if (!key) {
            try {
                key = await _solicitarChaveAPI();
            } catch (e) {
                return null; // Usuário cancelou o modal
            }
        }
        return key;
    }

    async function buscarModelosCompativeis(topicoId, textoAlegacoes) {
        if (!textoAlegacoes || textoAlegacoes.trim() === '') return window.exibirToast?.('Redija as Razões Recursais primeiro.', 'aviso');
        
        const apiKey = await _obterChaveAPI();
        if (!apiKey) return;

        const modelos = await AcervoManager.carregarModelos();
        if (modelos.length === 0) return window.exibirToast?.('Seu acervo está vazio.', 'aviso');

        const catalogoComprimido = modelos.map(m => `ID: ${m.id} | Título: ${m.nome}`).join("\n");

        const btnIcon = document.querySelector('.preamble-alegacao .ai-trigger-btn');
        if (btnIcon) btnIcon.classList.add('is-thinking');
        window.exibirToast?.('IA analisando o Acervo...', 'info');

        // OTIMIZAÇÃO DE PROMPT: Separação de System (Regras) e User (Dados)
        const systemPrompt = `Atue como um indexador jurídico especialista e rigoroso. 
Sua única função é analisar a tese e encontrar os modelos compatíveis no acervo fornecido. 
REGRA ESTABELECIDA:
- Se houver modelos compatíveis, responda OBRIGATORIAMENTE no formato exato: [IDs: mod-xxx, mod-yyy]
- Se NÃO houver NENHUM modelo compatível com o tema, responda OBRIGATORIAMENTE: [IDs: NENHUM]
- Não adicione explicações, saudações, markdown ou qualquer outro texto fora do formato exigido.`;

        const userPrompt = `TESE: "${textoAlegacoes}"\n\nACERVO:\n${catalogoComprimido}`;

        let response = null;
        let lastError = null;

        // LOOP DE FALLBACK: Tenta cada modelo da fila até obter sucesso
        for (const model of MODELS_QUEUE) {
            try {
                const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${apiKey}`, 
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify({
                        model: model, 
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt }
                        ],
                        temperature: 0.1,
                        max_tokens: 800
                    })
                });

                if (!res.ok) {
                    const contentType = res.headers.get("content-type");
                    let errorMsg = `Erro HTTP ${res.status}`;
                    
                    // ERROR HANDLING BLINDADO: Verifica se é JSON antes de parsear
                    if (contentType && contentType.includes("application/json")) {
                        const errorData = await res.json();
                        errorMsg = errorData?.error?.message || errorMsg;
                    }
                    
                    console.warn(`[Juris IA] Falha com o modelo ${model}: ${errorMsg}. Tentando próximo da fila...`);
                    lastError = new Error(errorMsg);
                    continue; // Pula para o próximo modelo da fila
                }
                
                response = res;
                console.log(`[Juris IA] Sucesso utilizando o modelo: ${model}`);
                break; // Sai do loop se teve sucesso
                
            } catch (networkError) {
                // Erros de rede/CORS geralmente afetam todos os modelos, então quebramos o loop
                console.error(`[Juris IA] Erro crítico de rede/CORS com o modelo ${model}:`, networkError);
                lastError = networkError;
                break; 
            }
        }

        try {
            if (!response) {
                throw lastError || new Error("Todos os modelos na fila de fallback falharam.");
            }

            const data = await response.json();
            const respostaBruta = data?.choices?.[0]?.message?.content || "";

            if (respostaBruta.includes("NENHUM")) {
                window.exibirToast?.('Nenhum modelo de alta afinidade encontrado.', 'aviso');
                return; 
            }

            const idsExtraidos = respostaBruta.match(/mod-[a-zA-Z0-9_-]+/g);

            if (!idsExtraidos || idsExtraidos.length === 0) {
                window.exibirToast?.('A IA não retornou IDs válidos. Tente reformular a tese.', 'aviso');
                console.warn("[Juris IA] Resposta da IA fora do padrão:", respostaBruta);
                return;
            }

            console.log("[Juris IA] Recomendações:", idsExtraidos);

            if (typeof aplicarFiltroIAAcervo === 'function') {
                aplicarFiltroIAAcervo(idsExtraidos);
                window.exibirToast?.('Filtro de Inteligência Artificial aplicado ✨', 'sucesso');
            }

        } catch (error) {
            console.error("[Juris IA Error]", error);
            // Exibe o erro real da Groq ou de rede para o usuário
            window.exibirToast?.(`Falha na IA: ${error.message}`, 'erro');
        } finally {
            if (btnIcon) btnIcon.classList.remove('is-thinking');
        }
    }

    function resetarCredenciais() {
        localStorage.removeItem(STORAGE_KEY);
        window.exibirToast?.('Credenciais da IA resetadas.', 'sucesso');
    }

    return { buscarModelosCompativeis, resetarCredenciais };
})();