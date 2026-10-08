window.JurisRelatorioManager = (function() {
    
    // Gerador dinâmico de namespace para evitar colisão de estado
    function getNamespaceKey() {
        const moduloAtivo = document.body.dataset.module || 'geral';
        return `juris_relatorio_draft_${moduloAtivo}`;
    }

    function initEvents() {
        const form = document.getElementById('jr-relatorio-form');
        if(!form) return;
        
        form.querySelectorAll('input, select').forEach(el => {
            el.addEventListener('input', generatePreview);
            el.addEventListener('change', generatePreview);
        });
    }

    function mudarModo() {
        const form = document.getElementById('jr-relatorio-form');
        const isAP = document.getElementById('jr-is-ap').checked;
        const modo = isAP ? 'ap' : 'ro';
        
        form.setAttribute('data-active-mode', isAP ? 'AP' : 'RO');

        document.querySelectorAll('.dyn-label').forEach(lbl => {
            lbl.textContent = lbl.getAttribute(`data-text-${modo}`);
        });

        document.querySelectorAll('.dyn-opt').forEach(opt => {
            opt.textContent = opt.getAttribute(`data-text-${modo}`);
        });

        toggleCondicionais();
    }

    function toggleCondicionais() {
        const embargosVal = document.getElementById('jr-embargos').value;
        const contraVal = document.getElementById('jr-contrarrazoes').value;
        
        const embargosDet = document.getElementById('jr-embargos-detalhes');
        const contraDet = document.getElementById('jr-contrarrazoes-detalhes');

        if (embargosVal !== '0' && embargosVal !== '') {
            embargosDet.style.display = 'block';
        } else {
            embargosDet.style.display = 'none';
            document.getElementById('jr-embargos-fls').value = '';
            document.getElementById('jr-embargos-resultado').value = '';
            document.getElementById('jr-embargos-sentenca').value = '';
        }

        if (contraVal !== '0' && contraVal !== '') {
            contraDet.style.display = 'block';
        } else {
            contraDet.style.display = 'none';
            document.getElementById('jr-contrarrazoes-fls').value = '';
        }
        
        generatePreview();
    }

    function generatePreview() {
        const isAP = document.getElementById('jr-is-ap').checked;
        const v = (id) => document.getElementById(id).value.trim() || '____________________';
        
        const selectText = (id) => {
            const el = document.getElementById(id);
            return el && el.selectedIndex >= 0 && el.value !== "" 
                   ? el.options[el.selectedIndex].text.replace(/\s\(\d\)$/, '')
                   : '____________________';
        };

        const labelText = (id) => {
            const el = document.getElementById(id);
            return el ? el.textContent : '';
        };

        const val_E = isAP ? v('jr-resultado-ap') : v('jr-resultado');

        let output = `[A] NOME DO(A) MAGISTRADO(A): ${v('jr-magistrado')}
[B] TITULARIDADE: ${selectText('jr-titularidade')}
[C] VARA DE ORIGEM: ${v('jr-vara')}
${labelText('lbl-d')}: ${v('jr-sentenca')}
${labelText('lbl-e')}: ${val_E}
${labelText('lbl-f').replace('[F] ', '[F] ')}: ${selectText('jr-recurso')}
   ${labelText('lbl-f1')}: ${v('jr-recurso-fls')}
[G] EMBARGOS DE DECLARAÇÃO: ${selectText('jr-embargos')}`;

        if (document.getElementById('jr-embargos').value !== '0') {
            output += `
   [G.1] Fls. de oposição: ${v('jr-embargos-fls')}
   [G.2] Resultado: ${v('jr-embargos-resultado')}
   ${labelText('lbl-g3')}: ${v('jr-embargos-sentenca')}`;
        }

        output += `\n${labelText('lbl-h')}: ${selectText('jr-contrarrazoes')}`;
        
        if (document.getElementById('jr-contrarrazoes').value !== '0') {
            const h1Label = document.querySelector('label[data-text-ro="[H.1] Fls. e Id das Contrarrazões"]').textContent;
            output += `\n   ${h1Label}: ${v('jr-contrarrazoes-fls')}`;
        }

        document.getElementById('jr-preview-text').value = output;
    }

    function salvarDados() {
        try {
            const formInputs = document.querySelectorAll('#jr-relatorio-form input, #jr-relatorio-form select');
            const data = {};
            formInputs.forEach(el => {
                if (el.type === 'radio') {
                    if (el.checked) data[el.name] = el.id; // Salva qual radio está ativo
                } else if (el.id) {
                    data[el.id] = el.value;
                }
            });
            localStorage.setItem(getNamespaceKey(), JSON.stringify(data));
        } catch (e) {
            console.warn("Erro ao salvar rascunho.", e);
        }
    }

    function carregarDados() {
        try {
            const draft = JSON.parse(localStorage.getItem(getNamespaceKey()));
            if (!draft) {
                mudarModo(); // Garante estado padrão
                return;
            }

            if (draft['jr_tipo']) {
                const radioAtivo = document.getElementById(draft['jr_tipo']);
                if (radioAtivo) radioAtivo.checked = true;
            }
            
            mudarModo();

            Object.keys(draft).forEach(id => {
                if (id === 'jr_tipo') return;
                const el = document.getElementById(id);
                if (el) el.value = draft[id];
            });
            
        } catch (e) {
            console.warn("Erro ao carregar rascunho.", e);
        }
    }

    function abrirModal() {
        document.getElementById('backdrop-juris-relatorio').classList.add('active');
        document.getElementById('modal-juris-relatorio').style.display = 'block';
        initEvents();
        carregarDados();
        generatePreview(); 
    }

    function fecharModal() {
        salvarDados();
        document.getElementById('backdrop-juris-relatorio').classList.remove('active');
        document.getElementById('modal-juris-relatorio').style.display = 'none';
    }

    async function copiarTexto() {
        const text = document.getElementById("jr-preview-text").value;
        try {
            await navigator.clipboard.writeText(text);
            if (typeof window.exibirToast === 'function') window.exibirToast('Relatório copiado!', 'sucesso');
            else alert('Relatório copiado com sucesso!');
        } catch (err) { alert('Erro ao copiar relatório.'); }
    }

    return { abrirModal, fecharModal, toggleCondicionais, mudarModo, copiarTexto };
})();