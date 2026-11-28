/* ================================================
   ferramentas/juris-pangea-store.js
   Camada de Persistência Compartilhada (Carregada sob demanda / Lazy) — SDK v10.8.0
   ================================================ */
import { getApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const COLLECTION_MODELOS = 'pangea_gab';
const COLLECTION_META = 'meta';
const DOC_META_ID = 'pangea_gab';
const SCHEMA_VERSION = 2;

/* Contrato explícito de mapeamento (SSOT compartilhado com o coletor para idKeys).
   CONFIRMAR / AJUSTAR após executar a Fase 0 Híbrida no Console do PangeaGAB. */
export const PANGEA_SCHEMA = Object.freeze({
    id: ['id', 'pangeaId', 'codigo'],
    numero: ['nr', 'numero', 'num'],
    especie: ['tipo', 'especie'],
    siglaLocal: ['siglaLocal'],
    localId: ['idLocal', 'localId'],
    nomeLocal: ['nomeLocal', 'localNome'],
    orgao: ['orgao', 'tribunal'],
    tituloOficial: ['tituloOficial', 'cabecalho'],
    questao: ['questao', 'tema', 'titulo'],
    tese: ['tese', 'textoCompleto', 'texto', 'ementa', 'conteudo'],
    etiquetas: ['etiquetas', 'tags'],
    situacao: ['situacao'],
    cancelado: ['cancelado'],
    atualizadoEm: ['ultimaAtualizacao', 'dataAtualizacao', 'atualizadoEm'],
    url: ['url', 'urlPangea', 'link']
});

const ALLOWED_HTML_TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'OL', 'UL', 'LI']);
const FORMAT_TAG_RE = /<(p|br|b|strong|i|em|u|ol|ul|li)\b/i;

let cacheModelos = [];
let cacheMeta = null;
let cacheUid = null;
let authListenerBound = false;

function aguardarAppFirebase(timeoutMs = 6000) {
    if (getApps().length > 0) return Promise.resolve(getApp());
    return new Promise((resolve, reject) => {
        const inicio = Date.now();
        const timer = setInterval(() => {
            if (getApps().length > 0) {
                clearInterval(timer);
                resolve(getApp());
            } else if (Date.now() - inicio >= timeoutMs) {
                clearInterval(timer);
                reject(new Error('Firebase ainda não inicializado neste painel.'));
            }
        }, 50);
    });
}

async function obterContexto() {
    const app = await aguardarAppFirebase();
    const auth = getAuth(app);

    if (!authListenerBound) {
        authListenerBound = true;
        onAuthStateChanged(auth, (user) => {
            const novoUid = user?.uid || null;
            if (novoUid !== cacheUid) {
                cacheModelos = [];
                cacheMeta = null;
                cacheUid = novoUid;
            }
        });
    }

    if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
    }

    const uid = auth.currentUser?.uid || null;
    if (uid !== cacheUid) {
        cacheModelos = [];
        cacheMeta = null;
        cacheUid = uid;
    }

    return { db: getFirestore(app), auth, uid };
}

function extrairCampo(obj, chaves) {
    for (const k of chaves) {
        if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return null;
}

function limparHtmlParaTexto(valor) {
    if (valor === null || valor === undefined) return '';
    const str = String(valor);
    if (!str.trim()) return '';
    if (!/<[a-z][\s\S]*>/i.test(str) && !/&[a-z#0-9]+;/i.test(str)) {
        return str.replace(/\r\n?/g, '\n').trim();
    }
    const parsed = new DOMParser().parseFromString(str, 'text/html');
    parsed.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    parsed.querySelectorAll('p, div, li').forEach(el => el.insertAdjacentText('afterend', '\n'));
    return (parsed.body.textContent || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/* Higiene de schema: persiste teseHtml apenas quando a origem realmente contém formatação HTML */
function sanitizarHtmlCondicional(rawValor) {
    if (typeof rawValor !== 'string' || !FORMAT_TAG_RE.test(rawValor)) return null;
    const parsed = new DOMParser().parseFromString(rawValor, 'text/html');

    const clonarSeguro = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');
        if (node.nodeType !== Node.ELEMENT_NODE) return document.createTextNode('');
        const tag = node.tagName.toUpperCase();
        if (ALLOWED_HTML_TAGS.has(tag)) {
            const cleanEl = document.createElement(tag.toLowerCase());
            node.childNodes.forEach(child => cleanEl.appendChild(clonarSeguro(child)));
            return cleanEl;
        }
        const frag = document.createDocumentFragment();
        node.childNodes.forEach(child => frag.appendChild(clonarSeguro(child)));
        return frag;
    };

    const container = document.createElement('div');
    parsed.body.childNodes.forEach(child => container.appendChild(clonarSeguro(child)));
    const htmlLimpo = container.innerHTML.trim();
    return htmlLimpo && FORMAT_TAG_RE.test(htmlLimpo) ? htmlLimpo : null;
}

function validarUrlPangea(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        const u = new URL(rawUrl.trim());
        if (u.protocol === 'https:' && u.hostname === 'pangea.trt4.jus.br') return u.href;
    } catch {}
    return '';
}

function normalizarEtiquetas(rawTags) {
    if (!rawTags) return [];
    if (typeof rawTags === 'string') return rawTags.split(/[;,]/).map(s => s.trim()).filter(Boolean);
    if (Array.isArray(rawTags)) {
        return rawTags.map(t => {
            if (typeof t === 'string') return t.trim();
            if (t && typeof t === 'object') return String(t.texto || t.nome || t.descricao || '').trim();
            return '';
        }).filter(Boolean);
    }
    return [];
}

function sanitizarDocId(valor) {
    return String(valor || '').trim().replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 120);
}

function gerarHashConteudo(item) {
    const base = JSON.stringify([
        item.tituloOficial || '',
        item.questao || '',
        item.tese || '',
        item.teseHtml || '',
        item.especie || '',
        item.situacao || '',
        item.atualizadoPangeaEm || '',
        item.etiquetas || [],
        item.urlPangea || ''
    ]);
    let h = 0x811c9dc5;
    for (let i = 0; i < base.length; i++) {
        h ^= base.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

function tratarErroFirestore(error, contexto) {
    console.error(`[PangeaStore] Erro em ${contexto}:`, error);
    if (error && error.code === 'permission-denied') {
        const err = new Error('Permissão negada no Firestore. Verifique as Security Rules para usuarios/{uid}/pangea_gab e usuarios/{uid}/meta.');
        err.code = 'permission-denied';
        throw err;
    }
    throw error;
}

export function normalizarItemEstrito(raw, pos, filtroPadrao = {}) {
    if (!raw || typeof raw !== 'object') {
        throw new Error(`Item #${pos + 1} inválido (não é um objeto JSON).`);
    }

    const numeroRaw = extrairCampo(raw, PANGEA_SCHEMA.numero);
    const numero = numeroRaw !== null && !isNaN(parseInt(numeroRaw, 10)) ? parseInt(numeroRaw, 10) : null;

    const orgao = String(extrairCampo(raw, PANGEA_SCHEMA.orgao) || filtroPadrao.orgao || 'TRT23').trim().toUpperCase();
    const localIdRaw = extrairCampo(raw, PANGEA_SCHEMA.localId) ?? filtroPadrao.localId ?? null;
    const localId = localIdRaw !== null && !isNaN(parseInt(localIdRaw, 10)) ? parseInt(localIdRaw, 10) : null;
    const siglaLocal = String(extrairCampo(raw, PANGEA_SCHEMA.siglaLocal) || filtroPadrao.siglaLocal || 'GABRC').trim().toUpperCase();
    const especie = String(extrairCampo(raw, PANGEA_SCHEMA.especie) || '').trim().toUpperCase();

    const idNativo = extrairCampo(raw, PANGEA_SCHEMA.id);
    let docId = '';
    if (idNativo !== null) {
        docId = sanitizarDocId(idNativo);
    } else if (numero !== null && localId !== null && especie) {
        docId = sanitizarDocId(`${orgao}_${localId}_${especie}_${numero}`);
    }

    if (!docId) {
        throw new Error(
            `Integridade violada: o item #${pos + 1} não possui ID estável (chaves verificadas: ${PANGEA_SCHEMA.id.join(', ')}). ` +
            `Chaves presentes: ${Object.keys(raw).join(', ')}. Ajuste PANGEA_SCHEMA após a Fase 0.`
        );
    }

    const questaoRaw = extrairCampo(raw, PANGEA_SCHEMA.questao);
    const teseRaw = extrairCampo(raw, PANGEA_SCHEMA.tese);
    const questao = limparHtmlParaTexto(questaoRaw);
    const tese = limparHtmlParaTexto(teseRaw);
    const teseHtml = sanitizarHtmlCondicional(teseRaw);

    const nomeLocal = limparHtmlParaTexto(extrairCampo(raw, PANGEA_SCHEMA.nomeLocal) || '');
    const tituloOficial = limparHtmlParaTexto(extrairCampo(raw, PANGEA_SCHEMA.tituloOficial)) ||
        (numero !== null
            ? `Modelo nº ${numero}${nomeLocal ? ` — ${nomeLocal}` : ` (${siglaLocal})`} (${orgao})`
            : `${siglaLocal} (${orgao})`);

    const cancelado = Boolean(extrairCampo(raw, PANGEA_SCHEMA.cancelado));
    const situacao = String(extrairCampo(raw, PANGEA_SCHEMA.situacao) || (cancelado ? 'Cancelado' : 'Vigente')).trim();

    const item = {
        id: docId,
        pangeaId: String(idNativo ?? docId),
        numero,
        especie: especie || 'DESCONHECIDA',
        siglaLocal,
        localId,
        orgao,
        tituloOficial,
        questao: questao || tituloOficial,
        tese,
        teseHtml,
        etiquetas: normalizarEtiquetas(extrairCampo(raw, PANGEA_SCHEMA.etiquetas)),
        situacao,
        urlPangea: validarUrlPangea(extrairCampo(raw, PANGEA_SCHEMA.url)),
        atualizadoPangeaEm: String(extrairCampo(raw, PANGEA_SCHEMA.atualizadoEm) || '').trim(),
        schemaVersion: SCHEMA_VERSION
    };

    item.contentHash = gerarHashConteudo(item);
    return item;
}

export const PangeaStore = {
    async carregar(forcarRefresh = false) {
        const { db, uid } = await obterContexto();
        if (!uid) return { modelos: [], meta: null, autenticado: false };
        if (cacheModelos.length > 0 && !forcarRefresh) {
            return { modelos: cacheModelos, meta: cacheMeta, autenticado: true };
        }

        try {
            const [snapModelos, snapMeta] = await Promise.all([
                getDocs(collection(db, 'usuarios', uid, COLLECTION_MODELOS)),
                getDoc(doc(db, 'usuarios', uid, COLLECTION_META, DOC_META_ID))
            ]);

            const modelos = [];
            snapModelos.forEach(docSnap => {
                const data = docSnap.data();
                if (data && !data.removidoNaOrigem) {
                    modelos.push({ id: docSnap.id, ...data });
                }
            });

            cacheModelos = modelos;
            cacheMeta = snapMeta.exists() ? snapMeta.data() : null;
            return { modelos: cacheModelos, meta: cacheMeta, autenticado: true };
        } catch (error) {
            tratarErroFirestore(error, 'carregar');
        }
    },

    async calcularDiff(pacote, { permitirArquivamento = false } = {}) {
        const { db, uid } = await obterContexto();
        if (!uid) throw new Error('Usuário não autenticado no Firebase.');

        const itensBrutos = Array.isArray(pacote?.resultados) ? pacote.resultados : [];
        if (itensBrutos.length === 0) {
            throw new Error('O pacote não contém nenhum item em "resultados".');
        }

        const filtro = pacote.filtro || {};
        const normalizadosMap = new Map();
        let comTesePreenchida = 0;
        let aparentaTruncado = 0;

        for (let i = 0; i < itensBrutos.length; i++) {
            const norm = normalizarItemEstrito(itensBrutos[i], i, filtro);
            if (normalizadosMap.has(norm.id)) {
                throw new Error(`ID duplicado detectado no pacote (${norm.id}). Sincronização abortada.`);
            }
            if (norm.tese) {
                comTesePreenchida++;
                if (/(?:\.\.\.|…)\s*$/.test(norm.tese)) aparentaTruncado++;
            }
            normalizadosMap.set(norm.id, norm);
        }

        if (comTesePreenchida === 0) {
            throw new Error(
                `Nenhum item teve o campo de texto reconhecido por PANGEA_SCHEMA.tese (${PANGEA_SCHEMA.tese.join(', ')}). ` +
                `Chaves do 1º item: ${Object.keys(itensBrutos[0]).join(', ')}.`
            );
        }

        const coletaCompletaConfirmada = Boolean(
            pacote.completo === true &&
            !pacote.erroParcial &&
            typeof pacote.totalInformado === 'number' &&
            pacote.totalInformado === normalizadosMap.size &&
            !filtro.buscaGeral
        );

        /* Trava rigorosa: só aceita texto integral quando confirmado empiricamente pós-Fase 0 + sem sinal de truncamento */
        const taxaTruncamento = comTesePreenchida > 0 ? (aparentaTruncado / comTesePreenchida) : 0;
        const integralConfirmado = Boolean(
            pacote.modoTexto === 'integral' &&
            pacote.evidenciaIntegralidade?.confirmadaFase0 === true &&
            taxaTruncamento < 0.2
        );

        const avisos = [];
        if (!coletaCompletaConfirmada) {
            avisos.push('Coleta não comprovadamente completa: arquivamento desabilitado.');
        }
        if (!integralConfirmado) {
            avisos.push('Integralidade do texto ainda não confirmada pela Fase 0 (ou sinais de truncamento): a tese de registros já salvos como integrais será preservada contra sobrescrita.');
        }

        const existentesMap = new Map();
        try {
            const snapAtual = await getDocs(collection(db, 'usuarios', uid, COLLECTION_MODELOS));
            snapAtual.forEach(d => existentesMap.set(d.id, { id: d.id, ...d.data() }));
        } catch (error) {
            tratarErroFirestore(error, 'calcularDiff (leitura)');
        }

        const novos = [];
        const atualizados = [];
        const inalterados = [];
        const aArquivar = [];
        const operacoes = [];

        normalizadosMap.forEach((item, docId) => {
            const existente = existentesMap.get(docId);
            if (!existente) {
                const payload = {
                    ...item,
                    coletaCompleta: integralConfirmado,
                    favorite: false,
                    removidoNaOrigem: false
                };
                novos.push(item);
                operacoes.push({ tipo: 'novo', docId, merge: false, payload });
                return;
            }

            const protegerTese = !integralConfirmado && Boolean(existente.coletaCompleta) && Boolean(existente.tese);
            const itemEfetivo = protegerTese
                ? { ...item, tese: existente.tese, teseHtml: existente.teseHtml ?? null, coletaCompleta: true }
                : { ...item, coletaCompleta: integralConfirmado };

            itemEfetivo.contentHash = gerarHashConteudo(itemEfetivo);

            if (existente.contentHash !== itemEfetivo.contentHash || existente.removidoNaOrigem === true) {
                atualizados.push(itemEfetivo);
                operacoes.push({
                    tipo: 'atualizado',
                    docId,
                    merge: true,
                    payload: { ...itemEfetivo, removidoNaOrigem: false }
                });
            } else {
                inalterados.push(existente);
            }
        });

        const podeArquivar = Boolean(permitirArquivamento && coletaCompletaConfirmada);
        if (podeArquivar) {
            existentesMap.forEach((existente, docId) => {
                if (!normalizadosMap.has(docId) && !existente.removidoNaOrigem) {
                    aArquivar.push(existente);
                    operacoes.push({ tipo: 'arquivado', docId, merge: true, payload: { removidoNaOrigem: true } });
                }
            });
        }

        return {
            podeArquivar,
            coletaCompletaConfirmada,
            integralConfirmado,
            avisos,
            filtro,
            resumo: {
                novos: novos.length,
                atualizados: atualizados.length,
                inalterados: inalterados.length,
                arquivados: aArquivar.length,
                total: normalizadosMap.size
            },
            detalhes: { novos, atualizados, aArquivar },
            operacoes
        };
    },

    async aplicarDiff(planoDiff) {
        const { db, uid } = await obterContexto();
        if (!uid) throw new Error('Usuário não autenticado no Firebase.');
        if (!planoDiff || !Array.isArray(planoDiff.operacoes)) {
            throw new Error('Plano de sincronização inválido. Execute a análise novamente.');
        }

        const agora = Date.now();
        const TAMANHO_BATCH = 450;

        try {
            for (let i = 0; i < planoDiff.operacoes.length; i += TAMANHO_BATCH) {
                const fatia = planoDiff.operacoes.slice(i, i + TAMANHO_BATCH);
                const batch = writeBatch(db);
                fatia.forEach(op => {
                    const ref = doc(db, 'usuarios', uid, COLLECTION_MODELOS, op.docId);
                    const dados = { ...op.payload, sincronizadoEm: agora };
                    if (op.merge) {
                        batch.set(ref, dados, { merge: true });
                    } else {
                        batch.set(ref, dados);
                    }
                });
                await batch.commit();
            }

            const metaPayload = {
                ultimaSincronizacao: agora,
                totalModelos: planoDiff.resumo.total,
                orgao: planoDiff.filtro?.orgao || 'TRT23',
                localId: planoDiff.filtro?.localId ?? 3138,
                siglaLocal: planoDiff.filtro?.siglaLocal || 'GABRC',
                especiesFiltro: Array.isArray(planoDiff.filtro?.especies) ? planoDiff.filtro.especies : [],
                ultimoResumo: planoDiff.resumo,
                schemaVersion: SCHEMA_VERSION
            };
            await setDoc(doc(db, 'usuarios', uid, COLLECTION_META, DOC_META_ID), metaPayload, { merge: true });

            cacheMeta = metaPayload;
            cacheModelos = [];
            return planoDiff.resumo;
        } catch (error) {
            tratarErroFirestore(error, 'aplicarDiff');
        }
    },

    async atualizarFavorito(id, favorite) {
        const { db, uid } = await obterContexto();
        if (!uid) throw new Error('Usuário não autenticado.');
        try {
            const ref = doc(db, 'usuarios', uid, COLLECTION_MODELOS, id);
            await updateDoc(ref, { favorite: Boolean(favorite), atualizadoLocalEm: Date.now() });
            const item = cacheModelos.find(m => m.id === id);
            if (item) item.favorite = Boolean(favorite);
        } catch (error) {
            tratarErroFirestore(error, 'atualizarFavorito');
        }
    }
};