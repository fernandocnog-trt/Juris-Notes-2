/* ================================================
juris-debug-telemetry.js — v2.0
Ativação: ?dbg=1 | Ctrl+Alt+M | Snapshot: F9
================================================ */
window.DebugTelemetry = (function () {
    'use strict';
    let enabled = new URLSearchParams(location.search).has('dbg') ||
                  localStorage.getItem('juris-dbg') === '1';
    let verbose = false;

    /* ELO-PROVA: mensagem em nível Info (visível por padrão no Chrome) */
    console.info('[DBG:BOOT] Telemetria v2 carregada. Status: ' +
        (enabled ? 'ATIVA' : 'INATIVA → abra com ?dbg=1 ou pressione Ctrl+Alt+M'));

    const perSec = {}, ring = [];
    let hud = null, mmCount = 0, shiftScore = 0;

    function mark(tag, dados) {
        if (!enabled) return;
        perSec[tag] = (perSec[tag] || 0) + 1;
        ring.push({ t: Math.round(performance.now()), tag, ...(dados || {}) });
        if (ring.length > 150) ring.shift();
        if (verbose) console.log('[DBG:' + tag + ']', dados || ''); /* log, não debug */
    }

    document.addEventListener('mousemove', () => { mmCount++; }, { passive: true });

    try {
        new PerformanceObserver(l => l.getEntries().forEach(e => {
            shiftScore += Number(e.value) || 0;
            mark('M9-SHIFT', { score: (Number(e.value)||0).toFixed(3),
                alvos: (e.sources||[]).slice(0,3).map(s => (s.node && (s.node.id||s.node.className)) || '?') });
        })).observe({ type: 'layout-shift', buffered: true });
        
        new PerformanceObserver(l => l.getEntries().forEach(en =>
            mark('M10-LONGTASK', { ms: Math.round(en.duration) })
        )).observe({ type: 'longtask', buffered: true });
    } catch (e) {}

    /* SONDA DE CSS: a caça à raiz, sem precisar de olho nu */
    function cssProbe() {
        const rows = [];
        const chk = (nome, sel, fn) => {
            const el = document.querySelector(sel);
            if (!el) return rows.push({ regra: nome, status: 'ELEMENTO AUSENTE' });
            rows.push({ regra: nome, status: fn(getComputedStyle(el)) ? 'VIVA' : 'MORTA (comentário engoliu)' });
        };
        chk('tab-bar z-index:50',        '.topics-tab-bar',        cs => cs.zIndex === '50');
        chk('tab-bar translateZ',        '.topics-tab-bar',        cs => cs.transform !== 'none');
        chk('history overflow-y:auto',   '#history-container',     cs => cs.overflowY === 'auto');
        chk('preamble position:sticky',  '.topic-preamble-panel',  cs => cs.position === 'sticky');
        chk('stack isolation:isolate',   '.sub-annotation-stack',  cs => cs.isolation === 'isolate');
        chk('stack fundo branco',        '.sub-annotation-stack',  cs => cs.backgroundColor === 'rgb(255, 255, 255)' || cs.backgroundColor === '#ffffff');
        chk('read-badge absolute',       '.sub-read-badge',        cs => cs.position === 'absolute');
        
        console.info('================================================');
        console.info('[DBG:SONDA-CSS] Resultado:'); 
        console.table(rows);
        console.info('================================================');
        
        mark('M11-SONDA', { mortas: rows.filter(r => /MORTA|AUSENTE/.test(r.status)).length });
        
        if (window.exibirToast) {
            const mortas = rows.filter(r => /MORTA/.test(r.status)).length;
            if (mortas > 0) {
                window.exibirToast(`Sonda: ${mortas} regras CSS mortas detectadas! Veja o console.`, 'erro');
            } else {
                window.exibirToast('Sonda CSS: Todas as regras vitais estão vivas.', 'sucesso');
            }
        }
        return rows;
    }

    /* AUTO-TESTE: dispara todos os marcadores sinteticamente */
    function selfTest() {
        ['M1-RO','M2-RENDER','M3-POS','M4-SVG','M6-MORPH','M7-WHEEL','M8-IMG','M9-SHIFT','M10-LONGTASK']
            .forEach(k => mark(k, { sintetico: true }));
        cssProbe();
        console.info('[DBG:SELF-TEST] Se o HUD mostrar 1/s em cada linha, o pipeline está íntegro.');
    }

    const KEYS = ['M1-RO','M2-RENDER','M3-POS','M4-SVG','M6-MORPH','M7-WHEEL','M8-IMG','M9-SHIFT','M10-LONGTASK'];
    
    function buildHud() {
        if (hud || !enabled) return;
        hud = document.createElement('div'); hud.id = 'dbg-telemetry-hud';
        hud.innerHTML = '<h4>🩺 TELEMETRIA v2</h4>' +
            KEYS.map(k => `<div class="dbg-row" id="row-${k}"><span>${k}</span><b id="dbg-${k}">0/s</b></div>`).join('') +
            '<div class="dbg-row"><span>MOUSE / SHIFT</span><b id="dbg-MM">0</b></div>' +
            '<div class="dbg-actions"><button id="dbg-test" title="Simular eventos">Auto-teste</button>' +
            '<button id="dbg-verb" title="Ativar logs no console">Verbose</button><button id="dbg-off">Fechar</button></div>';
        
        document.body.appendChild(hud);
        hud.querySelector('#dbg-test').onclick = selfTest;
        hud.querySelector('#dbg-verb').onclick = () => { 
            verbose = !verbose;
            console.info('[DBG] Console verbose ' + (verbose ? 'ATIVADO' : 'desativado')); 
        };
        hud.querySelector('#dbg-off').onclick = () => toggle(false);
    }

    setInterval(() => {
        if (!enabled || !hud) { 
            Object.keys(perSec).forEach(k => delete perSec[k]); 
            mmCount = 0; 
            return; 
        }
        KEYS.forEach(k => {
            const el = document.getElementById('dbg-' + k), row = document.getElementById('row-' + k);
            if (el) el.textContent = (perSec[k] || 0) + '/s';
            if (row) {
                row.classList.toggle('hot', (perSec[k] || 0) > 3); /* loop em repouso = vermelho */
                row.classList.toggle('ok', k === 'M10-LONGTASK' && (perSec[k] || 0) === 0);
            }
            delete perSec[k];
        });
        document.getElementById('dbg-MM').textContent = mmCount + '/s | ' + shiftScore.toFixed(2);
        mmCount = 0;
    }, 1000);

    function snapshot() { 
        console.info('================================================');
        console.info('[DBG:SNAPSHOT]'); 
        console.table(ring); 
        console.info('================================================');
        if(window.exibirToast) window.exibirToast('Snapshot capturado no console!', 'info');
    }

    function toggle(force) {
        enabled = (typeof force === 'boolean') ? force : !enabled;
        localStorage.setItem('juris-dbg', enabled ? '1' : '0');
        enabled ? buildHud() : (hud && (hud.remove(), hud = null));
        console.info('[DBG] Telemetria ' + (enabled ? 'ATIVADA' : 'desativada'));
    }

    /* Ctrl+Alt+M: combinação NÃO reservada pelo navegador */
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); toggle(); }
        if (enabled && e.key === 'F9') { e.preventDefault(); snapshot(); }
    });

    if (enabled) {
        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', buildHud) : buildHud();
        document.addEventListener('DOMContentLoaded', () => setTimeout(cssProbe, 1500));
    }

    /* --- EXTENSÃO: TELEMETRIA DE LAYOUT CAUSAL (COM HEURÍSTICA H1-H4) --- */
    const LayoutTracker = (function() {
        if (!enabled) return { noteDelivery:()=>{}, observeWithSeed:(el,ro)=>ro.observe(el), beginPass:()=>{}, endPass:()=>{}, mark:()=>{}, dump:()=>{}, incMutation:()=>{} };

        const ring = [];
        const heightCache = new WeakMap();
        let currentPass = null;

        // Helper para medir a barra de rolagem (Scrollbar Gutter)
        function getGutter() {
            const hc = document.getElementById('history-container');
            return hc ? hc.offsetWidth - hc.clientWidth : 0;
        }

        function beginPass(label) {
            currentPass = { type: 'pass', label, start: performance.now(), mutations: 0, gutterStart: getGutter() };
        }

        function endPass() {
            if (currentPass) {
                currentPass.end = performance.now();
                currentPass.gutterEnd = getGutter();
                ring.push(currentPass);
                if (ring.length > 500) ring.shift();
            }
            currentPass = null;
        }

        function mark(label, details = {}) {
            ring.push({ type: 'mark', label, t: performance.now(), gutter: getGutter(), ...details });
            if (ring.length > 500) ring.shift();
        }

        function noteDelivery(entries, isGuardActive) {
            const now = performance.now();
            const currentGutter = getGutter();
            const deliveryLog = { type: 'delivery', t: now, suprimido: isGuardActive, gutter: currentGutter, deltas: [] };

            for (const entry of entries) {
                if (!entry.target) continue;
                const newHeight = Math.round(entry.contentRect.height);
                const cacheData = heightCache.get(entry.target);
                
                if (!cacheData) continue;

                // Ignora First-Seen (Seed)
                if (!cacheData.isFirstSeen && Math.abs(newHeight - cacheData.h) >= 2) {
                    deliveryLog.deltas.push({ el: entry.target.className || entry.target.tagName, delta: newHeight - cacheData.h });
                }
                
                heightCache.set(entry.target, { h: newHeight, isFirstSeen: false });
            }

            if (deliveryLog.deltas.length > 0 || isGuardActive) {
                ring.push(deliveryLog);
                if (ring.length > 500) ring.shift();
            }
        }

        function observeWithSeed(el, ro) {
            if (!el) return;
            heightCache.set(el, { h: Math.round(el.getBoundingClientRect().height), isFirstSeen: true });
            ro.observe(el);
        }

        function incMutation() { if (currentPass) currentPass.mutations++; }

        // O Analisador de Assinaturas (Executado quando o Dev solicita o Dump)
        function dump() {
            console.table(ring);
            console.info("🔍 Analisando assinaturas de Layout Thrashing...");
            
            let flipsGutter = 0;
            let instantScrolls = 0;
            let deltasTexto = 0;

            ring.forEach((item, i) => {
                const prev = ring[i - 1];
                if (prev && item.gutter !== undefined && prev.gutter !== undefined && item.gutter !== prev.gutter) flipsGutter++;
                if (item.type === 'mark' && item.details?.behavior === 'instant' && (item.details?.diff > 4 || item.details?.diff === undefined)) instantScrolls++;
                if (item.type === 'delivery' && item.deltas.length > 0) deltasTexto++;
            });

            if (flipsGutter > 2 && deltasTexto > 2) {
                console.error("🚨 DIAGNÓSTICO: Hipótese 2 Confirmada -> Ciclo mediado por Scrollbar (Gutter Flips). A barra de rolagem está aparecendo/sumindo e forçando quebra de textos.");
            } else if (instantScrolls > 5 && deltasTexto === 0) {
                console.warn("⚠️ DIAGNÓSTICO: Hipótese 3 Confirmada -> Conflito de Scroll (Tug-of-war). O ResizeObserver é INOCENTE. O tremor é causado pela orquestração do scroll no JS.");
            } else if (deltasTexto > 5 && flipsGutter === 0) {
                console.error("🚨 DIAGNÓSTICO: Hipótese 1 Confirmada -> Loop Geométrico Puro. O cálculo de top/minHeight está se retroalimentando sem envolver a barra de rolagem.");
            } else {
                console.log("✅ Nenhum padrão claro de Thrashing contínuo detectado na janela atual.");
            }
        }

        return { noteDelivery, observeWithSeed, beginPass, endPass, mark, incMutation, dump };
    })();

    return { mark, snapshot, toggle, selfTest, cssProbe, LayoutTracker, isEnabled: () => enabled };
})();