window.JurisRelatorioManager = (function() {
    function abrirModal() {
        document.getElementById('backdrop-juris-relatorio').classList.add('active');
        document.getElementById('modal-juris-relatorio').style.display = 'block';
        carregarDados();
    }
    function fecharModal() {
        salvarDados();
        document.getElementById('backdrop-juris-relatorio').classList.remove('active');
        document.getElementById('modal-juris-relatorio').style.display = 'none';
    }
    // Tratamento de segurança contra exceções de LocalStorage (Modo Anônimo)
    function salvarDados() {
        try {
            const magistrado = document.getElementById('magistrado')?.value || '';
            localStorage.setItem('juris_relatorio_draft', JSON.stringify({ magistrado }));
        } catch (e) {
            console.warn("Storage bloqueado. Dados efêmeros não foram salvos.");
        }
    }
    function carregarDados() {
        try {
            const draft = JSON.parse(localStorage.getItem('juris_relatorio_draft'));
            if(draft && draft.magistrado) {
                const el = document.getElementById('magistrado');
                if(el) el.value = draft.magistrado;
            }
        } catch (e) {}
    }
    async function copiarTexto() {
        const text = document.getElementById("preview-text-relatorio").value;
        try {
            await navigator.clipboard.writeText(text);
            if (window.exibirToast) exibirToast('Texto copiado com sucesso!', 'sucesso');
        } catch (err) {
            console.error('Falha ao copiar:', err);
        }
    }
    return { abrirModal, fecharModal, copiarTexto, carregarDados };
})();