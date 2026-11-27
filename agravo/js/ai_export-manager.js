/**
 * ============================================================================
 * ai_export-manager.js — v7.0 Protocolo Editorial JN-5.0 (Agravo de Instrumento)
 * Módulo Orquestrador de Payload Estruturado para Modelos de Linguagem (LLM)
 * ============================================================================
 */
window.ExportManager = (function () {
    'use strict';

    // Armazém local para as dependências injetadas pelo orquestrador (app-core)
    let _deps = {
        getTopicos: () => [],
        exibirToast: () => {},
        getActiveTabId: () => null
    };

    // SINGLE SOURCE OF TRUTH — Protocolo JN-5.0, LGPD e chave canônica do AI
    const SCHEMA_EXPORT_VERSAO = 'JN-5.0';
    const TITULO_SECAO_AUDITORIA = '### 🛡️ [AUDITORIA DE QUALIDADE DO GABINETE]';
    const MARCADOR_OFICIAL_LGPD = '\n\n[AVISO DE SISTEMA: Dados sensíveis (ex: endereços) ou estruturais (cabeçalhos) foram ocultados pela Borracha Mágica para adequação à LGPD.]\n\n';
    const MARCADOR_RUIDOS = '\n\n[AVISO DE SISTEMA: Dados estruturais ocultados.]\n\n';
    const CHAVE_OBICE_SEM_NOME = 'Óbice Não Nomeado';
    const CHAVE_TESE_SEM_NOME = CHAVE_OBICE_SEM_NOME;
    const STORAGE_KEY_AUDITORIA = 'juris_auditoria_critica_ia';
    let _docConfigMapCache = null;

    /**
     * Fonte Única de Verdade (SSOT) dos regimes editoriais dos Nós de Ideia.
     */
    const REGIME_INTENCOES = Object.freeze({
        texto:          { regime: 'LITERAL',                 categoriaUI: 'literal',  tag: 'TEXTO FIXO' },
        jurisprudencia: { regime: 'LITERAL_MOVEL',           categoriaUI: 'literal',  tag: 'JURISPRUDÊNCIA EXATA' },
        degravacao:     { regime: 'LITERAL_MOVEL',           categoriaUI: 'literal',  tag: 'DEGRAVAÇÃO CURADA' },
        comando:        { regime: 'ORDEM',                   categoriaUI: 'ordem',    tag: 'COMANDO DIRETO' },
        veredito:       { regime: 'CONCLUSAO_VINCULANTE',    categoriaUI: 'ordem',    tag: 'VEREDITO PARCIAL' },
        premissa:       { regime: 'DESENVOLVER',             categoriaUI: 'livre',    tag: 'PREMISSA LÓGICA' },
        refutacao:      { regime: 'DESENVOLVER_REFUTAR',     categoriaUI: 'livre',    tag: 'REFUTAÇÃO' },
        preliminar:     { regime: 'DESENVOLVER_PREJUDICIAL', categoriaUI: 'livre',    tag: 'FILTRO / PREJUDICIAL' },
        fundamentacao:  { regime: 'LASTRO',                  categoriaUI: 'livre',    tag: 'LEI SECA' },
        fallback:       { regime: 'CONTEXTO_VALIDADO',       categoriaUI: 'livre',    tag: 'CONTEXTO FÁTICO VALIDADO' },
        nota:           { regime: 'EXCLUIDO',                categoriaUI: 'excluido', tag: null }
    });

    /**
     * Detector resiliente de checkpoint: usa JurisIndexUtils.ehCheckpoint quando carregado
     * e faz fallback determinístico para an.tipo.startsWith('checkpoint').
     */
    function _ehCheckpoint(an) {
        if (!an) return false;
        if (typeof window.JurisIndexUtils?.ehCheckpoint === 'function') {
            return window.JurisIndexUtils.ehCheckpoint(an);
        }
        return Boolean(an.tipo && an.tipo.startsWith('checkpoint'));
    }

    /**
     * Constrói o mapa índice físico -> número visual da Ideia (idêntico à tela e ao PDF),
     * pulando checkpoints para eliminar deslocamento off-by-one em Volumes II+.
     */
    function _construirMapaVisualExport(anotacoes) {
        if (typeof window.JurisIndexUtils?.construirMapaVisual === 'function') {
            return window.JurisIndexUtils.construirMapaVisual(anotacoes || []);
        }
        const mapa = new Map();
        let contador = 1;
        (anotacoes || []).forEach((an, idx) => {
            if (!_ehCheckpoint(an)) {
                mapa.set(idx, contador++);
            }
        });
        return mapa;
    }

    function isAuditoriaCriticaAtiva() {
        try {
            const val = localStorage.getItem(STORAGE_KEY_AUDITORIA);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    }

    function setAuditoriaCriticaAtiva(ativo) {
        try {
            localStorage.setItem(STORAGE_KEY_AUDITORIA, ativo ? 'true' : 'false');
        } catch (e) {
            console.warn('[ExportManager AI] Falha ao persistir preferência de auditoria:', e);
        }
    }

    function _obterMapaDocConfig() {
        if (_docConfigMapCache) return _docConfigMapCache;
        if (!Array.isArray(window.DOC_CONFIG)) return new Map();
        _docConfigMapCache = new Map(
            window.DOC_CONFIG.map(d => [String(d.label || '').trim().toUpperCase(), d])
        );
        return _docConfigMapCache;
    }

    let _regrasDeLimpezaCache = null;

    function _obterChaveStorageFiltro() {
        const tagDom = document.getElementById('tag-numero-processo');
        const numProcesso = tagDom && tagDom.textContent.trim() ? tagDom.textContent.trim() : 'padrao';
        return `juris_filtros_${numProcesso}`;
    }

    function _carregarRegrasFiltro() {
        if (_regrasDeLimpezaCache) return _regrasDeLimpezaCache;
        try {
            const salvo = sessionStorage.getItem(_obterChaveStorageFiltro());
            _regrasDeLimpezaCache = salvo ? JSON.parse(salvo) : {};
        } catch { _regrasDeLimpezaCache = {}; }
        return _regrasDeLimpezaCache;
    }

    function _salvarRegrasFiltro() {
        if (!_regrasDeLimpezaCache) return;
        sessionStorage.setItem(_obterChaveStorageFiltro(), JSON.stringify(_regrasDeLimpezaCache));
    }

    // CONFIGURAÇÃO CENTRALIZADA DE CONTEXTOS PROCESSUAIS (Arquitetura Base-2)
    const ESQUEMAS_CONTEXTO = {
        'RO': {
            prefixoArquivo: "Pacote_JurisNotes_",
            tituloTopico: "TÓPICO RECURSAL PRINCIPAL",
            rotuloSeccao: "MATRIZ DIALÉTICA DE MÉRITO",
            tagAlegacao: "teses_recursais",
            tagFundamento: "fundamentos_da_origem",
            tagVeredito: "decisao_magistrado_pretendida",
            diretrizIA: "Analise o efeito devolutivo amplo. Avalie o confronto dialético entre as razões do recurso e os fundamentos da sentença de primeiro grau."
        },
        'ED': {
            prefixoArquivo: "Pacote_ED_JurisNotes_",
            tituloTopico: "VÍCIO EMBARGADO (AUDITORIA ESTRITA)",
            rotuloSeccao: "MATRIZ DE HIGIDEZ ESTRUTURAL",
            tagAlegacao: "vicio_alegado",
            tagFundamento: "decisao_embargada",
            tagVeredito: "veredito_assessor",
            diretrizIA: "Atue estritamente sob a lente de auditoria da higidez formal da decisão. Limite-se a sanar Omissão, Contradição ou Erro Material. É EXPRESSAMENTE PROIBIDO reexaminar provas de mérito fático ou promover o rejulgamento da causa. Adote os princípios do Visual Law e Linguagem Simples: formalidade acessível, clareza absoluta e eliminação de hermetismos jurídicos."
        },
        // INJEÇÃO DA NOVA MATRIZ COGNITIVA
        'AI': {
            prefixoArquivo: "Pacote_AI_JurisNotes_",
            tituloTopico: "AUDITORIA DE ADMISSIBILIDADE (AGRAVO DE INSTRUMENTO)",
            rotuloSeccao: "MATRIZ DE VERIFICAÇÃO DE PRESSUPOSTOS",
            tagAlegacao: "fundamentos_do_agravo",
            tagFundamento: "decisao_denegatoria_originaria",
            tagVeredito: "veredito_assessor_admissibilidade",
            diretrizIA: "Atue como auditor rigoroso de pressupostos processuais. Seu objetivo é analisar estritamente se o Agravo de Instrumento merece ser conhecido (destrancando o recurso originário) com base em tempestividade, adequação, preparo e representação. Não avalie o mérito da causa principal. Preste extrema atenção à natureza do documento anexado (Ex: Guias comprovam preparo; Certidões e Manifestações comprovam tempestividade; Procurações provam representação). Justifique a admissibilidade cruzando o tipo da prova com o pressuposto alegado."
        }
    };

    /**
     * Remove sintaxes exclusivas de renderização da UI (ex: [[size:2]])
     * Evita vazamento de pseudo-código inútil para o LLM.
     */
    function _stripInternalTags(texto) {
        if (!texto) return '';
        return String(texto).replace(/\[\[\/?size(:\d)?\]\]/g, '');
    }

    /**
     * Sanitiza conteúdo para evitar quebras no Markdown
     */
    function _safeMD(str, prefixo = '') {
        if (!str) return '';
        const textoLimpo = _stripInternalTags(String(str));
        return textoLimpo.replace(/\n/g, prefixo);
    }

    /**
     * Sanitiza atributos para injeção segura em tags XML.
     * Previne quebra de payload por aspas duplas no nome do vício.
     */
    function _escapeXmlAttr(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Formata a citação oficial de referência cruzada.
     */
    function _formatarCitacaoOficial(pjeId, pagina) {
        const strId = pjeId   ? `Id ${pjeId}`   : 'Id não idt.';
        const strFl = pagina  ? `fl ${pagina}`  : 'fl não idt.';
        return `(${strId} - ${strFl})`;
    }

    /**
     * Gera nome estruturado para download de imagens
     */
    function _gerarNomeArquivoImagem(topicoId, numIdeia, numSub = null) {
        const hierarquia = numSub ? `${numIdeia}_sub_${numSub}` : `${numIdeia}`;
        const modulo = window.JURIS_MODULE || 'AI';
        return `Evidencia_${modulo}_${topicoId}_Card_${hierarquia}.png`;
    }

    /**
     * Remove padrões de prompt injection e forjamento de tags XML em textos do PDF.
     */
    function _sanitizarContraInjecao(texto) {
        if (!texto) return '';
        return String(texto)
            .replace(/</g, '‹')
            .replace(/>/g, '›')
            .replace(/\[\s*(NÓ DE IDEIA|DIRETRIZ|ESTATUTO|VERDADE|COMANDO|PREMISSA|INSTRUÇÃO)/gi, '($1')
            .replace(/\b(IA|Modelo|GPT|LLM)\s*:/gi, '[SISTEMA]')
            .replace(/\bignore\s+(tudo|o\s+que|as\s+instru[çc][õo]es|o\s+prompt)\b/gi, '[FILTRADO]')
            .replace(/(^|[.!?\n])\s*(nova\s+)?instru[çc][aã]o\s*:/gim, '$1 [FILTRADO]:');
    }

    /**
     * Classifica de forma determinística O(1) o estatuto epistemológico do cartão no AI.
     */
    function _obterEstatutoEpistemologico(item) {
        const docUpper = String(item.documento || '').trim().toUpperCase();
        const poloUpper = String(item.polo || '').trim().toUpperCase();

        const mapa = _obterMapaDocConfig();
        const configEntry = mapa.get(docUpper) || null;
        let natureza = configEntry ? configEntry.natureza : null;

        if (natureza === 'hibrido_polo') {
            if (poloUpper.includes('JUÍZO') || poloUpper.includes('TRIBUNAL') || poloUpper.includes('SECRETARIA')) {
                natureza = 'ato_judicial_oficial';
            } else {
                natureza = 'alegacao_postulatoria';
            }
        }

        if (!natureza) {
            if (docUpper.includes('AGRAVO') || docUpper.includes('RECURSO')) natureza = 'alegacao_recurso';
            else if (docUpper.includes('CONTRAMINUTA') || docUpper.includes('CONTRARRAZ')) natureza = 'alegacao_contrarrazoes';
            else if (docUpper.includes('DENEGAT') || docUpper.includes('ADMISSIBILIDADE') || docUpper.includes('MONOCR') || docUpper.includes('ACÓRDÃO') || docUpper.includes('INTERLOCUT') || docUpper.includes('SENTENÇA')) natureza = 'decisao_recorrida';
            else if (docUpper.includes('CERTID') || docUpper.includes('SECRETARIA') || docUpper.includes('JUÍZO')) natureza = 'ato_judicial_oficial';
            else if (docUpper.includes('GUIA') || docUpper.includes('COMPROVANTE') || docUpper.includes('PROCURA') || docUpper.startsWith('DOCUMENTO:') || docUpper.includes('PROVA DOCUMENTAL') || item.tipo === 'audio') natureza = 'prova_autos';
            else if (docUpper.includes('MANIFESTA')) natureza = 'alegacao_postulatoria';
            else if (poloUpper.includes('JUÍZO') || poloUpper.includes('SECRETARIA') || poloUpper.includes('TRIBUNAL')) natureza = 'ato_judicial_oficial';
            else natureza = 'prova_autos';
        }

        const mapaCodigos = {
            'alegacao_recurso': 'ALEGACAO_RECURSAL',
            'alegacao_contrarrazoes': 'CONTRARRAZOES_DEFESA_RECURSAL',
            'alegacao_postulatoria': 'LIMITES_DA_LIDE_ALEGACAO',
            'decisao_recorrida': 'DECISAO_RECORRIDA_ORIGEM',
            'ato_judicial_oficial': 'ATO_JUDICIAL_OFICIAL',
            'prova_autos': 'ELEMENTO_PROBATORIO_BRUTO'
        };

        return mapaCodigos[natureza] || 'ELEMENTO_PROBATORIO_BRUTO';
    }

    /**
     * Envelopa e sanitiza inteiros teores extraídos por alfinetes ou colados manualmente.
     * Usa tokenização por palavra inteira para evitar colisões (ex: "ATA" em "CONTRATANTE").
     */
    function enveloparTeorIntegral(docTipo, textoLimpo) {
        if (!textoLimpo) return '';
        const strTexto = String(textoLimpo).trim();

        if (strTexto.includes('estatuto_epistemologico=')) {
            const regexBlocoEnvelopado = /<([A-ZÀ-ÖØ-Ý0-9_]+)\s+estatuto_epistemologico="[^"]+">[\s\S]*?<\/\1>/gi;
            let ultimoIndice = 0;
            let resultado = '';
            let match;

            while ((match = regexBlocoEnvelopado.exec(strTexto)) !== null) {
                const trechoLivreAntes = strTexto.slice(ultimoIndice, match.index).trim();
                if (trechoLivreAntes) {
                    resultado += enveloparTeorIntegral(docTipo, trechoLivreAntes) + '\n\n';
                }
                resultado += match[0] + '\n\n';
                ultimoIndice = regexBlocoEnvelopado.lastIndex;
            }

            const trechoLivreDepois = strTexto.slice(ultimoIndice).trim();
            if (trechoLivreDepois) {
                resultado += enveloparTeorIntegral(docTipo, trechoLivreDepois);
            }
            return resultado.trim();
        }

        const tag = String(docTipo || 'DOCUMENTO').toUpperCase().replace(/[^A-ZÀ-ÖØ-Ý0-9_]/gi, '_');
        const textoSeguro = _sanitizarContraInjecao(strTexto);

        const tokens = new Set(
            tag.normalize('NFD')
               .replace(/[\u0300-\u036f]/g, '')
               .split('_')
               .filter(Boolean)
        );
        const temAlgumToken = (...lista) => lista.some(t => tokens.has(t));

        let estatuto = 'PECA_OU_DOCUMENTO_COMPLEMENTAR_NAO_VINCULANTE';
        let diretrizLeitura = 'Peça ou documento complementar extraído dos autos. Subordine sua leitura e valoração estritamente às diretrizes dos Nós de Ideia.';

        if (temAlgumToken('SENTENCA', 'DECISAO', 'ACORDAO', 'DESPACHO')) {
            estatuto = 'DECISAO_RECORRIDA_ORIGEM';
            diretrizLeitura = 'Inteiro teor da decisão denegatória/origem. Use para relatório e aferição de dialeticidade. Prevalece apenas no que for mantido pelos Nós de Ideia; havendo Nó de Ideia em sentido diverso, o Nó de Ideia revoga e substitui o entendimento da origem.';
        } else if (temAlgumToken('RECURSO', 'RO', 'AGRAVO', 'AP', 'CONTRARRAZOES', 'CONTRAMINUTA', 'INICIAL', 'CONTESTACAO', 'IMPUGNACAO', 'EMBARGOS', 'MANIFESTACAO', 'RAZOES')) {
            estatuto = 'ALEGACAO_DE_PARTE_NAO_VINCULANTE';
            diretrizLeitura = 'Inteiro teor de peça processual unilateral de parte. NÃO é verdade fática. Use APENAS para aferir limites do agravo/recurso, dialeticidade ou inovação recursal. A citação de norma ou julgado pela parte não é motivo para adotá-lo.';
        } else if (temAlgumToken('CERTIDAO', 'GUIA', 'CUSTAS', 'PREPARO', 'PROCURACAO', 'LAUDO', 'PERICIA', 'PERICIAL', 'ATA', 'OITIVA', 'DEPOIMENTO', 'PROVA')) {
            estatuto = 'ELEMENTO_PROBATORIO_BRUTO';
            diretrizLeitura = 'Inteiro teor de certidão/comprovante/elemento probatório dos autos. Sua valoração jurídica e conclusão subordinam-se estritamente ao enquadramento fixado nos Nós de Ideia.';
        }

        return `<${tag} estatuto_epistemologico="${estatuto}">\n[DIRETRIZ DE LEITURA CONTIDA]: ${diretrizLeitura}\n\n${textoSeguro}\n\n[FIM DE ${tag} — RETORNE À SOBERANIA DOS NÓS DE IDEIA]\n</${tag}>`;
    }

    /**
     * Gera a legenda única de regimes editoriais JN-5.0 (sincronizada com o Prompt Externo).
     * @param {Object} [opts] - { modo: 'completo' | 'somente_nos', auditoria?: boolean }
     */
    function gerarLegendaRegimesRedacionais(opts = {}) {
        const modo = opts.modo || 'completo';
        const isCompleto = modo === 'completo';
        const auditoriaAtiva = typeof opts.auditoria === 'boolean'
            ? opts.auditoria
            : isAuditoriaCriticaAtiva();

        const linhas = [
            `<protocolo_editorial_minuta versao="${SCHEMA_EXPORT_VERSAO}" modulo="AI">`,
            'Você atuará na redação de minuta de acórdão trabalhista (2º Grau) em Agravo de Instrumento (juízo estrito de admissibilidade — sem adentrar o mérito da causa principal), refletindo exclusivamente o convencimento do Desembargador Relator.',
            '',
            'LEGENDA DE REGIMES DOS NÓS DE IDEIA (aplique conforme a tag [REGIME: ...] de cada item):',
            '- [REGIME: LITERAL] (Texto Fixo): reproduza a redação exatamente como escrita, sem parafrasear.',
            '- [REGIME: LITERAL_MOVEL] (Jurisprudência Exata / Degravação Curada): preserve integralmente o teor literal citado, mas tenha liberdade para ordenar sua posição e redigir parágrafos/frases de transição.',
            '- [REGIME: ORDEM] (Comando Direto): cumpra integralmente a instrução operacional na elaboração da minuta; NÃO transcreva o enunciado da ordem.',
            '- [REGIME: CONCLUSAO_VINCULANTE] (Veredito Parcial): adote obrigatoriamente este desfecho decisório na fundamentação e conclusão do ponto.',
            '- [REGIME: DESENVOLVER] (Premissa Lógica): NÃO copie literalmente. Use como ponto de partida e tom do Relator; desenvolva a camada argumentativa em linguagem de acórdão, insira conectores de coesão/coerência, ajuste frases e reordene pontos se melhorar a sequência lógica.',
            '- [REGIME: DESENVOLVER_REFUTAR] (Refutação): desenvolva livremente com coesão forense, cumprindo a função específica de rebater frontalmente a tese/óbice indicado na origem do nó.',
            '- [REGIME: DESENVOLVER_PREJUDICIAL] (Filtro / Prejudicial): desenvolva livremente e posicione a análise logicamente antes dos demais pressupostos.',
            '- [REGIME: LASTRO] (Lei Seca): utilize como pano de fundo normativo integrado organicamente à fundamentação (evite transcrição mecânica integral do artigo se desnecessária).',
            '- [REGIME: CONTEXTO_VALIDADO]: fato já validado pelo assistente para integrar o raciocínio.',
            '',
            'BLINDAGEM ANTI-ALUCINAÇÃO E MINUTA LIMPA (OBRIGATÓRIO):',
            '- PROIBIDO inventar ou citar de memória qualquer ementa, número de precedente, súmula ou OJ fora dos Nós de Ideia.',
            '- PROIBIDO criar ou inserir avisos editoriais no corpo da minuta ("[CONFERIR]", "[VERIFICAR]", "[ERRO PRESCRICIONAL...]", "[DADO INSUFICIENTE...]"). Preserve intactos apenas colchetes originais de citações literais ("[...]", "[sic]") e o marcador "[DADO PESSOAL OCULTADO - LGPD]".',
            (isCompleto && auditoriaAtiva)
                ? '- Exceção controlada (sem avisos inline): admite-se referenciar (a) artigo basilar vigente (CLT/CPC/CF) ou já aplicado na decisão denegatória sem transcrever redação de memória, ou (b) Súmula/OJ/artigo verificado em fonte normativa oficial anexa ao ambiente (ex.: CLT/TST no NotebookLM) convergente com o Nó de Ideia — listando obrigatoriamente cada item na seção final de Auditoria com a origem e as primeiras 6 a 8 palavras do parágrafo onde aparece.'
                : '- Auditoria desativada (ou modo enxuto): utilize EXCLUSIVAMENTE as normas e julgados fornecidos nos Nós de Ideia; ficam vedadas citações normativas externas sem trilha de conferência.'
        ];

        linhas.push('', 'REGRAS DE PRECEDÊNCIA EM CASO DE CONFLITO:');

        if (isCompleto) {
            linhas.push(
                '1. Eixo Decisório (admissibilidade e resultado): Veredito > Diretriz Global > Diretriz de Óbice/Pressuposto > Nó Local. Qualquer conflito que afete o resultado segue o eixo decisório; o Veredito NUNCA é contrariado, nem mesmo por texto literal.',
                '2. Eixo Editorial (forma e exceções): fora de conflito de resultado, [LITERAL]/[LITERAL_MOVEL] prevalecem sobre paráfrase; entre dois [ORDEM], o comando mais específico (Local > Óbice > Global) prevalece como exceção pontual.'
            );
            if (auditoriaAtiva) {
                linhas.push(
                    '3. Transparência de Conflito: sempre que detectar conflito entre nós ou entre nó e Veredito, aplique a precedência acima para concluir a minuta e REGISTRE o conflito na seção de Auditoria citando o nº da Ideia.'
                );
            }
            linhas.push(
                '',
                'REGRA DOS CARTÕES DE CONTEXTO (<contexto_processual> / <contexto_processual_nao_vinculante>):',
                '- Trechos extraídos de peças das partes (agravo, contraminuta, manifestações) ou da decisão denegatória representam a visão do advogado ou do Juízo de 1º Grau — NUNCA a convicção do Relator.',
                '- Certidões, guias de custas/depósito, apólices e procurações funcionam como elementos objetivos cuja valoração jurídica subordina-se estritamente aos Nós de Ideia.',
                '- Utilize os cartões exclusivamente para delimitar o óbice, aferir dialeticidade, tempestividade, preparo, representação e eventual inovação recursal.'
            );
        } else {
            linhas.push(
                '1. Eixo Decisório (admissibilidade e resultado): Veredito Parcial > Diretriz Global > Diretriz de Óbice/Pressuposto > Nó Local. Qualquer conflito que afete o resultado segue o eixo decisório; o Veredito Parcial NUNCA é contrariado, nem mesmo por texto literal.',
                '2. Eixo Editorial (forma e exceções): fora de conflito de resultado, [LITERAL]/[LITERAL_MOVEL] prevalecem sobre paráfrase; entre dois [ORDEM], o comando mais específico (Local > Óbice > Global) prevalece como exceção pontual.'
            );
        }

        linhas.push('</protocolo_editorial_minuta>\n');
        return linhas.join('\n');
    }

    /**
     * Formata um único Nó de Ideia com rastreabilidade (refContexto),
     * sem indentação de 4 espaços e sem tags internas do editor.
     */
    function formatarNoEditorialMarkdown(no, refContexto = '') {
        if (!no || no.intencao === 'nota') return '';
        const chave = no.intencao || 'premissa';
        const meta = REGIME_INTENCOES[chave] || REGIME_INTENCOES.premissa;
        if (meta.regime === 'EXCLUIDO') return '';

        const textoLimpo = _stripInternalTags(String(no.texto || '')).trim();
        if (!textoLimpo) return '';

        const origemLimpa = String(refContexto || '').trim();
        const sufixoOrigem = origemLimpa ? ` | Origem: ${origemLimpa}` : '';

        return `- **[${meta.tag} | REGIME: ${meta.regime}${sufixoOrigem}]**\n${textoLimpo}`;
    }

    function _montarRefContextoCard(item, numIdeiaVisual, subIndiceCorr = null) {
        const doc = (item?.documento || item?.polo || 'Documento').trim();
        const fl = item?.pagina ? `, fl. ${item.pagina}` : '';
        const prefixoIdeia = subIndiceCorr !== null ? `Ideia ${numIdeiaVisual}.${subIndiceCorr + 1}` : `Ideia ${numIdeiaVisual}`;
        return `${prefixoIdeia} — ${doc}${fl}`;
    }

    function _rotearNoParaSecao(no, refContexto, filaPreliminares, filaVereditosLocais, bufferLocal) {
        if (!no || no.intencao === 'nota') return;
        const chave = no.intencao || 'premissa';
        const meta = REGIME_INTENCOES[chave] || REGIME_INTENCOES.premissa;
        if (meta.regime === 'EXCLUIDO') return;

        if (chave === 'preliminar') {
            filaPreliminares.push({ no, refContexto });
            return;
        }
        if (chave === 'veredito') {
            filaVereditosLocais.push({ no, refContexto });
            return;
        }

        const formatado = formatarNoEditorialMarkdown(no, refContexto);
        if (formatado) bufferLocal.push(formatado);
    }

    function _compilarBlocoPreliminares(filaPreliminares) {
        if (!Array.isArray(filaPreliminares) || filaPreliminares.length === 0) return '';

        const itens = filaPreliminares
            .map(item => formatarNoEditorialMarkdown(item.no, item.refContexto))
            .filter(Boolean);

        if (itens.length === 0) return '';

        return [
            '<questoes_preliminares_e_prejudiciais>',
            'Analise e desenvolva os óbices prévios/prejudiciais abaixo antes dos demais pressupostos:',
            ...itens,
            '</questoes_preliminares_e_prejudiciais>\n'
        ].join('\n');
    }

    /**
     * Preâmbulo Condicional (ordem TRT-23: 1º Fundamentos da Origem; 2º Razões Recursais; ao fim, Veredito).
     * Chamado na Fase B com filaVereditosLocais já populada.
     */
    function _compilarPreambuloCondicional(topico, filaVereditosLocais = []) {
        const limpar = (txt) => _stripInternalTags(String(txt || '')).trim();

        const campos = [
            {
                chave: 'fundamentos',
                tag: 'fundamentos_da_origem',
                posicao: 'ABERTURA_RELATORIO',
                notaFixo: 'Redação já revisada pelo assistente para síntese da decisão denegatória/origem. Reproduza o texto fielmente como relato da origem (não vincula o juízo de admissibilidade do 2º Grau).',
                notaAberto: 'Campo não preenchido: sintetize os fundamentos da decisão denegatória a partir dos cartões de contexto correspondentes.'
            },
            {
                chave: 'alegacoes',
                tag: 'razoes_recursais',
                posicao: 'ABERTURA_RELATORIO',
                notaFixo: 'Redação já revisada pelo assistente para abertura das razões do Agravo de Instrumento. Reproduza o texto fielmente, ciente de que expressa a pretensão do AGRAVANTE (não a convicção do Relator).',
                notaAberto: 'Campo não preenchido: sintetize as razões do Agravo de Instrumento a partir dos cartões de contexto do recurso.'
            },
            {
                chave: 'veredito',
                tag: 'veredito_e_conclusao',
                posicao: 'FECHO_DISPOSITIVO',
                notaFixo: 'Dispositivo/conclusão de admissibilidade já definido e revisado pelo assistente. Reproduza fielmente no fechamento do tópico (conhecer/não conhecer, dar/negar provimento ao agravo). Nunca contrarie este resultado.',
                notaAberto: 'CAMPO DELEGADO À IA: o assistente deixou o veredito em aberto intencionalmente. Elabore a conclusão completa de admissibilidade (destrancamento ou manutenção do trancamento do recurso principal) com base nos Nós de Ideia e nos autos.'
            }
        ];

        const out = ['<preambulo_da_minuta>'];

        campos.forEach(c => {
            const val = limpar(topico?.[c.chave]);
            if (val) {
                out.push(`<${c.tag} posicao="${c.posicao}" status="TEXTO_FIXO_NAO_ALTERAR">`);
                out.push(`[ORIENTAÇÃO]: ${c.notaFixo}`);
                out.push(val);
                out.push(`</${c.tag}>`);
            } else {
                out.push(`<${c.tag} posicao="${c.posicao}" status="EM_ABERTO_LIBERDADE_DELEGADA">`);
                out.push(`[ORIENTAÇÃO]: ${c.notaAberto}`);
                out.push(`</${c.tag}>`);
            }
        });

        if (Array.isArray(filaVereditosLocais) && filaVereditosLocais.length > 0) {
            const linhasVereditos = filaVereditosLocais
                .map(item => formatarNoEditorialMarkdown(item.no, item.refContexto))
                .filter(Boolean);
            if (linhasVereditos.length > 0) {
                out.push('<vereditos_parciais_vinculantes status="OBRIGATORIO">');
                out.push(...linhasVereditos);
                out.push('</vereditos_parciais_vinculantes>');
            }
        }

        out.push('</preambulo_da_minuta>\n');
        return out.join('\n');
    }

    /**
     * Preâmbulo neutro para modo === 'acervo' (preserva fundamentos, razões, veredito e vereditos locais).
     */
    function _compilarPreambuloAcervo(topico, filaVereditosLocais = []) {
        const limpar = (txt) => _stripInternalTags(String(txt || '')).trim();

        const fundamentos = limpar(topico?.fundamentos);
        const alegacoes = limpar(topico?.alegacoes);
        const veredito = limpar(topico?.veredito);
        const vereditosLocais = (filaVereditosLocais || [])
            .map(item => formatarNoEditorialMarkdown(item.no, item.refContexto))
            .filter(Boolean);

        if (!fundamentos && !alegacoes && !veredito && vereditosLocais.length === 0) return '';

        const out = ['<relatorio_do_conflito>'];
        if (fundamentos) out.push(`<fundamentos_da_origem>\n${fundamentos}\n</fundamentos_da_origem>`);
        if (alegacoes) out.push(`<razoes_recursais>\n${alegacoes}\n</razoes_recursais>`);
        if (veredito) out.push(`<veredito_pretendido>\n${veredito}\n</veredito_pretendido>`);
        if (vereditosLocais.length > 0) {
            out.push('<vereditos_parciais_locais>');
            out.push(...vereditosLocais);
            out.push('</vereditos_parciais_locais>');
        }
        out.push('</relatorio_do_conflito>\n');
        return out.join('\n');
    }

    /**
     * Gera âncora cognitiva final e gatilho XML determinístico <auditoria_critica>.
     */
    function gerarLembreteFinalHierarquia(topico, opts = {}) {
        const auditoriaAtiva = typeof opts.auditoria === 'boolean'
            ? opts.auditoria
            : isAuditoriaCriticaAtiva();

        const vereditoDelegado = !(topico && topico.veredito && topico.veredito.trim() !== '');
        const possuiCheckpointSaida = Boolean(
            topico && Array.isArray(topico.anotacoes) && topico.anotacoes.some(a => a && a.tipo === 'checkpoint_saida')
        );

        const linhas = [
            '\n<fechamento_editorial_e_controle>',
            'CHECKLIST DE EXECUÇÃO (RECENCY GUARD):',
            '1. RIGIDEZ: Preserve literalmente o Preâmbulo preenchido (1º Fundamentos da Origem; 2º Razões Recursais; ao fim, Veredito), [TEXTO FIXO], [JURISPRUDÊNCIA EXATA] e [DEGRAVAÇÃO CURADA] (nestes dois últimos, ordene livremente e redija transições fluidas). O Veredito nunca pode ser contrariado.',
            '2. LIBERDADE: NÃO copie mecanicamente [PREMISSA LÓGICA], [REFUTAÇÃO] nem [FILTRO / PREJUDICIAL] — desenvolva argumentação jurídica coesa de admissibilidade (sem julgar o mérito originário), reordenando trechos se melhorar a lógica do acórdão, e integre [LEI SECA] como pano de fundo.',
            '3. CONTEXTO: Jamais adote alegações de <contexto_processual> / <contexto_processual_nao_vinculante> como convicção do Relator.',
            '4. ANTI-ALUCINAÇÃO E MINUTA LIMPA: NUNCA invente ou cite de memória súmula, OJ, ementa ou precedente fora dos Nós de Ideia. NUNCA crie avisos editoriais inline ("[CONFERIR]", "[VERIFICAR]", "[ERRO PRESCRICIONAL...]"). Preserve intactos apenas colchetes originais de citações literais ("[...]", "[sic]") e o marcador "[DADO PESSOAL OCULTADO - LGPD]".'
        ];

        if (auditoriaAtiva) {
            linhas.push(
                '',
                '<auditoria_critica ativa="true">',
                `OBRIGATÓRIO — APÓS CONCLUIR A MINUTA LIMPA${possuiCheckpointSaida ? ' (E ANTES DO CHECKPOINT DE CONTINUIDADE)' : ''}:`,
                `Crie uma seção final isolada (após linha divisória ---) com o título exato: "${TITULO_SECAO_AUDITORIA}" (uso interno — não integrar ao acórdão).`,
                'Atue como revisor jurídico crítico independente, sempre citando o nº da Ideia (conforme a numeração acima), Id. e folha (fl.) quando aplicável:',
                '1. LASTRO FÁTICO — Distinga expressamente entre: (a) ponto "NÃO LOCALIZADO NOS RECORTES FORNECIDOS" (pode constar em páginas não recortadas) e (b) ponto "CONTRARIADO POR ELEMENTO FORNECIDO" (contradição direta com certidão, guia, procuração ou peça presente no contexto);',
                '2. CONFLITOS ENTRE DIRETRIZES — Se detectou conflito entre nós ou entre nó (mesmo literal) e Veredito, reporte o conflito indicando o nº da Ideia afetada;',
                '3. VÍCIOS PROCESSUAIS, PRESSUPOSTOS E ERROS MATERIAIS — Alerte sobre contagem equivocada de prazo frente à certidão de intimação, divergência de valor/vencimento em guia ou seguro-garantia, irregularidade de representação, ausência de dialeticidade, inovação recursal, preclusão, inversão de polos, julgamento extra/ultra/citra petita, prescrição ou erro material evidente;',
                '4. NORMAS INVOCADAS FORA DOS NÓS — Liste eventuais artigos de lei autônomos ou súmulas/OJs de fonte normativa oficial anexa citados na minuta, indicando a origem ("lei seca autônoma" ou "fonte oficial anexa") e as primeiras 6 a 8 palavras do parágrafo onde aparecem (ex.: "Art. 897, b, da CLT [lei seca autônoma] — parágrafo iniciado por: \'No tocante ao cabimento...\'");'
            );

            if (vereditoDelegado) {
                linhas.push(
                    '5. JUSTIFICATIVA DO VEREDITO DELEGADO (OBRIGATÓRIO): Como o campo Veredito/Conclusão foi deixado em aberto, declare qual desfecho de admissibilidade adotou e quais Nós de Ideia o fundamentaram.'
                );
            }

            linhas.push(
                'Se não houver anomalia, conflito, norma autônoma nem veredito delegado a justificar, escreva exatamente: "Nenhuma inconsistência material, processual ou prescricional detectada."',
                '</auditoria_critica>'
            );
        } else {
            linhas.push(
                '5. AUDITORIA DESATIVADA: utilize EXCLUSIVAMENTE as normas e julgados fornecidos nos Nós de Ideia; ficam vedadas citações normativas externas.',
                '<auditoria_critica ativa="false" />'
            );
        }

        linhas.push('</fechamento_editorial_e_controle>\n');
        return linhas.join('\n');
    }

    /**
     * Verificador determinístico de âncoras literais com simetria LGPD.
     */
    function _sanitizarComLgpdSeAtivo(str) {
        const bruto = String(str || '');
        if (window.QuickRedactManager && typeof window.QuickRedactManager.sanitizarString === 'function') {
            return window.QuickRedactManager.sanitizarString(bruto);
        }
        return bruto;
    }

    function _normalizarParaComparacaoLiteral(str) {
        return _sanitizarComLgpdSeAtivo(str)
            .replace(/\[\[(?:u|\/u|size:\d+|\/size)\]\]/gi, '')
            .replace(/[*_`>]/g, '')
            .replace(/[“”«»]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function verificarAncorasLiteraisNoRascunho(topico, textoRascunho) {
        const rascunhoNorm = _normalizarParaComparacaoLiteral(textoRascunho);
        if (!topico || !rascunhoNorm) {
            return { total: 0, encontrados: 0, ausentes: [] };
        }

        const ancoras = [];
        const adicionar = (origem, textoBruto) => {
            const limpo = String(textoBruto || '').trim();
            if (limpo.length < 8) return;
            ancoras.push({ origem, texto: limpo, norm: _normalizarParaComparacaoLiteral(limpo) });
        };

        if (topico.fundamentos) adicionar('Preâmbulo — Decisão Denegatória / Origem', topico.fundamentos);
        if (topico.alegacoes) adicionar('Preâmbulo — Razões do Agravo', topico.alegacoes);
        if (topico.veredito) adicionar('Preâmbulo — Veredito / Conclusão', topico.veredito);

        const inspecionarLista = (lista, origem) => {
            (lista || []).forEach(no => {
                if (!no || no.intencao === 'nota') return;
                const meta = REGIME_INTENCOES[no.intencao];
                if (meta && (meta.regime === 'LITERAL' || meta.regime === 'LITERAL_MOVEL')) {
                    adicionar(`${meta.tag} (${origem})`, no.texto);
                }
            });
        };

        inspecionarLista(topico.diretrizesGlobais, 'Diretriz Global');
        const mapaObices = topico.diretrizesPorObice || topico.diretrizesPorTese || topico.diretrizesPorVicio;
        if (mapaObices) {
            Object.entries(mapaObices).forEach(([obice, lista]) => inspecionarLista(lista, `Óbice: ${obice}`));
        }

        const mapaVisuais = _construirMapaVisualExport(topico.anotacoes);
        (topico.anotacoes || []).forEach((an, idx) => {
            if (_ehCheckpoint(an)) return;
            const numVisual = mapaVisuais.get(idx);
            inspecionarLista(an.subAnotacoes, _montarRefContextoCard(an, numVisual));
            (an.itensCorrelacionados || []).forEach((ic, cIdx) => {
                inspecionarLista(ic.subAnotacoes, _montarRefContextoCard(ic, numVisual, cIdx));
            });
        });

        const ausentes = [];
        let encontrados = 0;

        ancoras.forEach(a => {
            if (rascunhoNorm.includes(a.norm)) encontrados++;
            else ausentes.push({ origem: a.origem, preview: a.texto.slice(0, 90) });
        });

        return { total: ancoras.length, encontrados, ausentes };
    }

    /**
     * Motor Privado de Geração de Payload em 2 Fases (Protocolo JN-5.0 — Agravo de Instrumento)
     */
    function _gerarMarkdown(topico, opcoes = {}) {
        const modoPrompt = opcoes.modo || 'minuta';
        const incluirNomesImagens = opcoes.incluirNomesImagens !== undefined ? opcoes.incluirNomesImagens : true;
        const auditoriaAtiva = modoPrompt === 'acervo'
            ? false
            : (opcoes.auditoria !== undefined ? opcoes.auditoria : isAuditoriaCriticaAtiva());

        const moduleContext = window.JURIS_MODULE || 'AI';
        const config = ESQUEMAS_CONTEXTO[moduleContext] || ESQUEMAS_CONTEXTO['AI'];
        const safeFormatTime = (sec) => window.AudioManager?.formatTime ? window.AudioManager.formatTime(sec) : `${Math.floor(sec/60)}' ${Math.floor(sec%60)}''`;

        // =====================================================================
        // FASE A — COLETA E SERIALIZAÇÃO EM PASSAGEM ÚNICA (O(N))
        // =====================================================================
        const anotacoes = Array.isArray(topico.anotacoes) ? topico.anotacoes : [];
        const mapaVisuais = _construirMapaVisualExport(anotacoes);

        const filaPreliminares = [];
        const filaVereditosLocais = [];
        const bufferGlobais = [];
        const bufferPressupostos = [];
        const bufferMatriz = [];

        // A.1 — Diretrizes Globais
        (topico.diretrizesGlobais || []).forEach(dir => {
            _rotearNoParaSecao(dir, 'Diretriz Global', filaPreliminares, filaVereditosLocais, bufferGlobais);
        });

        // A.2 — Diretrizes por Óbice / Pressuposto (prioriza topico.diretrizesPorObice usado no AI)
        const diretrizesPorTeseOuVicio = topico.diretrizesPorObice || topico.diretrizesPorTese || topico.diretrizesPorVicio || {};
        if (Object.keys(diretrizesPorTeseOuVicio).length > 0) {
            const tesesAncoradas = window.ThesisGuard
                ? ThesisGuard.mapearTesesAncoradas(topico)
                : new Set(
                    anotacoes
                        .filter(a => a && !_ehCheckpoint(a))
                        .map(a => (a.tese && a.tese.trim() !== '') ? a.tese.trim() : CHAVE_OBICE_SEM_NOME)
                );

            Object.keys(diretrizesPorTeseOuVicio).forEach(nomePressuposto => {
                const chaveNormalizada = nomePressuposto.trim() || CHAVE_OBICE_SEM_NOME;
                if (!tesesAncoradas.has(chaveNormalizada)) return;

                const diretrizes = diretrizesPorTeseOuVicio[nomePressuposto];
                if (!Array.isArray(diretrizes) || diretrizes.length === 0) return;

                const linhasPressuposto = [];
                diretrizes.forEach(dir => {
                    _rotearNoParaSecao(dir, `Óbice/Pressuposto: ${chaveNormalizada}`, filaPreliminares, filaVereditosLocais, linhasPressuposto);
                });

                if (linhasPressuposto.length > 0) {
                    bufferPressupostos.push(
                        `  <pressuposto_alvo nome="${_escapeXmlAttr(chaveNormalizada)}">\n${linhasPressuposto.join('\n')}\n  </pressuposto_alvo>`
                    );
                }
            });
        }

        // A.3 — Matriz de Evidências (Provas e Peças do Agravo)
        if (anotacoes.length === 0) {
            bufferMatriz.push('*Nenhum documento foi anexado para auditoria de admissibilidade.*');
        } else {
            anotacoes.forEach((an, idx) => {
                if (!an) return;

                if (an.tipo === 'checkpoint_saida') {
                    const meta = an.metaHandoff;
                    bufferMatriz.push(
                        `\n⛓️ PONTE DE CONTINUIDADE (SAÍDA) + COMANDO DE GERAÇÃO PARCIAL\n` +
                        `→ CONTINUA NO TÓPICO: "${meta.alvo}"\n` +
                        `→ COMANDO DE GERAÇÃO PARCIAL: ao redigir a minuta deste tópico, NÃO escreva conclusão, pedidos finais ou parágrafo de fecho; interrompa após a última seção do escopo (e após a seção "${TITULO_SECAO_AUDITORIA}", se ativa) e encerre por último com o bloco "CHECKPOINT DE CONTINUIDADE" contendo [ID] CHK-${meta.slug}-v${meta.versao}, [STATUS], [JÁ REDIGIDO], [PREMISSAS FIXADAS], [PENDÊNCIAS], [PONTO DE RETOMADA], [VEDAÇÕES].\n`
                    );
                    return;
                } else if (an.tipo === 'checkpoint_entrada') {
                    const meta = an.metaHandoff;
                    bufferMatriz.push(
                        `\n⛓️ PONTE DE CONTINUIDADE (CHEGADA) + COMANDO DE RETOMADA\n` +
                        `← ORIGEM: continuação direta do tópico "${meta.origem}" via minuta parcial com checkpoint CHK-${meta.slug}-v${meta.versao}.\n`
                    );
                    return;
                }

                const numIdeia = mapaVisuais.get(idx);
                const refCitacao = _formatarCitacaoOficial(an.pjeId, an.pagina);
                const pressupostoContexto = window.ThesisGuard
                    ? ThesisGuard.obterChaveTese(an)
                    : ((an.tese && an.tese.trim() !== '') ? an.tese.trim() : CHAVE_OBICE_SEM_NOME);
                const estatutoMestre = _obterEstatutoEpistemologico(an);

                const blocoCard = [];
                blocoCard.push('<analise_de_evidencia>');
                blocoCard.push(`[IDENTIFICADOR DA IDEIA]: ${numIdeia}`);
                blocoCard.push(`[PRESSUPOSTO VINCULADO]: ${_escapeXmlAttr(pressupostoContexto)}`);
                if (an.vicio || topico.vicio) {
                    blocoCard.push(`[MODALIDADE DE ÓBICE]: ${_escapeXmlAttr(an.vicio || topico.vicio)}`);
                }

                const faseContexto = an.fase || an.documento || 'Não especificado';
                const poloContexto = an.polo || 'N/A';
                blocoCard.push(`<contexto_processual>\nFase: ${faseContexto} | Origem Documento: ${poloContexto} | Ref: ${refCitacao} | Estatuto: ${estatutoMestre}\n</contexto_processual>\n`);

                const linhasContexto = ['<contexto_processual_nao_vinculante>'];
                const docLabel = `**[ESTATUTO: ${estatutoMestre}] [${an.documento || 'Comprovante'}] (${an.polo || 'Sem polo'}) ${refCitacao}:**`;

                if (an.tipo === 'texto') {
                    linhasContexto.push(`- ${docLabel} ${_safeMD(_sanitizarContraInjecao(an.conteudo), ' ')}`);
                    if (an.comentario) {
                        linhasContexto.push(`  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}`);
                    }
                } else if (an.tipo === 'imagem') {
                    const imgRef = incluirNomesImagens
                        ? `(Nome: \`${_gerarNomeArquivoImagem(topico.id, numIdeia)}\`)`
                        : `[Recorte visual — ${refCitacao}]`;
                    linhasContexto.push(`- ${docLabel}\n  [IMAGEM DE COMPROVANTE FORNECIDA]: ${imgRef}.\n  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Verifique o dado contido nesta guia/certidão conforme Nós de Ideia.'), '\n  ')}`);
                } else if (an.tipo === 'audio') {
                    try {
                        const ad = JSON.parse(an.conteudo);
                        const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                        linhasContexto.push(`- ${docLabel} [OITIVA DE AUDIÊNCIA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).`);
                        if (an.comentario) linhasContexto.push(`  [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(an.comentario), '\n  ')}`);
                        if (ad.transcricao) linhasContexto.push(`  [TRANSCRIÇÃO BRUTA]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n  ')}"`);
                    } catch (e) {
                        linhasContexto.push(`- ${docLabel} [ÁUDIO REGISTRADO] Resumo: ${_safeMD(_sanitizarContraInjecao(an.comentario || 'Sem comentário.'), '\n  ')}`);
                    }
                }

                if (Array.isArray(an.itensCorrelacionados) && an.itensCorrelacionados.length > 0) {
                    an.itensCorrelacionados.forEach((corr, corrIdx) => {
                        const numSub = corrIdx + 1;
                        const cRefCitacao = _formatarCitacaoOficial(corr.pjeId, corr.pagina);
                        const estatutoCorr = _obterEstatutoEpistemologico(corr);
                        const cDocLabel = `  [CONFRONTO DIRETO ${numSub} — ESTATUTO: ${estatutoCorr}]: [${corr.documento || 'Doc'}] (${corr.polo || 'Polo'}) ${cRefCitacao}:`;

                        if (corr.tipo === 'texto') {
                            linhasContexto.push(`${cDocLabel} ${_safeMD(_sanitizarContraInjecao(corr.conteudo || ''), ' ')}`);
                            if (corr.comentario) {
                                linhasContexto.push(`    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}`);
                            }
                        } else if (corr.tipo === 'imagem') {
                            const cImgRef = incluirNomesImagens
                                ? `\`${_gerarNomeArquivoImagem(topico.id, numIdeia, numSub)}\``
                                : `[Recorte visual — ${cRefCitacao}]`;
                            linhasContexto.push(`${cDocLabel}\n    [IMAGEM ANEXA]: ${cImgRef}\n    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Avalie a validade conforme os Nós de Ideia.'), '\n    ')}`);
                        } else if (corr.tipo === 'audio') {
                            try {
                                const ad = JSON.parse(corr.conteudo);
                                const oradorFinal = ad.role || ad.oradorStr || 'Orador não idt.';
                                linhasContexto.push(`${cDocLabel} [OITIVA] (${oradorFinal} — ${safeFormatTime(ad.inicio)} a ${safeFormatTime(ad.fim)}).`);
                                if (corr.comentario) linhasContexto.push(`    [NOTA DO ASSESSOR — orientação de leitura]: ${_safeMD(_sanitizarContraInjecao(corr.comentario), '\n    ')}`);
                                if (ad.transcricao) linhasContexto.push(`    [TRANSCRIÇÃO BRUTA]: "${_safeMD(_sanitizarContraInjecao(ad.transcricao), '\n    ')}"`);
                            } catch (e) {
                                linhasContexto.push(`${cDocLabel} [ÁUDIO] Contexto: ${_safeMD(_sanitizarContraInjecao(corr.comentario || 'Ausente.'), '\n    ')}`);
                            }
                        }
                    });
                }

                linhasContexto.push('</contexto_processual_nao_vinculante>');
                blocoCard.push(linhasContexto.join('\n') + '\n');

                const bufferDiretrizesLocais = [];
                const refMestre = _montarRefContextoCard(an, numIdeia);

                (an.subAnotacoes || []).forEach(sub => {
                    _rotearNoParaSecao(sub, refMestre, filaPreliminares, filaVereditosLocais, bufferDiretrizesLocais);
                });

                (an.itensCorrelacionados || []).forEach((corr, corrIdx) => {
                    const refCorr = _montarRefContextoCard(corr, numIdeia, corrIdx);
                    (corr.subAnotacoes || []).forEach(sub => {
                        _rotearNoParaSecao(sub, refCorr, filaPreliminares, filaVereditosLocais, bufferDiretrizesLocais);
                    });
                });

                if (bufferDiretrizesLocais.length > 0) {
                    blocoCard.push(`<diretrizes_de_auditoria_do_assessor>\n${bufferDiretrizesLocais.join('\n')}\n</diretrizes_de_auditoria_do_assessor>`);
                }

                blocoCard.push('</analise_de_evidencia>\n');
                bufferMatriz.push(blocoCard.join('\n'));
            });
        }

        // =====================================================================
        // FASE B — CONCATENAÇÃO ORDENADA DO DOCUMENTO FINAL (O(1))
        // =====================================================================
        const partesDoc = [
            `<!-- [ESQUEMA ${SCHEMA_EXPORT_VERSAO} — PROTOCOLO EDITORIAL (AI)] -->`,
            `# ${config.tituloTopico}: **${(topico.nome || 'Não Nomeado').toUpperCase()}**\n`
        ];

        if (modoPrompt !== 'acervo') {
            partesDoc.push(gerarLegendaRegimesRedacionais({ modo: 'completo', auditoria: auditoriaAtiva }));

            const nomeIncidente = moduleContext === 'ED'
                ? 'Embargos de Declaração'
                : (moduleContext === 'RO' ? 'Recurso Ordinário' : 'Agravo de Instrumento');

            partesDoc.push([
                '<roteiro_diretor_llm>',
                `  <incidente_processual>${nomeIncidente}</incidente_processual>`,
                `  <diretriz_cognitiva_vinculante>${config.diretrizIA}</diretriz_cognitiva_vinculante>`,
                '</roteiro_diretor_llm>\n'
            ].join('\n'));

            if (window.ContratoManager && typeof window.ContratoManager.getDados === 'function') {
                const dadosContrato = window.ContratoManager.getDados();
                if (dadosContrato && (dadosContrato.admissao || dadosContrato.demissao || dadosContrato.funcao)) {
                    const formatarData = (d) => {
                        const arr = String(d).split('-');
                        return arr.length === 3 ? `${arr[2]}/${arr[1]}/${arr[0]}` : d;
                    };
                    const contratoLinhas = ['<parametros_contratuais>'];
                    if (dadosContrato.funcao) contratoLinhas.push(`- Função(ões): ${_safeMD(dadosContrato.funcao, ' ')}`);
                    if (dadosContrato.admissao) contratoLinhas.push(`- Data de Admissão: ${formatarData(dadosContrato.admissao)}`);
                    if (dadosContrato.demissao) contratoLinhas.push(`- Data de Demissão: ${formatarData(dadosContrato.demissao)}`);
                    contratoLinhas.push(
                        '',
                        auditoriaAtiva
                            ? `INSTRUÇÃO: Referência fática objetiva do vínculo contratual (subordinada aos Nós de Ideia). JAMAIS insira tags ou avisos prescricionais no corpo da minuta; eventuais alertas de prescrição devem constar EXCLUSIVAMENTE na seção final "${TITULO_SECAO_AUDITORIA}".`
                            : 'INSTRUÇÃO: Referência fática objetiva do vínculo contratual (subordinada aos Nós de Ideia). Não insira avisos editoriais ou marcadores prescricionais no corpo da minuta.',
                        '</parametros_contratuais>\n'
                    );
                    partesDoc.push(contratoLinhas.join('\n'));
                }
            }

            partesDoc.push(_compilarPreambuloCondicional(topico, filaVereditosLocais));
        } else {
            const preambuloAcervo = _compilarPreambuloAcervo(topico, filaVereditosLocais);
            if (preambuloAcervo) partesDoc.push(preambuloAcervo);
        }

        const blocoPreliminares = _compilarBlocoPreliminares(filaPreliminares);
        if (blocoPreliminares) partesDoc.push(blocoPreliminares);

        if (bufferGlobais.length > 0) {
            partesDoc.push([
                '<premissas_globais_de_admissibilidade>',
                ...bufferGlobais,
                '</premissas_globais_de_admissibilidade>\n'
            ].join('\n'));
        }

        if (bufferPressupostos.length > 0) {
            partesDoc.push([
                '<direcionamentos_por_pressuposto>',
                ...bufferPressupostos,
                '</direcionamentos_por_pressuposto>\n'
            ].join('\n'));
        }

        partesDoc.push([
            `## SEÇÃO II — ${config.rotuloSeccao}`,
            '<matriz_dialetica_e_provas>',
            ...bufferMatriz,
            '</matriz_dialetica_e_provas>\n'
        ].join('\n'));

        return partesDoc.join('\n');
    }

    /**
     * Download seguro do arquivo Markdown
     */
    function _downloadArquivo(nomeArquivo, conteudoTexto, mimeType = 'text/markdown;charset=utf-8;') {
        const blob = new Blob([conteudoTexto], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", nomeArquivo);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Download sequencial seguro de imagens (Herdado do RO - Previne bloqueio de navegador)
     */
    async function _downloadImagemSegura(base64Data, nomeArquivoBase) {
        try {
            const response = await fetch(base64Data);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = nomeArquivoBase;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            await new Promise(resolve => setTimeout(resolve, 50));
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(`[ExportManager AI] Falha ao baixar imagem "${nomeArquivoBase}":`, e);
        }
    }

    async function _executarFilaDeDownloads(fila) {
        if (!fila || fila.length === 0) return;
        _deps.exibirToast(`Iniciando download de ${fila.length} evidência(s)...`, 'info');
        for (const item of fila) {
            await _downloadImagemSegura(item.dados, item.nome);
            await new Promise(resolve => setTimeout(resolve, 650)); // Delay estratégico
        }
        _deps.exibirToast('Todas as evidências foram baixadas.', 'sucesso');
    }

    // ─── HUB DE EXPORTAÇÃO RAG ──────────────────────────────────────────────
    let _documentosParaExtracaoCache = {};
    let _isExporting = false;
    let _filtroOnAfterSave = null;

    function temRegraFiltro(docTipo) {
        const regras = _carregarRegrasFiltro();
        return Boolean(regras && regras[docTipo]);
    }

    function isExporting() {
        return _isExporting;
    }

    /**
     * Motor interno de extração (NÃO manipula `_isExporting` — gerenciado pelos chamadores públicos
     * para impedir auto-deadlock em `gerarExportacaoPersonalizada` e `gerarExportacaoGeral`).
     */
    async function _executarExtracaoInterna(listaPares, opts = {}) {
        const { onProgress = null } = opts;
        const resultados = [];

        for (let idx = 0; idx < listaPares.length; idx++) {
            const par = listaPares[idx];
            if (!par || !par.inicio || !par.fim || par.invalida) continue;

            const docTipo = par.docTipo;
            const tagName = String(docTipo || 'DOCUMENTO').toUpperCase();

            try {
                const pInicio = Math.min(par.inicio.pagina, par.fim.pagina);
                const pFim = Math.max(par.inicio.pagina, par.fim.pagina);
                const amostrasMap = new Map();

                const textoBruto = await window.PdfEngine.extrairTextoPorRegiao(
                    par.inicio,
                    par.fim,
                    (atual, totalPagsDoc) => {
                        if (typeof onProgress === 'function') {
                            onProgress(idx + 1, listaPares.length, atual, totalPagsDoc, par);
                        }
                    },
                    (pageNum, rawText) => {
                        if (pageNum === pInicio + 1 || pageNum === pInicio + 2 || pageNum === pFim - 1) {
                            amostrasMap.set(pageNum, rawText);
                        }
                    }
                );

                let textoLimpo = (window.JurisUtils && window.JurisUtils.limparTextoPDF)
                    ? window.JurisUtils.limparTextoPDF(textoBruto)
                    : textoBruto;

                // Passagem ÚNICA de sanitização: Ruído Estrutural + Borracha Mágica + LGPD
                textoLimpo = aplicarFiltrosAvancados(textoLimpo, docTipo, amostrasMap, pInicio, pFim);

                resultados.push({
                    docTipo,
                    nome: par.nome || docTipo,
                    categoria: par.categoria || (window.JurisPecas ? JurisPecas.classificarPeca(docTipo) : 'outra'),
                    pInicio,
                    pFim,
                    envelopado: enveloparTeorIntegral(docTipo, textoLimpo)
                });
            } catch (extraError) {
                if (extraError.message && extraError.message.includes('CONCURRENCY_VIOLATION')) {
                    throw extraError;
                }
                console.warn(`[ExportManager AI] Falha ao extrair ${docTipo}:`, extraError);
                resultados.push({
                    docTipo,
                    nome: par.nome || docTipo,
                    categoria: par.categoria || 'outra',
                    pInicio: par.inicio.pagina,
                    pFim: par.fim.pagina,
                    envelopado: `<${tagName}>\n[AVISO DE SISTEMA: Falha na extração. Possível página corrompida.]\n</${tagName}>`
                });
            }
        }

        return resultados;
    }

    /**
     * Fachada pública protegida pela trava global `_isExporting` (consumida pelo Gerador de Contexto).
     */
    async function extrairTeoresIntegrais(listaPares, opts = {}) {
        if (_isExporting) {
            throw new Error('EXPORT_BUSY');
        }
        _isExporting = true;
        try {
            return await _executarExtracaoInterna(listaPares, opts);
        } finally {
            _isExporting = false;
        }
    }

    /**
     * Exportação direta das Peças Gerais (.txt) compartilhando a trava `_isExporting`.
     */
    async function gerarExportacaoGeral(docTiposSelecionados) {
        if (_isExporting) {
            _deps.exibirToast('Uma exportação já está em andamento. Aguarde.', 'aviso');
            return;
        }
        if (!window.PdfEngine || !PdfEngine.getPdfDoc()) {
            _deps.exibirToast('Carregue o PDF do processo para extrair as peças.', 'aviso');
            return;
        }
        if (!window.GeneralPinsManager || !Array.isArray(docTiposSelecionados) || docTiposSelecionados.length === 0) {
            _deps.exibirToast('Selecione ao menos uma peça pronta para exportar.', 'aviso');
            return;
        }

        const mapaPecas = new Map(GeneralPinsManager.obterPecasAgrupadas().map(p => [p.docTipo, p]));
        const paresSelecionados = docTiposSelecionados
            .map(dt => mapaPecas.get(dt))
            .filter(p => p && p.completa && !p.invalida);

        if (paresSelecionados.length === 0) {
            _deps.exibirToast('Nenhuma peça válida e completa selecionada.', 'aviso');
            return;
        }

        _isExporting = true;
        _deps.exibirToast('⏳ Iniciando extração de Peças Gerais em segundo plano...', 'info');

        try {
            const extraidos = await _executarExtracaoInterna(paresSelecionados, {
                onProgress: (docNum, totalDocs, atual, totalPags) => {
                    _deps.exibirToast(`⏳ Peça Geral ${docNum}/${totalDocs} (Pág ${atual} de ${totalPags})...`, 'info');
                }
            });

            const tagDom = document.getElementById('tag-numero-processo');
            const numProcesso = tagDom && tagDom.style.display !== 'none' ? tagDom.textContent.trim() : '';
            const prefixoStr = numProcesso ? `${numProcesso}_` : '';

            const indiceResumo = extraidos.map(item => {
                const flIni = PdfEngine.getDisplayLabel(item.pInicio);
                const flFim = PdfEngine.getDisplayLabel(item.pFim);
                return `- ${item.nome} (fl. ${flIni} a fl. ${flFim})`;
            });

            const conteudoFinal = [
                '====================================================================',
                'JURIS NOTES (AI) — EXPORTAÇÃO DE PEÇAS ESSENCIAIS DO PROCESSO (GERAL)',
                `Processo: ${numProcesso || (window.BackupManager?.getProcessoId?.() || 'Não identificado')}`,
                `Peças incluídas:\n${indiceResumo.join('\n')}`,
                '====================================================================',
                '',
                extraidos.map(i => i.envelopado).join('\n\n')
            ].join('\n');

            _downloadArquivo(`${prefixoStr}AI_pecas_gerais_TEOR_INTEGRAL.txt`, conteudoFinal, 'text/plain;charset=utf-8;');
            _deps.exibirToast(`✅ Arquivo com ${extraidos.length} Peça(s) Geral(is) gerado com sucesso!`, 'sucesso');
        } catch (error) {
            console.error('[ExportManager AI] Erro na exportação de Peças Gerais:', error);
            if (error.message && error.message.includes('CONCURRENCY_VIOLATION')) {
                _deps.exibirToast('Exportação abortada: O documento PDF foi alterado.', 'erro');
            } else {
                _deps.exibirToast('Erro crítico ao extrair Peças Gerais. Verifique o console.', 'erro');
            }
        } finally {
            _isExporting = false;
        }
    }

    function abrirPainelExportacao(opcoes = {}) {
        const activeId = _deps.getActiveTabId();
        if (!activeId) {
            if (window.GeneralPinsManager) {
                GeneralPinsManager.abrirModal();
                return;
            }
            _deps.exibirToast('Selecione um tópico antes de exportar.', 'aviso');
            return;
        }

        const topico = _deps.getTopicos().find(t => t.id === activeId);
        if (!topico) {
            _deps.exibirToast('Tópico inválido ou não encontrado.', 'aviso');
            return;
        }

        const modalHub = document.getElementById('modal-exportacao-avancada');
        const jaEstavaAberto = Boolean(modalHub && modalHub.style.display === 'block');
        if (!opcoes.pularGuardrail && !jaEstavaAberto) {
            const moduloAtual = window.JURIS_MODULE === 'ED' ? 'Embargos' : 'Agravo';
            if (window.BalancaManager && !window.BalancaManager.executarGuardrailDeTarefas(`gerar o pacote de exportação de ${moduloAtual}`)) {
                _deps.exibirToast('Exportação interrompida pelo usuário.', 'aviso');
                return;
            }
        }

        const container = document.getElementById('export-options-container');
        _documentosParaExtracaoCache = {};
        const htmlBuffer = [];

        const temAnotacoes = Array.isArray(topico.anotacoes) && topico.anotacoes.length > 0;
        const totalPaginasPdf = window.PdfEngine?.getPdfDoc?.()?.numPages || null;
        const marcosGerais = window.GeneralPinsManager ? GeneralPinsManager.getMarcos() : [];
        const pecasEfetivas = window.JurisPecas
            ? JurisPecas.obterMarcosEfetivos(topico, marcosGerais, totalPaginasPdf)
            : [];

        htmlBuffer.push(`
            <label class="export-option-card matriz-destaque-ro ${temAnotacoes ? '' : 'locked-option'}">
                <input type="checkbox" id="checkbox-matriz-export" class="export-control-checkbox" ${temAnotacoes ? 'checked' : 'disabled'}>
                <div class="export-option-details">
                    <span class="export-option-title">Matriz Probatória (Juris Notes) + Imagens Anexas</span>
                    <span class="export-option-subtitle">${temAnotacoes
                        ? 'Teses, diretrizes e o download das provas visuais demarcadas.'
                        : 'Tópico ainda sem anotações. Você pode exportar apenas peças vinculadas ou abrir "Peças Gerais" acima.'}</span>
                </div>
            </label>
        `);

        const regras = _carregarRegrasFiltro();
        const svgPin = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 11.78L20.24 16H13v6l-1 2-1-2v-6H3.76L8 11.78V4h1V2h6v2h1v7.78z"></path></svg>`;
        const svgEraser = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;

        pecasEfetivas.forEach(peca => {
            const isExportavel = peca.completa && !peca.invalida;
            if (isExportavel) _documentosParaExtracaoCache[peca.docTipo] = peca;

            const nomeSeguro = _escapeXmlAttr(peca.nome);
            const docTipoAttr = _escapeXmlAttr(peca.docTipo);
            const topicoIdAttr = _escapeXmlAttr(topico.id);
            const hasRegra = Boolean(regras[peca.docTipo]);
            const isGeral = peca.origem === 'geral';

            const btnBorracha = `<button type="button" class="pin-eraser-btn trigger-borracha ${hasRegra ? 'is-active' : ''}" data-doc-tipo="${docTipoAttr}" data-doc-nome="${nomeSeguro}" title="Borracha Mágica">${svgEraser}</button>`;

            let controlesPin = '';
            if (isGeral) {
                controlesPin = `<button type="button" class="btn-desvincular-geral" data-export-action="desvincular-geral" data-topico-id="${topicoIdAttr}" data-doc-tipo="${docTipoAttr}" title="Desvincular deste tópico (mantém salva em Peças Gerais)">✕ Desvincular</button>`;
            } else {
                const flIniTitle = peca.inicio ? (window.PdfEngine?.getDisplayLabel?.(peca.inicio.pagina) ?? peca.inicio.pagina) : '';
                const flFimTitle = peca.fim ? (window.PdfEngine?.getDisplayLabel?.(peca.fim.pagina) ?? peca.fim.pagina) : '';

                const btnInicio = peca.inicio
                    ? `<button type="button" class="pin-action-btn pin-start-active" data-export-action="excluir-proprio" data-topico-id="${topicoIdAttr}" data-doc-tipo="${docTipoAttr}" data-fronteira="inicio" title="Excluir Início (Fl. ${flIniTitle})">${svgPin}</button>`
                    : `<button type="button" class="pin-action-btn pin-missing" title="Falta Marcador de Início" disabled>${svgPin}</button>`;

                const btnFim = peca.fim
                    ? `<button type="button" class="pin-action-btn pin-end-active" data-export-action="excluir-proprio" data-topico-id="${topicoIdAttr}" data-doc-tipo="${docTipoAttr}" data-fronteira="fim" title="Excluir Fim (Fl. ${flFimTitle})">${svgPin}</button>`
                    : `<button type="button" class="pin-action-btn pin-missing" title="Falta Marcador de Fim" disabled>${svgPin}</button>`;

                controlesPin = `${btnInicio}${btnFim}`;
            }

            let statusTexto = '';
            if (peca.invalida) {
                statusTexto = `<span style="color:#c62828; font-weight:700;">⚠️ ${_escapeXmlAttr(peca.motivoInvalida)}</span>`;
            } else if (peca.completa) {
                const flIni = window.PdfEngine?.getDisplayLabel?.(peca.inicio.pagina) ?? peca.inicio.pagina;
                const flFim = window.PdfEngine?.getDisplayLabel?.(peca.fim.pagina) ?? peca.fim.pagina;
                statusTexto = `Conteúdo capturado entre as fls. ${flIni} e ${flFim}.`;
            } else {
                statusTexto = `<span style="color:#c62828; font-weight:700;">⚠️ Extração bloqueada: Faltam marcadores.</span>`;
            }

            const originBadge = isGeral
                ? `<span class="export-origin-pill" title="Vínculo vivo com Peças Gerais">🔗 Peça Geral</span>`
                : '';

            htmlBuffer.push(`
                <label class="export-option-card ${!isExportavel ? 'locked-option' : ''} ${isGeral ? 'is-linked-from-geral' : ''}">
                    <input type="checkbox" value="${docTipoAttr}" class="extra-doc-checkbox export-control-checkbox" ${isExportavel ? 'checked' : 'disabled'}>
                    <div class="export-option-details">
                        <span class="export-option-title">Teor Integral: ${nomeSeguro}${originBadge}</span>
                        <span class="export-option-subtitle">${statusTexto}</span>
                    </div>
                    <div class="export-pin-controls">
                        ${btnBorracha}
                        ${controlesPin}
                    </div>
                </label>
            `);
        });

        container.innerHTML = htmlBuffer.join('');
        _sincronizarHubExportacaoAoAbrir();

        if (window.GeneralPinsManager) GeneralPinsManager.atualizarIndicadoresUI();

        document.getElementById('export-avancado-backdrop').style.display = 'block';
        document.getElementById('modal-exportacao-avancada').style.display = 'block';

        const btnExportar = document.getElementById('btn-gerar-arquivo-exportacao');
        if (btnExportar) {
            const totalChecked = container.querySelectorAll('.export-control-checkbox:checked').length;
            btnExportar.disabled = totalChecked === 0;
            btnExportar.style.opacity = totalChecked === 0 ? '0.4' : '1';
            btnExportar.style.cursor = totalChecked === 0 ? 'not-allowed' : 'pointer';
        }
    }

    function _sincronizarHubExportacaoAoAbrir() {
        const chkExport = document.getElementById('chk-export-auditoria-critica');
        if (chkExport) chkExport.checked = isAuditoriaCriticaAtiva();

        const container = document.getElementById('export-options-container');
        if (container && container.dataset.exportEventsBound !== 'true') {
            container.addEventListener('click', function (e) {
                const btnBorrachaTarget = e.target.closest('.trigger-borracha');
                if (btnBorrachaTarget) {
                    e.preventDefault();
                    e.stopPropagation();
                    abrirModalFiltro(btnBorrachaTarget.dataset.docTipo, btnBorrachaTarget.dataset.docNome);
                    return;
                }

                const btnDesvincular = e.target.closest('[data-export-action="desvincular-geral"]');
                if (btnDesvincular) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.GeneralPinsManager?.desvincularDoTopico(
                        btnDesvincular.dataset.topicoId,
                        btnDesvincular.dataset.docTipo
                    );
                    return;
                }

                const btnExcluirProprio = e.target.closest('[data-export-action="excluir-proprio"]');
                if (btnExcluirProprio) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.excluirMarcadorExtracao?.(
                        btnExcluirProprio.dataset.topicoId,
                        btnExcluirProprio.dataset.docTipo,
                        btnExcluirProprio.dataset.fronteira
                    );
                }
            });

            container.addEventListener('change', function (e) {
                if (e.target && e.target.classList.contains('export-control-checkbox')) {
                    const btnAtual = document.getElementById('btn-gerar-arquivo-exportacao');
                    if (!btnAtual) return;
                    const totalChecked = container.querySelectorAll('.export-control-checkbox:checked').length;
                    btnAtual.disabled = totalChecked === 0;
                    btnAtual.style.opacity = totalChecked === 0 ? '0.4' : '1';
                    btnAtual.style.cursor = totalChecked === 0 ? 'not-allowed' : 'pointer';
                }
            });

            container.dataset.exportEventsBound = 'true';
        }
    }

    function fecharPainelExportacao() {
        document.getElementById('export-avancado-backdrop').style.display = 'none';
        document.getElementById('modal-exportacao-avancada').style.display = 'none';
    }

    function abrirModalFiltro(docTipo, nomeDocAmigavel, opcoes = {}) {
        _filtroOnAfterSave = typeof opcoes.onAfterSave === 'function' ? opcoes.onAfterSave : null;
        const regras = _carregarRegrasFiltro();
        document.getElementById('hidden-doc-tipo-filtro').value = docTipo;
        document.getElementById('label-doc-filtro').textContent = nomeDocAmigavel;
        document.getElementById('textarea-filtro-repeticao').value = regras[docTipo] || '';
        validarTamanhoFiltro();
        
        document.getElementById('filtro-repeticao-backdrop').style.display = 'block';
        document.getElementById('modal-filtro-repeticao').style.display = 'block';
    }

    function fecharModalFiltro() {
        _filtroOnAfterSave = null;
        document.getElementById('filtro-repeticao-backdrop').style.display = 'none';
        document.getElementById('modal-filtro-repeticao').style.display = 'none';
    }

    function validarTamanhoFiltro() {
        const texto = document.getElementById('textarea-filtro-repeticao').value.trim();
        const btnSalvar = document.getElementById('btn-salvar-filtro');
        const aviso = document.getElementById('aviso-tamanho-filtro');
        
        if (texto.length > 0 && texto.length < 20) {
            btnSalvar.disabled = true;
            btnSalvar.style.opacity = '0.5';
            aviso.style.display = 'block';
        } else {
            btnSalvar.disabled = false;
            btnSalvar.style.opacity = '1';
            aviso.style.display = 'none';
        }
    }

    function salvarFiltro() {
        const docTipo = document.getElementById('hidden-doc-tipo-filtro').value;
        const texto = document.getElementById('textarea-filtro-repeticao').value.trim();
        const regras = _carregarRegrasFiltro();
        
        if (texto.length >= 20) {
            regras[docTipo] = texto;
            _salvarRegrasFiltro();
            _deps.exibirToast('Regra de limpeza salva para esta peça!', 'sucesso');
        } else if (texto.length === 0) {
            delete regras[docTipo];
            _salvarRegrasFiltro();
            _deps.exibirToast('Regra desativada.', 'info');
        }
        
        const cb = _filtroOnAfterSave;
        fecharModalFiltro();

        if (cb) cb();
        else abrirPainelExportacao({ pularGuardrail: true });
    }

    function limparFiltro() {
        document.getElementById('textarea-filtro-repeticao').value = '';
        salvarFiltro();
    }

    async function gerarExportacaoPersonalizada() {
        if (_isExporting) {
            _deps.exibirToast('Uma exportação já está em andamento. Aguarde.', 'aviso');
            return;
        }

        const topicos = _deps.getTopicos();
        const topico = topicos.find(t => t.id === _deps.getActiveTabId());
        if (!topico) {
            _deps.exibirToast('Tópico inválido ou não encontrado.', 'aviso');
            return;
        }

        const elMatriz = document.getElementById('checkbox-matriz-export');
        const temAnotacoes = Array.isArray(topico.anotacoes) && topico.anotacoes.length > 0;
        const incluirMatriz = Boolean(elMatriz && elMatriz.checked && temAnotacoes);
        const elAuditHub = document.getElementById('chk-export-auditoria-critica');
        const auditoriaHub = elAuditHub ? elAuditHub.checked : isAuditoriaCriticaAtiva();
        const checkboxesDocsExtra = Array.from(document.querySelectorAll('.extra-doc-checkbox:checked'));

        if (!incluirMatriz && checkboxesDocsExtra.length === 0) {
            _deps.exibirToast('Selecione ao menos um item para exportar.', 'aviso');
            return;
        }

        if (checkboxesDocsExtra.length > 0 && (!window.PdfEngine || !PdfEngine.getPdfDoc())) {
            _deps.exibirToast('Carregue o PDF do processo para extrair os documentos integrais.', 'aviso');
            return;
        }

        const btn = document.getElementById('btn-gerar-arquivo-exportacao');
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Extraindo Dados do PDF...';
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.7';

        _isExporting = true;

        try {
            let conteudoFinal = "";
            const config = ESQUEMAS_CONTEXTO[window.JURIS_MODULE || 'AI'];

            // 1. Injeção de Contexto (Obrigatório para o LLM não se perder)
            if (incluirMatriz) {
                conteudoFinal += _gerarMarkdown(topico, { auditoria: auditoriaHub }) + "\n\n";
            } else {
                const nomeTopicoFormatado = (topico.nome || 'Não Nomeado').toUpperCase();
                const avisoSemMatriz = temAnotacoes
                    ? '[AVISO DE SISTEMA]: O usuário optou por não enviar a matriz probatória. Use os documentos integrais abaixo para análise.'
                    : '[AVISO DE SISTEMA]: Tópico composto apenas por peças integrais (não há matriz probatória cadastrada até o momento). Use os documentos integrais abaixo para análise.';
                conteudoFinal += `# ${config.tituloTopico}: **${nomeTopicoFormatado}**\n${avisoSemMatriz}\n\n`;
            }

            // 2. Anexação dos Documentos Complementares (via motor interno compartilhado)
            if (checkboxesDocsExtra.length > 0) {
                conteudoFinal += "<!-- ==========================================\n";
                conteudoFinal += incluirMatriz
                    ? "     DOCUMENTOS COMPLEMENTARES ANEXOS\n"
                    : "     TEOR INTEGRAL DE PEÇAS E DOCUMENTOS\n";
                conteudoFinal += "     ========================================== -->\n\n";

                const paresSelecionados = checkboxesDocsExtra
                    .map(cb => _documentosParaExtracaoCache[cb.value])
                    .filter(Boolean);

                const extraidos = await _executarExtracaoInterna(paresSelecionados, {
                    onProgress: (docNumber, totalDocs, atual, totalPagsDoc) => {
                        _deps.exibirToast(`⏳ Processando Peça ${docNumber}/${totalDocs} (Pág ${atual} de ${totalPagsDoc})...`, 'info');
                    }
                });

                extraidos.forEach(item => {
                    conteudoFinal += item.envelopado + '\n\n';
                });
            }

            if (incluirMatriz) {
                conteudoFinal += gerarLembreteFinalHierarquia(topico, { auditoria: auditoriaHub });
            }

            // 3. Fila de Downloads Visuais (Restrita à Matriz — numeração visual sincronizada com a tela/PDF)
            const filaDeDownloads = [];
            if (incluirMatriz) {
                const mapaVisuais = _construirMapaVisualExport(topico.anotacoes);
                (topico.anotacoes || []).forEach((an, idx) => {
                    if (_ehCheckpoint(an)) return;
                    const numIdeia = mapaVisuais.get(idx);
                    if (an.tipo === 'imagem') {
                        filaDeDownloads.push({ dados: an.conteudo, nome: _gerarNomeArquivoImagem(topico.id, numIdeia) });
                    }
                    if (an.itensCorrelacionados && an.itensCorrelacionados.length > 0) {
                        an.itensCorrelacionados.forEach((corr, corrIdx) => {
                            if (corr.tipo === 'imagem') {
                                filaDeDownloads.push({ dados: corr.conteudo, nome: _gerarNomeArquivoImagem(topico.id, numIdeia, corrIdx + 1) });
                            }
                        });
                    }
                });
            }

            // 4. Fechamento e Download Dinâmico
            const nomeBase = topico.nome || 'Exportacao_AI';
            const nomeSanitizado = nomeBase.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            const tagDom = document.getElementById('tag-numero-processo');
            const numProcesso = tagDom && tagDom.style.display !== 'none' ? tagDom.textContent.trim() : '';
            const prefixoProcessoStr = numProcesso ? `${numProcesso}_` : '';
            
            const sufixoArquivo = incluirMatriz ? "_CONTEXTO_RAG.txt" : "_TEOR_INTEGRAL.txt";
            const nomeArquivoFinal = `${config.prefixoArquivo}${prefixoProcessoStr}${nomeSanitizado}${sufixoArquivo}`;

            _downloadArquivo(nomeArquivoFinal, conteudoFinal, 'text/plain;charset=utf-8;');
            
            if (filaDeDownloads.length > 0) {
                _deps.exibirToast('Texto exportado. Iniciando imagens...', 'info');
                _executarFilaDeDownloads(filaDeDownloads);
            } else {
                _deps.exibirToast('Arquivo gerado com sucesso!', 'sucesso');
            }
            
            fecharPainelExportacao();

        } catch (error) {
            console.error(`[ExportManager AI] Erro fatal na exportação:`, error);
            if (error.message && error.message.includes('CONCURRENCY_VIOLATION')) {
                _deps.exibirToast('Exportação abortada: O documento PDF foi alterado.', 'erro');
            } else {
                _deps.exibirToast('Erro crítico ao gerar arquivo. Verifique o console.', 'erro');
            }
        } finally {
            _isExporting = false;
            btn.innerHTML = originalText;
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
        }
    }

    // ========================================================================
    // API PÚBLICA
    // ========================================================================
    
    function obterDadosDoTopicoAtivo(opcoes = {}) {
        const activeTabId = _deps.getActiveTabId();
        if (!activeTabId) return null;

        const topicosArray = _deps.getTopicos();
        if (!topicosArray || !Array.isArray(topicosArray)) return null;

        const topicoAtivo = topicosArray.find(t => t.id === activeTabId);
        if (!topicoAtivo) return null;

        const temAnotacoes = Array.isArray(topicoAtivo.anotacoes) && topicoAtivo.anotacoes.length > 0;
        const temPreambuloOuGlobal = Boolean(
            topicoAtivo.alegacoes ||
            topicoAtivo.fundamentos ||
            topicoAtivo.veredito ||
            (Array.isArray(topicoAtivo.diretrizesGlobais) && topicoAtivo.diretrizesGlobais.length > 0)
        );

        if (!temAnotacoes && !(opcoes.permitirSemAnotacoes && temPreambuloOuGlobal)) {
            return null;
        }

        return {
            nome: topicoAtivo.nome || 'Tópico Sem Nome',
            markdown: _gerarMarkdown(topicoAtivo, opcoes)
        };
    }

    /**
     * Aplica as duas camadas de sanitização (LGPD) sobre um texto extraído do PDF:
     *   1. Automática — remove ruído estrutural repetido entre páginas (cabeçalhos/rodapés).
     *   2. Manual — aplica a regra fuzzy cadastrada pelo usuário na Borracha Mágica.
     */
    function aplicarFiltrosAvancados(textoLimpo, docTipo, amostrasMap, pInicio, pFim) {
        let textoProcessado = textoLimpo;

        // 1. CAMADA AUTOMÁTICA (Ruído Estrutural)
        if (window.JurisUtils && window.JurisUtils.descobrirRuidosEstruturais && amostrasMap && amostrasMap.size > 0) {
            let textoA = amostrasMap.get(pInicio + 1) || "";
            let textoB = amostrasMap.get(pInicio + 2) || amostrasMap.get(pFim - 1) || "";

            if (textoA && textoB) {
                textoA = window.JurisUtils.limparTextoPDF(textoA);
                textoB = window.JurisUtils.limparTextoPDF(textoB);
                const esqueletosAutonomos = window.JurisUtils.descobrirRuidosEstruturais(textoA, textoB);

                esqueletosAutonomos.forEach(esqueleto => {
                    textoProcessado = window.JurisUtils.removerTrechoFuzzy(textoProcessado, esqueleto, MARCADOR_RUIDOS, true);
                });
            }
        }

        // 2. CAMADA MANUAL (Regras da Borracha Mágica — LGPD)
        // Alterado de removerTrechoFuzzy (pesado) para a Regex tolerante para garantir 
        // a mesma estabilidade da limpeza alcançada no módulo RO.
        const regras = _carregarRegrasFiltro();
        if (regras[docTipo] && window.JurisUtils && window.JurisUtils.criarRegexDeRepeticao) {
            const regex = window.JurisUtils.criarRegexDeRepeticao(regras[docTipo]);
            if (regex) {
                // Remove o texto e deixa uma quebra de linha invisível para não poluir os tokens da IA
                textoProcessado = textoProcessado.replace(regex, '\n');
            }
        }

        // 3. CAMADA DE TERMOS CURTOS (LGPD) — Consome a função pura sem acoplamento com o DOM do modal
        if (window.QuickRedactManager && typeof window.QuickRedactManager.sanitizarString === 'function') {
            textoProcessado = window.QuickRedactManager.sanitizarString(textoProcessado);
        }

        return textoProcessado;
    }

    return {
        SCHEMA_EXPORT_VERSAO,
        TITULO_SECAO_AUDITORIA,
        REGIME_INTENCOES,
        CHAVE_OBICE_SEM_NOME,
        CHAVE_TESE_SEM_NOME,
        gerarLegendaRegimesRedacionais,
        formatarNoEditorialMarkdown,
        verificarAncorasLiteraisNoRascunho,
        obterDadosDoTopicoAtivo,
        abrirPainelExportacao,
        fecharPainelExportacao,
        isExporting,
        extrairTeoresIntegrais,
        gerarExportacaoGeral,
        temRegraFiltro,
        gerarExportacaoPersonalizada,
        aplicarFiltrosAvancados,
        enveloparTeorIntegral,
        gerarLembreteFinalHierarquia,
        isAuditoriaCriticaAtiva,
        setAuditoriaCriticaAtiva,
        abrirModalFiltro,
        fecharModalFiltro,
        validarTamanhoFiltro,
        salvarFiltro,
        limparFiltro,
        
        init: function (dependencies) {
            _deps = { ..._deps, ...dependencies };
        },

        // Função legada mantida no objeto de retorno caso haja dependências antigas
        exportarTopicoAtivo: async function () {
            abrirPainelExportacao();
        }
    };

})();