/* ================================================
   ed_pecas-service.js — v1.0
   Serviço Puro de Domínio para Peças e Marcos de Extração (ED — SSOT)
   Suporte nativo a chave composta ciente de polo: `${docTipo}|${polo}`
   Sem dependência de DOM ou Storage.
   ================================================ */
window.JurisPecas = (function () {
    'use strict';

    const DOC_NOMES = Object.freeze({
        decisao: 'Decisão Embargada (Sentença/Acórdão)',
        embargos: 'Inteiro Teor dos Embargos',
        recurso_ordinario: 'Recurso Ordinário',
        contrarrazoes: 'Contrarrazões ao RO',
        contraminuta: 'Contraminuta aos EDs',
        peticao_inicial: 'Petição Inicial',
        contestacao: 'Contestação',
        impugnacao_contestacao: 'Impugnação à Contestação',
        audiencia_instrucao: 'Audiência de Instrução',
        sentenca_primeiro_grau: 'Sentença de 1º Grau (Origem)',
        laudo_pericial: 'Laudo Pericial',
        atos_secretaria: 'Atos da Secretaria / Certidões'
    });

    // Sets fechados (lookup O(1)) — elimina falsos positivos por substring e protege custom_* / sentenca_primeiro_grau
    const SET_DECISAO = new Set(['decisao']);
    const SET_EMBARGOS = new Set(['embargos']);
    const SET_RESPOSTA = new Set([
        'contraminuta',
        'contrarrazoes'
    ]);

    function normalizarPolo(polo) {
        const limpo = polo ? String(polo).trim() : '';
        return limpo || 'Comum';
    }

    function gerarChaveComposta(docTipo, polo = 'Comum') {
        const tipoLimpo = String(docTipo || '').trim();
        return `${tipoLimpo}|${normalizarPolo(polo)}`;
    }

    function parseChaveComposta(chave) {
        if (!chave) {
            return { docTipo: '', polo: 'Comum', chave: '|Comum' };
        }
        const str = String(chave);
        const sepIdx = str.indexOf('|');
        if (sepIdx === -1) {
            const docTipo = str.trim();
            return { docTipo, polo: 'Comum', chave: `${docTipo}|Comum` };
        }
        const docTipo = str.slice(0, sepIdx).trim();
        const polo = normalizarPolo(str.slice(sepIdx + 1));
        return { docTipo, polo, chave: `${docTipo}|${polo}` };
    }

    function normalizarChave(chaveOuDocTipo, poloOpcional = null) {
        if (poloOpcional !== null && poloOpcional !== undefined) {
            return gerarChaveComposta(chaveOuDocTipo, poloOpcional);
        }
        return parseChaveComposta(chaveOuDocTipo).chave;
    }

    /**
     * Resolve o nome legível de uma peça processual do ED.
     * - Com 2 argumentos (docTipo, docLabel): retorna apenas o nome-base (ideal para tooltip que já exibe Polo separado).
     * - Com 3 argumentos (docTipo, docLabel, polo): anexa ` (${polo})` quando polo !== 'Comum'.
     */
    function resolverNome(docTipo, docLabel = null, polo = 'Comum') {
        let base;
        if (docLabel && String(docLabel).trim()) {
            base = String(docLabel).trim();
        } else if (DOC_NOMES[docTipo]) {
            base = DOC_NOMES[docTipo];
        } else if (!docTipo) {
            base = 'Peça Processual';
        } else {
            base = String(docTipo)
                .replace(/^custom_/, '')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
        }

        const poloNorm = normalizarPolo(polo);
        return poloNorm !== 'Comum' ? `${base} (${poloNorm})` : base;
    }

    /**
     * Classificação estrita para Embargos de Declaração:
     *  - 'decisao'   -> apenas decisao (Decisão Embargada; sentenca_primeiro_grau NÃO entra aqui)
     *  - 'embargos'  -> apenas embargos (Inteiro Teor dos Embargos)
     *  - 'resposta'  -> contraminuta e contrarrazoes (roteadas a Confronto; não acendem "Contexto Completo")
     *  - 'confronto' -> demais peças de origem/provas e todas as peças personalizadas (custom_*)
     * @returns {'decisao' | 'embargos' | 'resposta' | 'confronto'}
     */
    function classificarPeca(docTipoOuChave) {
        if (!docTipoOuChave) return 'confronto';
        const { docTipo } = parseChaveComposta(docTipoOuChave);
        if (!docTipo || docTipo.startsWith('custom_')) return 'confronto';
        if (SET_DECISAO.has(docTipo)) return 'decisao';
        if (SET_EMBARGOS.has(docTipo)) return 'embargos';
        if (SET_RESPOSTA.has(docTipo)) return 'resposta';
        return 'confronto';
    }

    function agruparPares(marcos, totalPaginasPdf = null) {
        const mapa = new Map();

        (Array.isArray(marcos) ? marcos : []).forEach(m => {
            if (!m || !m.docTipo || !m.fronteira) return;
            const polo = normalizarPolo(m.polo);
            const chave = gerarChaveComposta(m.docTipo, polo);

            if (!mapa.has(chave)) {
                mapa.set(chave, {
                    chave,
                    docTipo: m.docTipo,
                    docLabel: m.docLabel || null,
                    polo,
                    inicio: null,
                    fim: null
                });
            }

            const grupo = mapa.get(chave);
            if (m.docLabel && !grupo.docLabel) grupo.docLabel = m.docLabel;
            if (m.fronteira === 'inicio') grupo.inicio = m;
            if (m.fronteira === 'fim') grupo.fim = m;
        });

        const temLimite = Number.isInteger(totalPaginasPdf) && totalPaginasPdf > 0;

        return Array.from(mapa.values()).map(item => {
            const completa = Boolean(item.inicio && item.fim);
            const inicioFora = Boolean(temLimite && item.inicio && item.inicio.pagina > totalPaginasPdf);
            const fimFora = Boolean(temLimite && item.fim && item.fim.pagina > totalPaginasPdf);
            const invalida = inicioFora || fimFora;

            let motivoInvalida = null;
            if (invalida) {
                const pags = [
                    inicioFora ? item.inicio.pagina : null,
                    fimFora ? item.fim.pagina : null
                ].filter(Boolean);
                motivoInvalida = `Página(s) ${pags.join(', ')} excedem o PDF atual (${totalPaginasPdf} págs.).`;
            }

            return {
                ...item,
                nomeBase: resolverNome(item.docTipo, item.docLabel),
                nome: resolverNome(item.docTipo, item.docLabel, item.polo),
                categoria: classificarPeca(item.docTipo),
                completa,
                invalida,
                motivoInvalida
            };
        });
    }

    /**
     * Resolve marcos efetivos de um tópico de ED:
     * marcações próprias em topico.marcosExtracao têm precedência absoluta sobre
     * topico.vinculosGerais para a mesma chave composta (`docTipo|polo`).
     */
    function obterMarcosEfetivos(topico, marcosGerais = [], totalPaginasPdf = null) {
        if (!topico) return [];

        const proprios = agruparPares(topico.marcosExtracao || [], totalPaginasPdf);
        const gerais = agruparPares(marcosGerais || [], totalPaginasPdf);
        const mapaGerais = new Map(gerais.map(g => [g.chave, g]));
        const vinculosSet = new Set(
            (Array.isArray(topico.vinculosGerais) ? topico.vinculosGerais : [])
                .filter(Boolean)
                .map(v => normalizarChave(v))
        );

        const resultado = [];
        const chavesProprias = new Set();

        proprios.forEach(p => {
            chavesProprias.add(p.chave);
            resultado.push({
                ...p,
                origem: 'proprio',
                sobrescreveVinculo: vinculosSet.has(p.chave)
            });
        });

        vinculosSet.forEach(chaveVinculo => {
            if (chavesProprias.has(chaveVinculo)) return;
            const parGeral = mapaGerais.get(chaveVinculo);
            if (!parGeral) return;
            resultado.push({
                ...parGeral,
                origem: 'geral',
                sobrescreveVinculo: false
            });
        });

        return resultado;
    }

    return {
        DOC_NOMES,
        normalizarPolo,
        gerarChaveComposta,
        parseChaveComposta,
        normalizarChave,
        resolverNome,
        classificarPeca,
        agruparPares,
        obterMarcosEfetivos
    };
})();