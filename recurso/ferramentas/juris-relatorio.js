window.JurisRelatorioManager = (function() {
    
    function initEvents() {
        const form = document.getElementById('jr-relatorio-form');
        if(!form) return;
        
        // Ativa o gerador em tempo real para qualquer alteração nos campos
        form.querySelectorAll('input, select').forEach(el => {
            el.addEventListener('input', generatePreview);
            el.addEventListener('change', generatePreview);
        });
    }

    function toggleCondicionais() {
        const embargos = document.getElementById('jr-embargos').value;
        const embargosDet = document.getElementById('jr-embargos-detalhes');
        if (embargos !== "Não houve") {
            embargosDet.style.display = 'block';
        } else {
            embargosDet.style.display = 'none';
            document.getElementById('jr-embargos-fls').value = '';
            document.getElementById('jr-embargos-resultado').value = '';
            document.getElementById('jr-embargos-sentenca').value = '';
        }

        const contra = document.getElementById('jr-contrarrazoes').value;
        const contraDet = document.getElementById('jr-contrarrazoes-detalhes');
        if (contra !== "Não ofertadas") {
            contraDet.style.display = 'block';
        } else {
            contraDet.style.display = 'none';
            document.getElementById('jr-contrarrazoes-fls').value = '';
        }
        generatePreview();
    }

    function generatePreview() {
        const v = (id) => document.getElementById(id).value.trim() || '____________________';
        const s = (id) => document.getElementById(id).value || '____________________';

        let output = `[A] NOME DO(A) MAGISTRADO(A): ${v('jr-magistrado')}\n[B] TITULARIDADE: ${s('jr-titularidade')}\n[C] VARA DE ORIGEM: ${v('jr-vara')}\n[D] SENTENÇA PRINCIPAL (FLS. E ID): ${v('jr-sentenca')}\n[E] RESULTADO DA SENTENÇA: ${s('jr-resultado')}\n[F] RECURSO ORDINÁRIO: ${s('jr-recurso')}\n   [F.1] Fls. e Id do(s) Recurso(s): ${v('jr-recurso-fls')}\n[G] EMBARGOS DE DECLARAÇÃO: ${s('jr-embargos')}`;

        if (s('jr-embargos') !== "Não houve") {
            output += `\n   [G.1] Fls. de oposição: ${v('jr-embargos-fls')}\n   [G.2] Resultado: ${s('jr-embargos-resultado')}\n   [G.3] Sentença dos Embargos (Fls. e ID): ${v('jr-embargos-sentenca')}`;
        }

        output += `\n[H] CONTRARRAZÕES: ${s('jr-contrarrazoes')}`;
        
        if (s('jr-contrarrazoes') !== "Não ofertadas") {
            output += `\n   [H.1] Fls. e Id das Contrarrazões: ${v('jr-contrarrazoes-fls')}`;
        }

        document.getElementById('jr-preview-text').value = output;
    }

    function abrirModal() {
        document.getElementById('backdrop-juris-relatorio').classList.add('active');
        document.getElementById('modal-juris-relatorio').style.display = 'block';
        initEvents();
        carregarDados();
        toggleCondicionais(); 
        generatePreview();
    }

    function fecharModal() {
        salvarDados();
        document.getElementById('backdrop-juris-relatorio').classList.remove('active');
        document.getElementById('modal-juris-relatorio').style.display = 'none';
    }

    function salvarDados() {
        try {
            const data = {
                magistrado: document.getElementById('jr-magistrado').value,
                titularidade: document.getElementById('jr-titularidade').value,
                vara: document.getElementById('jr-vara').value
                // Salva apenas os básicos para reabertura rápida
            };
            localStorage.setItem('juris_relatorio_draft', JSON.stringify(data));
        } catch (e) { }
    }

    function carregarDados() {
        try {
            const draft = JSON.parse(localStorage.getItem('juris_relatorio_draft'));
            if(draft) {
                if(draft.magistrado) document.getElementById('jr-magistrado').value = draft.magistrado;
                if(draft.titularidade) document.getElementById('jr-titularidade').value = draft.titularidade;
                if(draft.vara) document.getElementById('jr-vara').value = draft.vara;
            }
        } catch (e) {}
    }

    async function copiarTexto() {
        const text = document.getElementById("jr-preview-text").value;
        
        try {
            await navigator.clipboard.writeText(text);
            
            // Dispara a API global de forma segura
            if (typeof window.exibirToast === 'function') {
                window.exibirToast('Relatório copiado com sucesso!', 'sucesso');
            } else {
                alert('Relatório copiado com sucesso!');
            }
        } catch (err) { 
            console.error("Erro na Clipboard API: ", err);
            if (typeof window.exibirToast === 'function') {
                window.exibirToast('Erro ao acessar a área de transferência.', 'erro');
            } else {
                alert('Erro ao copiar relatório.');
            }
        }
    }

    return { abrirModal, fecharModal, toggleCondicionais, copiarTexto };
})();