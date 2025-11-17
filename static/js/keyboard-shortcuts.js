/**
 * Sistema de Atalhos de Teclado
 * VERSÃO 5.0 - COMPATÍVEL COM BRAVE, SAFARI E TODOS OS BROWSERS
 */

class KeyboardShortcuts {
    constructor() {
        this.shortcuts = new Map();
        this.isEnabled = true;
        this.modalVisible = false;
        this.browser = this.detectBrowser();
        this.isMac = this.detectMac();
        this.sequenceBuffer = [];
        this.sequenceTimeout = null;
        this.activeModifiers = {
            ctrl: false,
            shift: false,
            alt: false,
            meta: false
        };

        this.init();
    }

    detectBrowser() {
        const ua = navigator.userAgent.toLowerCase();

        if (ua.indexOf('firefox') > -1) return 'firefox';
        if (ua.indexOf('edg') > -1) return 'edge';
        if (ua.indexOf('brave') > -1 || navigator.brave) return 'brave';
        if (ua.indexOf('chrome') > -1) return 'chrome';
        if (ua.indexOf('safari') > -1 && ua.indexOf('chrome') === -1) return 'safari';

        return 'unknown';
    }

    detectMac() {
        return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ||
            /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);
    }

    init() {
        this.registerDefaultShortcuts();
        this.attachEventListeners();
        this.createShortcutsModal();
        this.loadUserPreferences();
        this.showWelcomeHint();
    }

    showWelcomeHint() {
        const hasSeenHint = localStorage.getItem('keyboardShortcutsHintSeen');
        if (!hasSeenHint) {
            setTimeout(() => {
                this.showNotification('💡 Pressione Shift + F1 para ver os atalhos', 'info', 4000);
                localStorage.setItem('keyboardShortcutsHintSeen', 'true');
            }, 2000);
        }
    }

    /**
     * Registra atalhos usando APENAS teclas simples ou sequências
     * SEM modificadores que possam conflitar
     */
    registerDefaultShortcuts() {
        // === ATALHOS ESPECIAIS (SEM CONFLITO) ===

        // Ajuda - apenas ?
        this.register({
            key: 'F1',
            shift: true, // ? requer Shift naturalmente
            description: 'Mostrar/Ocultar atalhos',
            category: 'Ajuda',
            icon: '📚',
            action: (e) => {
                e.preventDefault();
                this.toggleShortcutsModal();
            }
        });

        // === MENSAGENS (UNIVERSAIS) ===
        this.register({
            key: 'Enter',
            description: 'Enviar mensagem',
            category: 'Mensagens',
            icon: '📤',
            action: (e) => {
                const userInput = document.getElementById('user-input');
                if (document.activeElement === userInput && !e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const form = document.getElementById('chat-form');
                    if (form) {
                        // Chama o handler diretamente
                        const submitEvent = new Event('submit', {
                            bubbles: false,
                            cancelable: true
                        });
                        form.dispatchEvent(submitEvent);
                    }

                    return false;
                }
            }
        });

        this.register({
            key: 'Enter',
            shift: true,
            description: 'Nova linha',
            category: 'Mensagens',
            icon: '↵',
            action: () => {
                // Comportamento padrão
            }
        });

        this.register({
            key: 'Escape',
            description: 'Cancelar/Limpar/Fechar',
            category: 'Mensagens',
            icon: '🚫',
            action: (e) => {
                this.handleEscape();
            }
        });

        // === SEQUÊNCIAS VIM-STYLE (FUNCIONAM EM TODOS OS BROWSERS) ===

        // g seguido de outra tecla
        this.registerSequence(['g', 'g'], 'Ir para o topo', 'Navegação', '⬆️', () => {
            if (this.isInTextInput()) return;
            const messages = document.getElementById('messages');
            if (messages) {
                messages.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });

        this.registerSequence(['G'], 'Ir para o fim (Shift+G)', 'Navegação', '⬇️', () => {
            if (this.isInTextInput()) return;
            const messages = document.getElementById('messages');
            if (messages) {
                messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
            }
        });

        this.registerSequence(['g', 'n'], 'Nova conversa', 'Navegação', '➕', () => {
            document.getElementById('new-chat-button')?.click();
        });

        this.registerSequence(['g', 'b'], 'Toggle sidebar', 'Navegação', '📂', () => {
            const toggleBtn = document.getElementById('toggle-sidebar') ||
                document.getElementById('toggle-sidebar-hidden');
            toggleBtn?.click();
        });

        this.registerSequence(['g', 'i'], 'Focar no input', 'Navegação', '✏️', () => {
            const input = document.getElementById('user-input');
            input?.focus();
            if (input) {
                input.selectionStart = input.selectionEnd = input.value.length;
            }
        });

        this.registerSequence(['g', 'u'], 'Upload arquivo', 'Arquivos', '📎', () => {
            document.getElementById('upload-file-button')?.click();
        });

        this.registerSequence(['g', 'f'], 'Upload pasta', 'Arquivos', '📁', () => {
            document.getElementById('upload-folder-button')?.click();
        });

        this.registerSequence(['g', 'c'], 'Copiar última resposta', 'Edição', '📋', () => {
            this.copyLastResponse();
        });

        this.registerSequence(['g', 'l'], 'Limpar conversa', 'Edição', '🗑️', () => {
            if (confirm('Deseja limpar esta conversa?')) {
                document.getElementById('clear-history-button')?.click();
            }
        });

        this.registerSequence(['g', 't'], 'Alternar tema', 'Aparência', '🌓', () => {
            document.getElementById('toggle-theme')?.click();
        });

        this.registerSequence(['g', 'm'], 'Modo foco', 'Aparência', '🎯', () => {
            const isHidden = document.body.classList.toggle('sidebar-hidden');
            localStorage.setItem('sidebar', isHidden ? 'hidden' : 'visible');
            this.showNotification(
                isHidden ? 'Modo foco ativado' : 'Modo normal',
                'success'
            );
        });

        this.registerSequence(['g', 'r'], 'Renomear conversa', 'Conversas', '✏️', () => {
            const activeChat = document.querySelector('.chat-item.active');
            if (activeChat) {
                const renameBtn = activeChat.querySelector('.fa-edit')?.parentElement;
                renameBtn?.click();
            }
        });

        // Navegação entre conversas
        this.registerSequence(['j'], 'Próxima conversa', 'Conversas', '⬇️', () => {
            if (this.isInTextInput()) return;
            this.navigateChats('down');
        });

        this.registerSequence(['k'], 'Conversa anterior', 'Conversas', '⬆️', () => {
            if (this.isInTextInput()) return;
            this.navigateChats('up');
        });

        // Provedores - usando números simples quando não está no input
        for (let i = 1; i <= 4; i++) {
            this.registerSequence([i.toString()], `Provedor ${i}`, 'Provedor', '🤖', () => {
                if (this.isInTextInput()) return;
                this.selectProvider(i - 1);
            });
        }

        // Atalho especial: / para focar no input (como busca)
        this.register({
            key: '/',
            description: 'Focar na caixa de mensagem',
            category: 'Navegação',
            icon: '✏️',
            action: (e) => {
                if (this.isInTextInput()) return;
                e.preventDefault();
                const input = document.getElementById('user-input');
                input?.focus();
            }
        });
    }

    /**
     * Registra uma sequência de teclas (estilo Vim)
     */
    registerSequence(sequence, description, category, icon, action) {
        const key = 'seq:' + sequence.join(',');
        this.shortcuts.set(key, {
            sequence: sequence,
            description: description,
            category: category,
            icon: icon,
            action: action,
            isSequence: true
        });
    }

    handleEscape() {
        // Limpa buffer de sequência
        this.sequenceBuffer = [];
        if (this.sequenceTimeout) {
            clearTimeout(this.sequenceTimeout);
            this.sequenceTimeout = null;
        }

        if (this.modalVisible) {
            this.toggleShortcutsModal();
            return;
        }

        const userInput = document.getElementById('user-input');
        if (document.activeElement === userInput) {
            if (userInput.value.trim()) {
                userInput.value = '';
                userInput.style.height = 'auto';
            } else {
                userInput.blur();
            }
            return;
        }

        if (window.innerWidth <= 768 && !document.body.classList.contains('sidebar-hidden')) {
            document.body.classList.add('sidebar-hidden');
            localStorage.setItem('sidebar', 'hidden');
        }
    }

    register(shortcut) {
        const key = this.createShortcutKey(shortcut);
        this.shortcuts.set(key, shortcut);
    }

    createShortcutKey(shortcut) {
        const parts = [];
        if (shortcut.ctrl) parts.push('ctrl');
        if (shortcut.shift) parts.push('shift');
        if (shortcut.alt) parts.push('alt');
        if (shortcut.meta) parts.push('meta');
        parts.push(shortcut.key.toLowerCase());
        return parts.join('+');
    }

    attachEventListeners() {
        document.addEventListener('keydown', (e) => this.handleKeyDown(e), false);
        document.addEventListener('keyup', (e) => this.handleKeyUp(e), false);
    }

    handleKeyDown(e) {
        if (!this.isEnabled) return;

        this.activeModifiers.ctrl = e.ctrlKey;
        this.activeModifiers.shift = e.shiftKey;
        this.activeModifiers.alt = e.altKey;
        this.activeModifiers.meta = e.metaKey;

        // Verifica se é um atalho de tecla única
        const shortcutKey = this.createShortcutKey({
            key: e.key,
            ctrl: this.activeModifiers.ctrl,
            shift: this.activeModifiers.shift,
            alt: this.activeModifiers.alt,
            meta: this.activeModifiers.meta
        });

        const shortcut = this.shortcuts.get(shortcutKey);
        if (shortcut && !shortcut.isSequence) {
            shortcut.action(e);
            return;
        }

        // Se está em input de texto, ignora sequências (exceto Esc)
        if (this.isInTextInput() && e.key !== 'Escape') {
            return;
        }

        // Ignora teclas modificadoras
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
            return;
        }

        // Ignora se tem modificadores (exceto Shift para maiúsculas)
        if (e.ctrlKey || e.altKey || e.metaKey) {
            return;
        }

        // Adiciona tecla ao buffer de sequência
        this.sequenceBuffer.push(e.key);

        // Limpa timeout anterior
        if (this.sequenceTimeout) {
            clearTimeout(this.sequenceTimeout);
        }

        // Define timeout para limpar buffer (1 segundo)
        this.sequenceTimeout = setTimeout(() => {
            this.sequenceBuffer = [];
            this.sequenceTimeout = null;
        }, 1000);

        // Verifica se a sequência atual corresponde a algum atalho
        this.checkSequence(e);
    }

    checkSequence(e) {
        const currentSequence = this.sequenceBuffer.join(',');

        // Procura por sequências que correspondam
        for (const [key, shortcut] of this.shortcuts.entries()) {
            if (!shortcut.isSequence) continue;

            const targetSequence = shortcut.sequence.join(',');

            // Correspondência exata
            if (currentSequence === targetSequence) {
                e.preventDefault();
                shortcut.action();
                this.sequenceBuffer = [];
                if (this.sequenceTimeout) {
                    clearTimeout(this.sequenceTimeout);
                    this.sequenceTimeout = null;
                }

                // Mostra feedback
                this.showNotification(`✨ ${shortcut.description}`, 'success', 1000);
                return;
            }
        }

        // Mostra indicador de sequência em progresso
        if (this.sequenceBuffer.length > 0) {
            this.showSequenceIndicator(this.sequenceBuffer.join(' '));
        }
    }

    showSequenceIndicator(sequence) {
        let indicator = document.getElementById('sequence-indicator');

        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'sequence-indicator';
            indicator.className = 'sequence-indicator';
            document.body.appendChild(indicator);
        }

        indicator.textContent = sequence;
        indicator.classList.add('show');

        clearTimeout(indicator.hideTimeout);
        indicator.hideTimeout = setTimeout(() => {
            indicator.classList.remove('show');
        }, 1000);
    }

    handleKeyUp(e) {
        this.activeModifiers.ctrl = e.ctrlKey;
        this.activeModifiers.shift = e.shiftKey;
        this.activeModifiers.alt = e.altKey;
        this.activeModifiers.meta = e.metaKey;
    }

    isInTextInput() {
        const active = document.activeElement;
        return active && (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.isContentEditable
        );
    }

    navigateChats(direction) {
        const chatItems = Array.from(document.querySelectorAll('.chat-item'));
        const activeChat = document.querySelector('.chat-item.active');

        if (!activeChat || chatItems.length === 0) return;

        const currentIndex = chatItems.indexOf(activeChat);
        const newIndex = direction === 'up'
            ? (currentIndex > 0 ? currentIndex - 1 : chatItems.length - 1)
            : (currentIndex < chatItems.length - 1 ? currentIndex + 1 : 0);

        chatItems[newIndex]?.click();
        this.showNotification(`Conversa ${newIndex + 1}/${chatItems.length}`, 'info', 1000);
    }

    selectProvider(index) {
        const select = document.getElementById('llm-provider-select');
        if (select?.options[index]) {
            select.selectedIndex = index;
            select.dispatchEvent(new Event('change'));
            this.showNotification(`✅ ${select.options[index].text}`, 'success');
        }
    }

    copyLastResponse() {
        const messages = document.querySelectorAll('.assistant-message .message-content');
        if (messages.length === 0) {
            this.showNotification('❌ Nenhuma resposta para copiar', 'error');
            return;
        }

        const lastMessage = messages[messages.length - 1];
        const text = lastMessage.textContent.replace(/^[^:]+:\s*/, '');

        navigator.clipboard.writeText(text).then(() => {
            this.showNotification('✅ Resposta copiada!', 'success');
        }).catch(() => {
            this.showNotification('❌ Erro ao copiar', 'error');
        });
    }

    createShortcutsModal() {
        const modal = document.createElement('div');
        modal.id = 'shortcuts-modal';
        modal.className = 'shortcuts-modal';

        const browserName = {
            firefox: 'Firefox',
            chrome: 'Chrome',
            safari: 'Safari',
            brave: 'Brave',
            edge: 'Edge',
            unknown: 'Navegador'
        }[this.browser];

        modal.innerHTML = `
                <div class="shortcuts-modal-content">
                    <div class="shortcuts-modal-header">
                        <h2>
                            <i class="fas fa-keyboard"></i> 
                            Atalhos de Teclado
                            <span class="os-badge">${browserName}</span>
                        </h2>
                        <button class="shortcuts-modal-close" aria-label="Fechar">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="shortcuts-modal-body">
                        <div class="shortcuts-info">
                            <i class="fas fa-lightbulb"></i>
                            <div>
                                <p><strong>Sequências Vim-Style:</strong> Digite <kbd>g</kbd> seguido de outra tecla.</p>
                                <p><strong>Exemplo:</strong> <kbd>g</kbd> <kbd>n</kbd> = Nova conversa</p>
                                <p><strong>Dica:</strong> Teclas simples funcionam fora do campo de texto.</p>
                            </div>
                        </div>
                        ${this.generateShortcutsHTML()}
                    </div>
                    <div class="shortcuts-modal-footer">
                        <label class="shortcuts-toggle">
                            <input type="checkbox" id="shortcuts-enabled" ${this.isEnabled ? 'checked' : ''}>
                            <span>Atalhos habilitados</span>
                        </label>
                        <span class="shortcuts-hint">
                            Pressione <kbd>Shift + F1</kbd> para abrir/fechar
                        </span>
                    </div>
                </div>
            `;

        document.body.appendChild(modal);

        modal.querySelector('.shortcuts-modal-close').addEventListener('click', () => {
            this.toggleShortcutsModal();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.toggleShortcutsModal();
        });

        modal.querySelector('#shortcuts-enabled').addEventListener('change', (e) => {
            this.isEnabled = e.target.checked;
            localStorage.setItem('keyboardShortcutsEnabled', this.isEnabled);
            this.showNotification(
                this.isEnabled ? '✅ Atalhos habilitados' : '🚫 Atalhos desabilitados',
                'info'
            );
        });
    }

    generateShortcutsHTML() {
        const categories = {};

        this.shortcuts.forEach(shortcut => {
            const category = shortcut.category || 'Outros';
            if (!categories[category]) categories[category] = [];
            categories[category].push(shortcut);
        });

        let html = '';
        const order = ['Ajuda', 'Navegação', 'Mensagens', 'Conversas', 'Arquivos', 'Edição', 'Provedor', 'Aparência'];

        order.forEach(category => {
            if (!categories[category]) return;

            html += `<div class="shortcuts-category">
                    <h3>${category}</h3>
                    <div class="shortcuts-list">`;

            categories[category].forEach(shortcut => {
                html += `
                        <div class="shortcut-item">
                            <span class="shortcut-icon">${shortcut.icon || '⚡'}</span>
                            <span class="shortcut-description">${shortcut.description}</span>
                            <span class="shortcut-keys">${this.formatShortcutKeys(shortcut)}</span>
                        </div>
                    `;
            });

            html += `</div></div>`;
        });

        return html;
    }

    formatShortcutKeys(shortcut) {
        if (shortcut.isSequence) {
            return shortcut.sequence.map(k => `<kbd>${k}</kbd>`).join(' ');
        }

        const keys = [];

        if (shortcut.meta) keys.push('⌘');
        if (shortcut.ctrl && !this.isMac) keys.push('Ctrl');
        if (shortcut.ctrl && this.isMac) keys.push('⌃');
        if (shortcut.shift) keys.push('⇧');
        if (shortcut.alt) keys.push(this.isMac ? '⌥' : 'Alt');

        const keyMap = {
            'Enter': '↵',
            'Escape': 'Esc',
            'Delete': 'Del',
            'ArrowUp': '↑',
            'ArrowDown': '↓',
            'ArrowLeft': '←',
            'ArrowRight': '→'
        };

        keys.push(keyMap[shortcut.key] || shortcut.key);

        return keys.map(k => `<kbd>${k}</kbd>`).join(' + ');
    }

    toggleShortcutsModal() {
        const modal = document.getElementById('shortcuts-modal');
        if (!modal) return;

        this.modalVisible = !this.modalVisible;
        modal.classList.toggle('active', this.modalVisible);
        document.body.style.overflow = this.modalVisible ? 'hidden' : '';
    }

    showNotification(message, type = 'info', duration = 2000) {
        const notification = document.createElement('div');
        notification.className = `keyboard-notification ${type}`;

        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            info: 'info-circle'
        };

        notification.innerHTML = `
                <i class="fas fa-${icons[type]}"></i>
                <span>${message}</span>
            `;

        document.body.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 10);

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }

    loadUserPreferences() {
        const enabled = localStorage.getItem('keyboardShortcutsEnabled');
        if (enabled !== null) {
            this.isEnabled = enabled === 'true';
        }
    }
}

// Inicializa
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.keyboardShortcuts = new KeyboardShortcuts();
    });
} else {
    window.keyboardShortcuts = new KeyboardShortcuts();
}