/* ================================================
   ai_pecas-service.js — v1.0 (Agravo de Instrumento)
   Serviço Puro de Domínio para Peças e Marcos de Extração (SSOT)
   Sem dependência de DOM ou Storage.
   ================================================ */
window.JurisPecas = (function () {
    'use strict';

    // Dicionário adaptado às chaves oficiais do #extrator-doc-select (Módulo AI),
    // mantendo chaves adicionais como fallback de compatibilidade entre módulos.
    const DOC_NOMES = Object.freeze({
        sentenca: 'Decisão Agravada / Sentença',
        recurso_autora: 'Agravo de Instrumento (Autora)',
        recurso_re: 'Agravo de Instrumento (Ré)',
        contrarrazões_autora: 'Contraminuta (Autora)',
        contrarrazões_re: 'Contraminuta (Ré)',
        contrarrazoes_autora: 'Contraminuta (Autora)',
        contrarrazoes_re: 'Contraminuta (Ré)',
        inicial: 'Recurso Ordinário Trancado',
        // Fallbacks de compatibilidade (outros módulos / backups legados)
        agravo_peticao_exequente: 'Agravo de Petição (Exequente)',
        agravo_peticao_executada: 'Agravo de Petição (Executada)',
        agravo_peticao_terceiro: 'Agravo de Petição (Terceiro)',
        contraminuta_agravo: 'Contraminuta (ao Agravo)',
        contestacao: 'Contestação'
    });

    // Sets fechados (lookup O(1)) — elimina falsos positivos por substring em peças custom_*
    const SET_DECISAO = new Set(['sentenca']);
    const SET_RECURSO = new Set([
        'recurso_autora',
        'recurso_re',
        'agravo_peticao_exequente',
        'agravo_peticao_executada',
        'agravo_peticao_terceiro'
    ]);
    const SET_RESPOSTA = new Set([
        'contrarrazões_autora',
        'contrarrazões_re',
        'contrarrazoes_autora',
        'contrarrazoes_re',
        'contraminuta_agravo'
    ]);

    function resolverNome(docTipo, docLabel = null) {
        if (docLabel && String(docLabel).trim()) return String(docLabel).trim();
        if (DOC_NOMES[docTipo]) return DOC_NOMES[docTipo];
        if (!docTipo) return 'Peça Processual';
        return String(docTipo)
            .replace(/^custom_/, '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    /**
     * Classificação estrita (Módulo AI):
     *  - 'decisao'  -> apenas sentenca (Decisão Agravada / Sentença)
     *  - 'recurso'  -> apenas agravos de instrumento / agravos de petição
     *  - 'resposta' -> contraminuta (não contamina <inteiro_teor_recurso> nem acende "Contexto Completo")
     *  - 'outra'    -> Recurso Ordinário Trancado (inicial), contestação e todas as peças personalizadas (custom_*)
     * @returns {'decisao' | 'recurso' | 'resposta' | 'outra'}
     */
    function classificarPeca(docTipo) {
        if (!docTipo) return 'outra';
        const chave = String(docTipo).trim();
        if (chave.startsWith('custom_')) return 'outra';
        if (SET_DECISAO.has(chave)) return 'decisao';
        if (SET_RECURSO.has(chave)) return 'recurso';
        if (SET_RESPOSTA.has(chave)) return 'resposta';
        return 'outra';
    }

    function agruparPares(marcos, totalPaginasPdf = null) {
        const mapa = new Map();

        (Array.isArray(marcos) ? marcos : []).forEach(m => {
            if (!m || !m.docTipo || !m.fronteira) return;
            if (!mapa.has(m.docTipo)) {
                mapa.set(m.docTipo, {
                    docTipo: m.docTipo,
                    docLabel: m.docLabel || null,
                    inicio: null,
                    fim: null
                });
            }
            const grupo = mapa.get(m.docTipo);
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
                nome: resolverNome(item.docTipo, item.docLabel),
                categoria: classificarPeca(item.docTipo),
                completa,
                invalida,
                motivoInvalida
            };
        });
    }

    /**
     * Resolve marcos efetivos de um tópico (marcações próprias têm precedência absoluta sobre vinculosGerais).
     */
    function obterMarcosEfetivos(topico, marcosGerais = [], totalPaginasPdf = null) {
        if (!topico) return [];

        const proprios = agruparPares(topico.marcosExtracao || [], totalPaginasPdf);
        const gerais = agruparPares(marcosGerais || [], totalPaginasPdf);
        const mapaGerais = new Map(gerais.map(g => [g.docTipo, g]));
        const vinculosSet = new Set(Array.isArray(topico.vinculosGerais) ? topico.vinculosGerais : []);

        const resultado = [];
        const docTiposProprios = new Set();

        proprios.forEach(p => {
            docTiposProprios.add(p.docTipo);
            resultado.push({
                ...p,
                origem: 'proprio',
                sobrescreveVinculo: vinculosSet.has(p.docTipo)
            });
        });

        vinculosSet.forEach(docTipo => {
            if (docTiposProprios.has(docTipo)) return;
            const parGeral = mapaGerais.get(docTipo);
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
        resolverNome,
        classificarPeca,
        agruparPares,
        obterMarcosEfetivos
    };
})();