/* ================================================
juris-debug-telemetry.js — v3.0 (Diagnóstico de Thrashing Causal)
Ativação: ?dbg=1 | Ctrl+Alt+M | Snapshot: F9
================================================ */
window.DebugTelemetry = (function () {
    'use strict';
    let enabled = new URLSearchParams(location.search).has('dbg') ||
                  localStorage.getItem('juris-dbg') === '1';
    let verbose = false;

    console.info('[DBG:BOOT] Telemetria v3 (Layout Causal) carregada. Status: ' +
        (enabled ? 'ATIVA' : 'INATIVA → abra com ?dbg=1 ou pressione Ctrl+Alt+M'));

    const perSec = {}, ring = [];
    let hud = null, mmCount = 0, shiftScore = 0;

    function mark(tag, dados) {
        if (!enabled) return;
        perSec[tag] = (perSec[tag] || 0) + 1;
        ring.push({ t: Math.round(performance.now()), tag, ...(dados || {}) });
        if (ring.length > 150) ring.shift();
        if (verbose) console.log('[DBG:' + tag + ']', dados || '');
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

    function cssProbe() {
        const rows = [];
        const chk = (nome, sel, fn) => {
            const el = document.querySelector(sel);
            if (!el) return rows.push({ regra: nome, status: 'ELEMENTO AUSENTE' });
            rows.push({ regra: nome, status: fn(getComputedStyle(el)) ? 'VIVA' : 'MORTA' });
        };
        chk('history overflow-y:auto', '#history-container', cs => cs.overflowY === 'auto');
        
        if (verbose) {
            console.info('[DBG:SONDA-CSS] Resultado:'); 
            console.table(rows);
        }
        return rows;
    }

    function selfTest() {
        ['M1-RO','M2-RENDER','M3-POS','M9-SHIFT'].forEach(k => mark(k, { sintetico: true }));
        cssProbe();
    }

    // Adicionado M11-LOOP ao HUD visual
    const KEYS = ['M1-RO','M2-RENDER','M3-POS','M4-SVG','M6-MORPH','M7-WHEEL','M8-IMG','M9-SHIFT','M10-LONGTASK', 'M11-LOOP'];
    
    function buildHud() {
        if (hud || !enabled) return;
        hud = document.createElement('div'); hud.id = 'dbg-telemetry-hud';
        hud.innerHTML = '<h4>🩺 TELEMETRIA v3</h4>' +
            KEYS.map(k => `<div class="dbg-row" id="row-${k}"><span>${k}</span><b id="dbg-${k}">0/s</b></div>`).join('') +
            '<div class="dbg-row"><span>MOUSE / SHIFT</span><b id="dbg-MM">0</b></div>' +
            '<div class="dbg-actions"><button id="dbg-test" title="Simular eventos">Auto-teste</button>' +
            '<button id="dbg-verb" title="Ativar logs no console">Verbose</button><button id="dbg-off">Fechar</button></div>';
        
        document.body.appendChild(hud);
        hud.querySelector('#dbg-test').onclick = selfTest;
        hud.querySelector('#dbg-verb').onclick = () => { verbose = !verbose; };
        hud.querySelector('#dbg-off').onclick = () => toggle(false);
    }

    setInterval(() => {
        if (!enabled || !hud) { 
            Object.keys(perSec).forEach(k => delete perSec[k]); 
            mmCount = 0; return; 
        }
        KEYS.forEach(k => {
            const el = document.getElementById('dbg-' + k), row = document.getElementById('row-' + k);
            if (el) el.textContent = (perSec[k] || 0) + '/s';
            if (row) {
                row.classList.toggle('hot', (perSec[k] || 0) > 3);
                row.classList.toggle('ok', k === 'M10-LONGTASK' && (perSec[k] || 0) === 0);
            }
            delete perSec[k];
        });
        document.getElementById('dbg-MM').textContent = mmCount + '/s | ' + shiftScore.toFixed(2);
        mmCount = 0;
    }, 1000);

    function snapshot() { console.table(ring); }

    function toggle(force) {
        enabled = (typeof force === 'boolean') ? force : !enabled;
        localStorage.setItem('juris-dbg', enabled ? '1' : '0');
        enabled ? buildHud() : (hud && (hud.remove(), hud = null));
    }

    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); toggle(); }
        if (enabled && e.key === 'F9') { e.preventDefault(); snapshot(); }
    });

    if (enabled) {
        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', buildHud) : buildHud();
    }

    /* ================================================
       NOVO: MOTOR DE DIAGNÓSTICO DE LAYOUT CAUSAL
       ================================================ */
    const LayoutTracker = (function() {
        // Custo Zero (No-Op) se desligado
        if (!enabled) return { noteDelivery:()=>{}, observeWithSeed:(el,ro)=>{if(ro)ro.observe(el);}, beginPass:()=>{}, endPass:()=>{}, mark:()=>{}, incMutation:()=>{}, dump:()=>{} };

        const layoutRing = [];
        const heightCache = new WeakMap();
        let currentPass = null;
        let lastDeliveries = [];
        const THRASH_WINDOW_MS = 250;

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
                layoutRing.push(currentPass);
                if (layoutRing.length > 500) layoutRing.shift();
            }
            currentPass = null;
        }

        function markTracker(label, details = {}) {
            layoutRing.push({ type: 'mark', label, t: performance.now(), gutter: getGutter(), ...details });
            if (layoutRing.length > 500) layoutRing.shift();
        }

        function noteDelivery(entries, isGuardActive) {
            const now = performance.now();
            const currentGutter = getGutter();
            
            // Janela deslizante para detectar o tremor
            lastDeliveries.push(now);
            lastDeliveries = lastDeliveries.filter(t => now - t <= THRASH_WINDOW_MS);
            
            // DISJUNTOR DE EMERGÊNCIA (CIRCUIT BREAKER)
            if (lastDeliveries.length > 10) {
                if (!window.__CIRCUIT_BREAKER) {
                    window.__CIRCUIT_BREAKER = true; // Corta a energia
                    console.error("🚨 [EMERGÊNCIA] Loop infinito agressivo detectado! O motor visual foi desligado para salvar o navegador.");
                    dump(); // Gera o laudo automaticamente!
                }
            }

            const deliveryLog = { type: 'delivery', t: now, suprimido: isGuardActive, gutter: currentGutter, deltas: [] };

            for (const entry of entries) {
                if (!entry.target) continue;
                const newHeight = Math.round(entry.contentRect.height);
                const cacheData = heightCache.get(entry.target);
                
                if (!cacheData) continue;

                // Ignora o primeiro render (Seed)
                if (!cacheData.isFirstSeen && Math.abs(newHeight - cacheData.h) >= 2) {
                    deliveryLog.deltas.push({ 
                        el: entry.target.className || entry.target.tagName, 
                        delta: newHeight - cacheData.h 
                    });
                }
                
                heightCache.set(entry.target, { h: newHeight, isFirstSeen: false });
            }

            if (deliveryLog.deltas.length > 0 || isGuardActive) {
                layoutRing.push(deliveryLog);
                if (layoutRing.length > 500) layoutRing.shift();
            }
        }

        function observeWithSeed(el, ro) {
            if (!el) return;
            heightCache.set(el, { h: Math.round(el.getBoundingClientRect().height), isFirstSeen: true });
            if (ro) ro.observe(el);
        }

        function incMutation() { if (currentPass) currentPass.mutations++; }

        function dump() {
            console.info("============== 🕵️ DUMP DE LAYOUT THRASHING ==============");
            console.table(layoutRing);
            console.info("🔍 Analisando assinaturas heurísticas...");
            
            let flipsGutter = 0;
            let instantScrolls = 0;
            let deltasTexto = 0;

            layoutRing.forEach((item, i) => {
                const prev = layoutRing[i - 1];
                if (prev && item.gutter !== undefined && prev.gutter !== undefined && item.gutter !== prev.gutter) flipsGutter++;
                if (item.type === 'mark' && item.details?.behavior === 'instant' && item.details?.diff > 4) instantScrolls++;
                if (item.type === 'delivery' && item.deltas && item.deltas.length > 0) deltasTexto += item.deltas.length;
            });

            console.log(`📊 Estatísticas da Amostra: Alternância de Scrollbar: ${flipsGutter} | Scrolls Forçados: ${instantScrolls} | Elementos Mutados: ${deltasTexto}`);

            if (flipsGutter > 2 && deltasTexto > 2) {
                console.error("🚨 DIAGNÓSTICO: [Hipótese 2] Ciclo mediado por Scrollbar. A barra de rolagem (gutter) aparece/some, rouba largura da tela e força requebra infinita de texto.");
            } else if (instantScrolls > 5 && deltasTexto === 0) {
                console.warn("⚠️ DIAGNÓSTICO: [Hipótese 3] Conflito de Scroll. JS forçando rolamento de tela de forma repetitiva sem disparos graves de geometria.");
            } else if (deltasTexto > 5 && flipsGutter === 0) {
                console.error("🚨 DIAGNÓSTICO: [Hipótese 1] Loop Geométrico Puro. O cálculo de top/minHeight está travado num loop sem envolver a barra de rolagem.");
            } else {
                console.log("✅ Nenhum padrão contínuo grave detectado no momento do Dump. Capture durante o tremor.");
            }
            console.info("=========================================================");
        }

        return { noteDelivery, observeWithSeed, beginPass, endPass, mark: markTracker, incMutation, dump };
    })();

    // Exporta API para uso global
    return { mark, snapshot, toggle, selfTest, cssProbe, isEnabled: () => enabled, LayoutTracker };
})();