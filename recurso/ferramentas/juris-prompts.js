window.PromptUIController = (function() {
    let prompts = JSON.parse(localStorage.getItem('juris_prompts_v2')) || [];
    let currentActivePrompt = null;
    let editingCustomFields = [];

    const getEl = (id) => document.getElementById(id);

    function renderList(data = prompts) {
        const list = getEl('jp-list');
        list.innerHTML = '';
        if (data.length === 0) {
            list.innerHTML = `<div style="text-align: center; color: #64748b; padding: 2rem; border: 1px dashed #cbd5e0; border-radius: 8px;">Nenhum modelo encontrado.</div>`;
            return;
        }

        data.forEach(p => {
            const hasExtras = p.customFields && p.customFields.length > 0;
            const badge = hasExtras ? `<span style="background:#e0f2fe; color:#0369a1; padding: 2px 6px; border-radius:4px; font-size:0.7rem; margin-left:8px;">+${p.customFields.length} extras</span>` : '';
            
            const card = document.createElement('div');
            card.className = 'jp-card';
            card.innerHTML = `
                <div class="jp-card-info">
                    <div class="jp-title">${p.title} ${badge}</div>
                    <div class="jp-preview">${p.content.substring(0, 70)}...</div>
                </div>
                <div class="jp-actions">
                    <button class="jp-icon-btn jp-play" onclick="PromptUIController.openGenModal('${p.id}')" title="Gerar"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>
                    <button class="jp-icon-btn jp-edit" onclick="PromptUIController.openEditModal('${p.id}')" title="Editar"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                    <button class="jp-icon-btn jp-del" onclick="PromptUIController.deletePrompt('${p.id}')" title="Excluir"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            `;
            list.appendChild(card);
        });
    }

    function renderBuilder() {
        const c = getEl('jp-builder-container');
        c.innerHTML = '';
        editingCustomFields.forEach((field, index) => {
            const card = document.createElement('div');
            card.className = 'jp-field-card';
            let spec = field.type === 'checkbox' ? `<label style="font-size:0.8rem; margin-top:8px; display:block;">Opções (uma por linha):</label><textarea class="jp-input" style="min-height:60px; padding:0.5rem;" onchange="PromptUIController.updField(${index}, 'options', this.value)">${field.options || ''}</textarea>` : '';
            
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
                    <span style="background:#e2e8f0; padding:2px 8px; border-radius:12px; font-size:0.75rem;">${field.type.toUpperCase()}</span>
                    <span style="color:#ef4444; cursor:pointer; font-weight:bold;" onclick="PromptUIController.rmField(${index})">✕</span>
                </div>
                <input type="text" class="jp-input" placeholder="Título do Campo" value="${field.label}" onchange="PromptUIController.updField(${index}, 'label', this.value)" required>
                ${spec}
            `;
            c.appendChild(card);
        });
    }

    // Abertura Modal Principal
    function abrirModal() {
        getEl('backdrop-juris-prompts').classList.add('active');
        getEl('modal-juris-prompts').style.display = 'block';
        renderList();
    }
    function fecharModalPrincipal() {
        getEl('backdrop-juris-prompts').classList.remove('active');
        getEl('modal-juris-prompts').style.display = 'none';
    }

    // Abertura Form
    function openAddModal() {
        getEl('jp-id').value = '';
        getEl('jp-title-input').value = '';
        getEl('jp-content-input').value = '';
        getEl('jp-form-title').innerText = 'Novo Modelo';
        editingCustomFields = [];
        renderBuilder();
        getEl('backdrop-jp-form').classList.add('active');
        getEl('modal-jp-form').style.display = 'block';
    }
    function openEditModal(id) {
        const p = prompts.find(x => x.id === id);
        if(!p) return;
        getEl('jp-id').value = p.id;
        getEl('jp-title-input').value = p.title;
        getEl('jp-content-input').value = p.content;
        getEl('jp-form-title').innerText = 'Editar Modelo';
        editingCustomFields = p.customFields ? JSON.parse(JSON.stringify(p.customFields)) : [];
        renderBuilder();
        getEl('backdrop-jp-form').classList.add('active');
        getEl('modal-jp-form').style.display = 'block';
    }
    function closeAddModal() {
        getEl('backdrop-jp-form').classList.remove('active');
        getEl('modal-jp-form').style.display = 'none';
    }

    // Abertura Gerador
    function openGenModal(id) {
        currentActivePrompt = prompts.find(x => x.id === id);
        if(!currentActivePrompt) return;
        getEl('jp-gen-base').value = currentActivePrompt.content;
        
        const genDiv = getEl('jp-gen-dynamic');
        genDiv.innerHTML = '';
        genDiv.style.display = 'none';

        if (currentActivePrompt.customFields && currentActivePrompt.customFields.length > 0) {
            genDiv.style.display = 'block';
            let html = '<div style="font-size:0.85rem; font-weight:bold; color:#b48500; margin-bottom:10px;">Preencha:</div>';
            currentActivePrompt.customFields.forEach(f => {
                html += `<div class="jp-form-group"><label>${f.label}</label>`;
                if(f.type === 'text') {
                    html += `<textarea class="jp-input jp-dyn-txt" data-label="${f.label}" style="min-height:60px;"></textarea>`;
                } else if (f.type === 'checkbox') {
                    const opts = f.options.split('\n').filter(o => o.trim() !== '');
                    html += `<div class="jp-dyn-chk-grp" data-label="${f.label}">`;
                    opts.forEach(opt => html += `<label style="display:flex; gap:8px; margin-top:5px; font-weight:normal; color:#1e293b;"><input type="checkbox" value="${opt.trim()}"> ${opt.trim()}</label>`);
                    html += `</div>`;
                }
                html += `</div>`;
            });
            genDiv.innerHTML = html;
        }
        getEl('backdrop-jp-gen').classList.add('active');
        getEl('modal-jp-gen').style.display = 'block';
    }
    function closeGenModal() {
        getEl('backdrop-jp-gen').classList.remove('active');
        getEl('modal-jp-gen').style.display = 'none';
    }

    // Ações e Persistência
    function savePrompt() {
        const id = getEl('jp-id').value;
        const title = getEl('jp-title-input').value.trim();
        const content = getEl('jp-content-input').value.trim();
        if(!title || !content) { alert('Preencha nome e teor.'); return; }
        
        const validFields = editingCustomFields.filter(f => f.label.trim() !== '');
        
        if(id) {
            const idx = prompts.findIndex(x => x.id === id);
            prompts[idx] = { id, title, content, customFields: validFields };
        } else {
            prompts.push({ id: 'p_'+Date.now().toString(36), title, content, customFields: validFields });
        }
        localStorage.setItem('juris_prompts_v2', JSON.stringify(prompts));
        closeAddModal();
        renderList();
        if(window.exibirToast) exibirToast('Salvo com sucesso!', 'sucesso');
    }

    function deletePrompt(id) {
        if(confirm('Excluir este modelo?')) {
            prompts = prompts.filter(x => x.id !== id);
            localStorage.setItem('juris_prompts_v2', JSON.stringify(prompts));
            renderList();
        }
    }

    async function copyToClipboard() {
        let final = currentActivePrompt.content + "\n\n";
        if(getEl('jp-gen-dynamic').style.display === 'block') {
            document.querySelectorAll('.jp-dyn-txt').forEach(inp => {
                if(inp.value.trim() !== '') final += `[${inp.getAttribute('data-label')}]:\n${inp.value.trim()}\n\n`;
            });
            document.querySelectorAll('.jp-dyn-chk-grp').forEach(grp => {
                const checks = grp.querySelectorAll('input:checked');
                if(checks.length > 0) {
                    final += `[${grp.getAttribute('data-label')}]:\n`;
                    checks.forEach(c => final += `- ${c.value}\n`);
                    final += `\n`;
                }
            });
        }
        try {
            await navigator.clipboard.writeText(final.trim());
            if(window.exibirToast) exibirToast('Copiado!', 'sucesso');
            closeGenModal();
        } catch(e) { alert('Erro ao copiar.'); }
    }

    return {
        abrirModal, fecharModalPrincipal, filter: () => {
            const term = getEl('jp-search').value.toLowerCase();
            renderList(prompts.filter(p => p.title.toLowerCase().includes(term) || p.content.toLowerCase().includes(term)));
        },
        openAddModal, closeAddModal, openEditModal, openGenModal, closeGenModal,
        addField: (t) => { editingCustomFields.push({type: t, label: '', options: ''}); renderBuilder(); },
        updField: (idx, k, v) => { editingCustomFields[idx][k] = v; },
        rmField: (idx) => { editingCustomFields.splice(idx,1); renderBuilder(); },
        savePrompt, deletePrompt, copyToClipboard
    };
})();