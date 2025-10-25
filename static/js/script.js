/**
 * Chat com LLM - Cliente JavaScript
 * Versão com Gerenciamento Robusto de Conexão WebSocket
 */

document.addEventListener('DOMContentLoaded', () => {
    // ============================================
    // ELEMENTOS DO DOM
    // ============================================
    const chatListDiv = document.getElementById('chat-list');
    const chatForm = document.getElementById('chat-form');
    const userInput = document.getElementById('user-input');
    const messagesDiv = document.getElementById('messages');
    const newChatButton = document.getElementById('new-chat-button');
    const llmProviderSelect = document.getElementById('llm-provider-select');
    const toggleThemeButton = document.getElementById('toggle-theme');
    const toggleSidebarButton = document.getElementById('toggle-sidebar');
    const toggleSidebarHiddenButton = document.getElementById('toggle-sidebar-hidden');
    const uploadFileButton = document.getElementById('upload-file-button');
    const uploadFolderButton = document.getElementById('upload-folder-button');
    const fileInput = document.getElementById('file-input');
    const folderInput = document.getElementById('folder-input');
    const filePreviewContainer = document.getElementById('file-preview-container');
    const clearHistoryButton = document.getElementById('clear-history-button');

    // ============================================
    // ESTADO DA APLICAÇÃO
    // ============================================
    let currentChatID = null;
    let connectionManager = null;
    let assistantName = "Assistente";
    let attachedFiles = [];
    let processingFiles = false;

    // Mapeamento de provedores
    const providerMap = new Map();

    // Detecção de browser
    const detectBrowser = () => {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.indexOf('firefox') > -1) return 'firefox';
        if (ua.indexOf('edg') > -1) return 'edge';
        if (ua.indexOf('brave') > -1 || navigator.brave) return 'brave';
        if (ua.indexOf('chrome') > -1) return 'chrome';
        if (ua.indexOf('safari') > -1 && ua.indexOf('chrome') === -1) return 'safari';
        return 'unknown';
    };

    const browser = detectBrowser();
    console.log('🌐 Browser detectado:', browser);

    // Tipos de arquivo suportados
    const SUPPORTED_TYPES = {
        image: {
            extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'],
            mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml'],
            maxSize: 10 * 1024 * 1024,
            icon: '🖼️',
            color: '#4CAF50'
        },
        pdf: {
            extensions: ['.pdf'],
            mimeTypes: ['application/pdf'],
            maxSize: 25 * 1024 * 1024,
            icon: '📕',
            color: '#F44336'
        },
        docx: {
            extensions: ['.docx'],
            mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
            maxSize: 15 * 1024 * 1024,
            icon: '📘',
            color: '#2196F3'
        },
        xlsx: {
            extensions: ['.xlsx'],
            mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
            maxSize: 15 * 1024 * 1024,
            icon: '📊',
            color: '#4CAF50'
        },
        code: {
            extensions: ['.js', '.ts', '.py', '.go', '.java', '.c', '.cpp', '.h', '.cs', '.rb', '.php', '.html', '.css', '.scss', '.sass'],
            maxSize: 5 * 1024 * 1024,
            icon: '💻',
            color: '#9C27B0'
        },
        config: {
            extensions: ['.json', '.yaml', '.yml', '.xml', '.toml', '.ini', '.conf', '.config', '.env'],
            maxSize: 5 * 1024 * 1024,
            icon: '⚙️',
            color: '#FF9800'
        },
        markdown: {
            extensions: ['.md', '.markdown', '.rst'],
            maxSize: 5 * 1024 * 1024,
            icon: '📝',
            color: '#607D8B'
        },
        text: {
            extensions: ['.txt', '.log', '.csv', '.tsv'],
            maxSize: 5 * 1024 * 1024,
            icon: '📄',
            color: '#9E9E9E'
        }
    };

    const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
    const MAX_FILES = 50;

    // ============================================
    // GERENCIADOR DE CONEXÃO WEBSOCKET
    // ============================================
    class ConnectionManager {
        constructor(config = {}) {
            this.config = {
                wsUrl: this.getWebSocketURL(),
                maxReconnectAttempts: 10,
                initialBackoff: 1000,
                maxBackoff: 30000,
                pingInterval: 30000,
                pongTimeout: 60000,
                ...config
            };

            this.ws = null;
            this.state = 'disconnected';
            this.reconnectAttempts = 0;
            this.reconnectTimer = null;
            this.pingTimer = null;
            this.lastPong = Date.now();
            this.messageQueue = [];
            this.eventHandlers = new Map();
        }

        getWebSocketURL() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${protocol}//${window.location.host}/ws`;
        }

        connect() {
            if (this.state === 'connecting' || this.state === 'connected') {
                console.log('⚠️ Já conectando ou conectado');
                return;
            }

            this.setState('connecting');
            console.log('🔌 Conectando WebSocket...', this.config.wsUrl);

            try {
                this.ws = new WebSocket(this.config.wsUrl);
                this.setupEventHandlers();
            } catch (error) {
                console.error('❌ Erro ao criar WebSocket:', error);
                this.handleReconnect();
            }
        }

        setupEventHandlers() {
            this.ws.onopen = () => this.handleOpen();
            this.ws.onmessage = (event) => this.handleMessage(event);
            this.ws.onclose = (event) => this.handleClose(event);
            this.ws.onerror = (error) => this.handleError(error);
        }

        handleOpen() {
            console.log('✅ WebSocket conectado');
            this.setState('connected');
            this.reconnectAttempts = 0;
            this.lastPong = Date.now();

            // Inicia ping/pong
            this.startPingPong();

            // Reenvia mensagens da fila
            this.flushMessageQueue();

            this.emit('connected');
        }

        handleMessage(event) {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'pong') {
                    this.lastPong = Date.now();
                    return;
                }

                this.emit('message', data);
            } catch (error) {
                console.error('❌ Erro ao processar mensagem:', error);
            }
        }

        handleClose(event) {
            console.log('🔌 WebSocket fechado', {
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean
            });

            this.stopPingPong();
            this.setState('disconnected');

            // Reconexão automática
            if (event.code !== 1000) {
                this.handleReconnect();
            }

            this.emit('disconnected', event);
        }

        handleError(error) {
            console.error('❌ Erro no WebSocket:', error);
            this.emit('error', error);
        }

        handleReconnect() {
            if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
                console.error('❌ Máximo de tentativas de reconexão atingido');
                this.setState('failed');
                this.emit('failed');
                return;
            }

            this.setState('reconnecting');
            this.reconnectAttempts++;

            const backoff = Math.min(
                this.config.initialBackoff * Math.pow(2, this.reconnectAttempts - 1),
                this.config.maxBackoff
            );

            console.log(`🔄 Reconectando em ${backoff}ms (tentativa ${this.reconnectAttempts})...`);

            this.reconnectTimer = setTimeout(() => {
                this.connect();
            }, backoff);

            this.emit('reconnecting', { attempt: this.reconnectAttempts, backoff });
        }

        startPingPong() {
            this.stopPingPong();

            this.pingTimer = setInterval(() => {
                if (this.state !== 'connected') {
                    return;
                }

                // Verifica timeout de pong
                if (Date.now() - this.lastPong > this.config.pongTimeout) {
                    console.warn('⚠️ Pong timeout, reconectando...');
                    this.ws.close(1006, 'Pong timeout');
                    return;
                }

                // Envia ping
                this.send({ type: 'ping' });
            }, this.config.pingInterval);
        }

        stopPingPong() {
            if (this.pingTimer) {
                clearInterval(this.pingTimer);
                this.pingTimer = null;
            }
        }

        send(data) {
            if (this.state !== 'connected') {
                console.warn('⚠️ Não conectado, adicionando à fila');
                this.messageQueue.push(data);
                return false;
            }

            try {
                this.ws.send(JSON.stringify(data));
                return true;
            } catch (error) {
                console.error('❌ Erro ao enviar:', error);
                this.messageQueue.push(data);
                return false;
            }
        }

        flushMessageQueue() {
            if (this.messageQueue.length === 0) return;

            console.log(`📤 Reenviando ${this.messageQueue.length} mensagem(ns) da fila`);

            while (this.messageQueue.length > 0) {
                const message = this.messageQueue.shift();
                this.send(message);
            }
        }

        setState(newState) {
            const oldState = this.state;
            this.state = newState;

            if (oldState !== newState) {
                console.log(`🔄 Estado: ${oldState} → ${newState}`);
                this.emit('stateChange', { oldState, newState });
            }
        }

        on(event, handler) {
            if (!this.eventHandlers.has(event)) {
                this.eventHandlers.set(event, []);
            }
            this.eventHandlers.get(event).push(handler);
        }

        off(event, handler) {
            if (!this.eventHandlers.has(event)) return;
            const handlers = this.eventHandlers.get(event);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }

        emit(event, data) {
            if (!this.eventHandlers.has(event)) return;
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Erro no handler de ${event}:`, error);
                }
            });
        }

        close() {
            console.log('🔌 Fechando conexão manualmente');
            this.stopPingPong();

            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
            }

            if (this.ws) {
                this.ws.close(1000, 'Client closing');
            }

            this.setState('closed');
        }

        getState() {
            return this.state;
        }
    }

    // ============================================
    // INICIALIZAÇÃO DO MAPA DE PROVEDORES
    // ============================================
    function initializeProviderMap() {
        if (!llmProviderSelect) {
            console.error('❌ Select de provedor não encontrado');
            return;
        }

        providerMap.clear();
        const options = llmProviderSelect.querySelectorAll('option');

        options.forEach((option, index) => {
            const value = option.value;
            const text = option.textContent || option.innerText;
            const model = option.getAttribute('data-model') || '';

            providerMap.set(index, {
                value: value,
                text: text,
                model: model
            });

            console.log(`📌 Provedor ${index}:`, { value, text, model });
        });

        console.log('✅ Mapa de provedores inicializado:', providerMap.size, 'provedores');
    }

    // ============================================
    // OBTER PROVEDOR SELECIONADO
    // ============================================
    function getSelectedProvider() {
        if (!llmProviderSelect) {
            console.error('❌ Select não encontrado');
            return null;
        }

        const selectedIndex = llmProviderSelect.selectedIndex;

        if (selectedIndex === -1) {
            console.warn('⚠️ Nenhum índice selecionado');
            return null;
        }

        const fromMap = providerMap.get(selectedIndex);
        if (fromMap) {
            console.log('✅ Provedor do mapa:', fromMap);
            return fromMap;
        }

        const selectedOption = llmProviderSelect.options[selectedIndex];
        if (!selectedOption) {
            console.error('❌ Opção não encontrada no índice', selectedIndex);
            return null;
        }

        const provider = {
            value: selectedOption.value,
            text: selectedOption.textContent || selectedOption.innerText,
            model: selectedOption.getAttribute('data-model') || ''
        };

        console.log('✅ Provedor direto da option:', provider);
        return provider;
    }

    // ============================================
    // GARANTIR PROVEDOR SELECIONADO
    // ============================================
    function ensureProviderSelected() {
        if (!llmProviderSelect) {
            console.error('❌ Select de provedor não encontrado');
            return;
        }

        if (llmProviderSelect.selectedIndex === -1) {
            console.log('⚠️ Nenhum provedor selecionado, selecionando o primeiro');
            llmProviderSelect.selectedIndex = 0;
        }

        const event = new Event('change', { bubbles: true });
        llmProviderSelect.dispatchEvent(event);

        const provider = getSelectedProvider();
        if (provider) {
            console.log('✅ Provedor garantido:', provider);
            localStorage.setItem('selectedProviderIndex', llmProviderSelect.selectedIndex);
        }
    }

    // ============================================
// ATUALIZAR NOME DO ASSISTENTE
// ============================================
    function updateAssistantName() {
        const provider = getSelectedProvider();
        if (provider && provider.text) {
            assistantName = provider.text;
            console.log('🤖 Assistente atualizado:', assistantName);
        } else {
            assistantName = "Assistente";
            console.warn('⚠️ Não foi possível obter nome do provedor');
        }
    }

// ============================================
// INICIALIZAÇÃO DA CONEXÃO WEBSOCKET
// ============================================
    function initializeWebSocket() {
        connectionManager = new ConnectionManager();

        connectionManager.on('connected', () => {
            updateConnectionStatus(true);
            console.log('✅ Conexão estabelecida');
        });

        connectionManager.on('disconnected', () => {
            updateConnectionStatus(false);
        });

        connectionManager.on('reconnecting', (data) => {
            console.log(`🔄 Reconectando (tentativa ${data.attempt})...`);
            showNotification(`Reconectando... (tentativa ${data.attempt})`, 'info', 2000);
        });

        connectionManager.on('failed', () => {
            showNotification('❌ Falha na conexão. Recarregue a página.', 'error', 5000);
        });

        connectionManager.on('message', (data) => {
            handleServerMessage(data);
        });

        // Conecta
        connectionManager.connect();
    }

// ============================================
// INICIALIZAÇÃO
// ============================================
    function initialize() {
        loadUserTheme();
        loadChatList();

        const storedCurrentChat = localStorage.getItem('currentChatID');
        currentChatID = (storedCurrentChat && isChatExists(storedCurrentChat)) ? storedCurrentChat : createNewChat();

        loadChatHistory();

        initializeProviderMap();
        ensureProviderSelected();
        updateAssistantName();

        initializeWebSocket();
        addEventListeners();

        setupMobileInteractions();
        handleOrientationChange();
        setupTouchOptimizations();
        adjustTextareaHeight();
        addCopyButtonsToCode();

        if (localStorage.getItem('sidebar') === 'hidden') {
            document.body.classList.add('sidebar-hidden');
        }

        if (window.innerWidth <= 768) {
            document.body.classList.add('sidebar-hidden');
            localStorage.setItem('sidebar', 'hidden');
        }
    }

// ============================================
// EVENT LISTENERS
// ============================================
    function addEventListeners() {
        chatForm.addEventListener('submit', handleFormSubmit);
        userInput.addEventListener('input', autoResizeTextarea);

        if (llmProviderSelect) {
            llmProviderSelect.addEventListener('change', (e) => {
                console.log('🔄 Provedor mudou (change event)');
                updateAssistantName();
            });

            llmProviderSelect.addEventListener('click', (e) => {
                console.log('🖱️ Provedor clicado (click event)');
            });

            llmProviderSelect.addEventListener('input', (e) => {
                console.log('⌨️ Provedor input (input event)');
                updateAssistantName();
            });
        }

        newChatButton.addEventListener('click', handleNewChat);
        toggleThemeButton.addEventListener('click', toggleTheme);
        toggleSidebarButton.addEventListener('click', toggleSidebar);
        toggleSidebarHiddenButton.addEventListener('click', toggleSidebar);

        uploadFileButton.addEventListener('click', () => fileInput.click());
        uploadFolderButton.addEventListener('click', () => folderInput.click());

        fileInput.addEventListener('change', handleFilesSelected);
        folderInput.addEventListener('change', handleFilesSelected);

        clearHistoryButton.addEventListener('click', clearCurrentChatHistory);

        setupDragAndDrop();
    }

// ============================================
// MANIPULAÇÃO DE MENSAGENS DO SERVIDOR
// ============================================
    function handleServerMessage(data) {
        removeLastMessageIfTyping();
        removeLoadingIndicator();

        if (data.type === 'progress') {
            updateProcessingProgress(data);
            return;
        }

        if (data.status === 'completed') {
            const isMarkdown = data.isMarkdown !== undefined ? data.isMarkdown : true;

            console.log('Mensagem recebida:', {
                provider: data.provider,
                isMarkdown: isMarkdown,
                length: data.response.length,
                preview: data.response.substring(0, 100)
            });

            removeProgressMessage();

            // SEMPRE usar o efeito de digitação avançado
            addMessageWithTypingEffect(assistantName, data.response, 'assistant-message', isMarkdown, true);

        } else if (data.status === 'error') {
            removeProgressMessage();
            addMessage('Erro', data.response, 'error-message', false, false);
        }
    }

    function addMessageDirect(sender, text, messageClass, isMarkdown = false, save = false) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', messageClass);
        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');

        let cleanHtml;
        if (isMarkdown) {
            const parsed = marked.parse(text);
            cleanHtml = DOMPurify.sanitize(parsed);
        } else {
            // Escapa HTML para texto puro
            const tempDiv = document.createElement('div');
            tempDiv.textContent = text;
            cleanHtml = tempDiv.innerHTML.replace(/\n/g, "<br>");
        }

        contentElement.innerHTML = `<strong>${sender}:</strong> ${cleanHtml}`;

        messageElement.appendChild(contentElement);
        messagesDiv.appendChild(messageElement);

        // Aplica syntax highlighting e botões de cópia após a inserção
        if (isMarkdown) {
            contentElement.querySelectorAll('pre code').forEach(block => {
                if (!block.classList.contains('hljs')) {
                    hljs.highlightElement(block);
                }
            });
            contentElement.querySelectorAll('pre').forEach(pre => {
                if (!pre.closest('.code-block-wrapper')) {
                    addCopyButton(pre);
                }
            });
        }

        scrollToBottom('auto'); // Scroll imediato

        if (save) saveMessage(sender, text, isMarkdown);

        return contentElement;
    }

    function updateProcessingProgress(data) {
        let progressMessage = messagesDiv.querySelector('.progress-message');

        if (progressMessage) {
            const progressBar = progressMessage.querySelector('.progress-bar-fill');
            const progressText = progressMessage.querySelector('.progress-text');

            if (progressBar && data.percentage !== undefined) {
                progressBar.style.width = `${data.percentage}%`;
            }

            if (progressText && data.message) {
                progressText.textContent = data.message;
            }
        } else {
            addProgressMessage(data.message, data.percentage || 0);
        }
    }

    function addProgressMessage(message, percentage) {
        // Remove mensagem de progresso anterior se existir
        const existingProgress = messagesDiv.querySelector('.progress-message');
        if (existingProgress) {
            existingProgress.remove();
        }

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'system-message', 'progress-message');

        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');
        contentElement.innerHTML = `
            <div style="width: 100%; max-width: 600px; margin: 0 auto;">
                <div class="progress-text" style="margin-bottom: 10px; text-align: center; font-size: 13px;">
                    ${message}
                </div>
                <div class="progress-bar" style="width: 100%; height: 8px; background-color: rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden;">
                    <div class="progress-bar-fill" style="height: 100%; width: ${percentage}%; background: linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%); border-radius: 4px; transition: width 0.3s ease;"></div>
                </div>
            </div>
        `;

        messageElement.appendChild(contentElement);
        messagesDiv.appendChild(messageElement);
        scrollToBottom('auto');
    }

    function removeProgressMessage() {
        const progressMessages = messagesDiv.querySelectorAll('.progress-message');
        progressMessages.forEach(msg => msg.remove());
    }

    function updateConnectionStatus(connected) {
        const existingStatus = document.querySelector('.connection-status');
        if (existingStatus) existingStatus.remove();

        if (!connected) {
            const statusDiv = document.createElement('div');
            statusDiv.className = 'connection-status offline';
            statusDiv.innerHTML = '<i class="fas fa-exclamation-circle"></i> Desconectado';
            document.querySelector('.top-bar').appendChild(statusDiv);
        } else {
            // Remove status quando conectar
            if (existingStatus) {
                existingStatus.remove();
            }
        }
    }

// ============================================
// ENVIO DE MENSAGENS
// ============================================
    function handleFormSubmit(e) {
        e.preventDefault();

        console.log('📝 handleFormSubmit chamado');

        const message = userInput.value.trim();
        if (!message && attachedFiles.length === 0) {
            console.log('⚠️ Mensagem vazia e sem arquivos');
            return;
        }

        // VALIDAÇÃO DE CONEXÃO
        const connState = connectionManager.getState();
        if (connState !== 'connected') {
            console.error('❌ WebSocket não conectado, estado:', connState);
            addMessage('Erro', `Conexão perdida (${connState}). Aguarde a reconexão...`, 'error-message', false, false);
            return;
        }

        // VALIDAÇÃO DE PROVEDOR ANTES DE TUDO
        const provider = getSelectedProvider();
        if (!provider || !provider.value) {
            console.error('❌ Nenhum provedor selecionado no submit');
            console.error('Debug:', {
                llmProviderSelect: !!llmProviderSelect,
                selectedIndex: llmProviderSelect?.selectedIndex,
                optionsCount: llmProviderSelect?.options?.length,
                providerFromMap: providerMap.get(llmProviderSelect?.selectedIndex)
            });

            addMessage('Erro', 'Selecione um provedor LLM antes de enviar.', 'error-message', false, false);
            ensureProviderSelected();
            return;
        }

        console.log('✅ Validações passaram, provedor:', provider);

        // Adiciona mensagem do usuário
        if (message) addMessage('Você', message, 'user-message', false, true);

        // Notifica sobre arquivos
        if (attachedFiles.length > 0) {
            const totalSize = attachedFiles.reduce((sum, f) => sum + f.size, 0);

            const uploadMessage = document.createElement('div');
            uploadMessage.classList.add('message', 'system-message');
            const uploadContent = document.createElement('div');
            uploadContent.classList.add('message-content');
            uploadContent.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                <i class="fas fa-paperclip" style="color: #2196F3;"></i>
                <span>Enviando ${attachedFiles.length} arquivo(s) (${formatSize(totalSize)}) para análise...</span>
            </div>
        `;
            uploadMessage.appendChild(uploadContent);
            messagesDiv.appendChild(uploadMessage);
            scrollToBottom('auto');
        }

        // ENVIA MENSAGEM
        sendMessageToServer(message);

        showLoadingIndicator('Aguardando resposta...');

        // Limpa input
        userInput.value = '';
        userInput.style.height = 'auto';
        attachedFiles = [];
        updateFilePreview();
    }

    function sendMessageToServer(message) {
        // Validação do estado da conexão
        if (connectionManager.getState() !== 'connected') {
            console.error('❌ WebSocket não conectado');
            addMessage('Erro', 'Conexão perdida. Reconectando...', 'error-message', false, false);

            // Adiciona à fila com TODOS os campos necessários
            const provider = getSelectedProvider();
            if (provider && provider.value) {
                connectionManager.messageQueue.push({
                    provider: provider.value,
                    model: provider.model || "",
                    prompt: message,
                    history: getConversationHistory(),
                    files: attachedFiles.slice() // Clona o array
                });
            }
            return;
        }

        const history = getConversationHistory();
        const provider = getSelectedProvider();

        // VALIDAÇÃO CRÍTICA
        if (!provider || !provider.value) {
            console.error('❌ Provedor inválido ao enviar');
            console.error('Estado do select:', {
                selectedIndex: llmProviderSelect?.selectedIndex,
                optionsCount: llmProviderSelect?.options?.length,
                providerMapSize: providerMap.size
            });

            addMessage('Erro', 'Provedor LLM inválido. Selecione um provedor.', 'error-message', false, false);
            ensureProviderSelected();
            return;
        }

        // Função helper para mensagens de sistema consistentes
        function addSystemMessage(message, icon = 'info-circle', iconColor = '#2196F3') {
            const systemMessage = document.createElement('div');
            systemMessage.classList.add('message', 'system-message');

            const content = document.createElement('div');
            content.classList.add('message-content');
            content.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap;">
                <i class="fas fa-${icon}" style="color: ${iconColor}; flex-shrink: 0;"></i>
                <span style="flex: 1; min-width: 200px; text-align: center;">${message}</span>
            </div>
        `;

            systemMessage.appendChild(content);
            messagesDiv.appendChild(systemMessage);
            scrollToBottom('auto');

            return systemMessage;
        }

        // PAYLOAD COMPLETO E VALIDADO
        const payload = {
            type: 'message', // ADICIONA TIPO
            provider: provider.value,
            model: provider.model || "",
            prompt: message,
            history: history,
            files: attachedFiles.slice() // Clona para evitar mutação
        };

        // LOG DETALHADO
        console.log('📤 Enviando mensagem:', {
            provider: payload.provider,
            model: payload.model,
            prompt_length: message.length,
            history_length: history.length,
            files_count: payload.files.length,
            payload_keys: Object.keys(payload)
        });

        // VALIDAÇÃO FINAL ANTES DE ENVIAR
        if (!payload.provider) {
            console.error('❌ CRÍTICO: Payload sem provider!', payload);
            addMessage('Erro', 'Erro interno: provider não definido.', 'error-message', false, false);
            return;
        }

        // Envia
        const sent = connectionManager.send(payload);

        if (sent) {
            addMessage(assistantName, '', 'assistant-message', false, false, true);
        } else {
            console.warn('⚠️ Mensagem adicionada à fila');
            addMessage('Sistema', 'Mensagem na fila, aguardando reconexão...', 'system-message', false, false);
        }
    }

// ============================================
// PROCESSAMENTO DE ARQUIVOS
// ============================================
    async function handleFilesSelected(event) {
        if (processingFiles) {
            addMessage('Aviso', 'Aguarde o processamento dos arquivos anteriores.', 'system-message', false, false);
            return;
        }

        const files = Array.from(event.target.files);
        if (files.length === 0) return;

        if (files.length > MAX_FILES) {
            addMessage('Erro', `Máximo de ${MAX_FILES} arquivos por vez. Você selecionou ${files.length}.`, 'error-message', false, false);
            event.target.value = '';
            return;
        }

        processingFiles = true;
        addProgressMessage(`Processando ${files.length} arquivo(s)...`, 0);

        try {
            const processedFiles = await processFilesLocally(files);

            if (processedFiles.length === 0) {
                throw new Error('Nenhum arquivo válido foi processado.');
            }

            removeProgressMessage();
            attachedFiles = processedFiles;

            const totalSize = processedFiles.reduce((sum, f) => sum + f.size, 0);
            updateFilePreview();

            // Remove mensagem de progresso antes de adicionar nova
            removeProgressMessage();

            // Adiciona mensagem de sucesso
            const successMessage = document.createElement('div');
            successMessage.classList.add('message', 'system-message');
            const successContent = document.createElement('div');
            successContent.classList.add('message-content');
            successContent.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
            <i class="fas fa-check-circle" style="color: #4CAF50;"></i>
            <span>${processedFiles.length} arquivo(s) anexado(s) com sucesso (${formatSize(totalSize)})</span>
        </div>
    `;
            successMessage.appendChild(successContent);
            messagesDiv.appendChild(successMessage);
            scrollToBottom('auto');

            updateFilePreview();
        } catch (error) {
            removeProgressMessage();
            addMessage('Erro', error.message, 'error-message', false, false);
        } finally {
            processingFiles = false;
            event.target.value = '';
        }
    }

    async function processFilesLocally(files) {
        const processed = [];
        const errors = [];
        let totalSize = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            try {
                const percentage = Math.round(((i + 1) / files.length) * 100);
                updateProcessingProgress({
                    message: `Processando ${i + 1}/${files.length}: ${file.name}`,
                    percentage: percentage
                });

                const fileInfo = getFileInfo(file);
                if (!fileInfo) {
                    errors.push(`${file.name}: tipo de arquivo não suportado`);
                    continue;
                }

                if (file.size > fileInfo.maxSize) {
                    errors.push(`${file.name}: excede ${formatSize(fileInfo.maxSize)}`);
                    continue;
                }

                if (totalSize + file.size > MAX_TOTAL_SIZE) {
                    errors.push(`${file.name}: limite total de ${formatSize(MAX_TOTAL_SIZE)} atingido`);
                    continue;
                }

                const processedFile = await processFile(file, fileInfo);
                processed.push(processedFile);
                totalSize += file.size;

            } catch (error) {
                errors.push(`${file.name}: ${error.message}`);
            }
        }

        if (errors.length > 0) {
            console.warn('Arquivos com erro:', errors);
            addMessage('Avisos',
                `Alguns arquivos não puderam ser processados:\n${errors.join('\n')}`,
                'system-message', false, false);
        }

        return processed;
    }

    function getFileInfo(file) {
        const fileName = file.name.toLowerCase();
        const fileExt = '.' + fileName.split('.').pop();

        for (const [type, info] of Object.entries(SUPPORTED_TYPES)) {
            if (info.extensions && info.extensions.includes(fileExt)) {
                return { ...info, type };
            }
            if (info.mimeTypes && info.mimeTypes.includes(file.type)) {
                return { ...info, type };
            }
        }

        if (file.type.startsWith('text/')) {
            return { ...SUPPORTED_TYPES.text, type: 'text' };
        }

        return null;
    }

    async function processFile(file, fileInfo) {
        const isImage = fileInfo.type === 'image';
        const isPDF = fileInfo.type === 'pdf';
        const isOffice = ['docx', 'xlsx'].includes(fileInfo.type);

        const relativePath = file.webkitRelativePath || file.name;

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                let content = e.target.result;
                let isBase64 = isImage || isPDF || isOffice;

                if (isBase64 && typeof content === 'string' && content.includes('base64,')) {
                    content = content.split('base64,')[1];
                }

                resolve({
                    name: relativePath,
                    content: content,
                    contentType: file.type || 'application/octet-stream',
                    fileType: fileInfo.type,
                    size: file.size,
                    isBase64: isBase64,
                    metadata: {
                        lastModified: file.lastModified,
                        icon: fileInfo.icon,
                        color: fileInfo.color
                    }
                });
            };

            reader.onerror = () => reject(new Error(`Erro ao ler ${file.name}`));

            if (isImage || isPDF || isOffice) {
                reader.readAsDataURL(file);
            } else {
                reader.readAsText(file);
            }
        });
    }

    function updateFilePreview() {
        filePreviewContainer.innerHTML = '';
        if (attachedFiles.length === 0) {
            filePreviewContainer.style.display = 'none';
            return;
        }

        filePreviewContainer.style.display = 'block';

        const totalSize = attachedFiles.reduce((sum, f) => sum + f.size, 0);

        const header = document.createElement('div');
        header.className = 'file-preview-header';
        header.innerHTML = `
                <div class="file-preview-summary">
                    <span class="file-count">${attachedFiles.length} arquivo(s)</span>
                    <span class="file-size">${formatSize(totalSize)}</span>
                </div>
                <button type="button" class="clear-all-files" title="Remover todos">
                    <i class="fas fa-times"></i> Limpar tudo
                </button>
            `;

        header.querySelector('.clear-all-files').addEventListener('click', () => {
            attachedFiles = [];
            updateFilePreview();
        });

        filePreviewContainer.appendChild(header);

        const fileList = document.createElement('div');
        fileList.className = 'file-list';

        attachedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.style.borderLeft = `3px solid ${file.metadata.color || '#999'}`;

            const fileIcon = file.metadata.icon || '📄';
            const fileSize = formatSize(file.size);
            const fileType = file.fileType.toUpperCase();

            fileItem.innerHTML = `
                    <div class="file-info">
                        <span class="file-icon">${fileIcon}</span>
                        <div class="file-details">
                            <div class="file-name" title="${file.name}">${file.name}</div>
                            <div class="file-meta">
                                <span class="file-type-badge">${fileType}</span>
                                <span class="file-size-text">${fileSize}</span>
                            </div>
                        </div>
                    </div>
                    <button type="button" class="remove-file" title="Remover arquivo">
                        <i class="fas fa-times"></i>
                    </button>
                `;

            fileItem.querySelector('.remove-file').addEventListener('click', () => {
                attachedFiles.splice(index, 1);
                updateFilePreview();
            });

            fileList.appendChild(fileItem);
        });

        filePreviewContainer.appendChild(fileList);
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    function setupDragAndDrop() {
        const dropZone = document.getElementById('chat-container');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('drag-over');
            }, false);
        });

        dropZone.addEventListener('drop', handleDrop, false);
    }

    async function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = [...dt.files];

        if (files.length > 0) {
            const fakeEvent = { target: { files: files, value: '' } };
            await handleFilesSelected(fakeEvent);
        }
    }

// ============================================
// GERENCIAMENTO DE CONVERSAS
// ============================================
    function clearCurrentChatHistory() {
        if (!currentChatID || !confirm("Tem certeza que deseja limpar o histórico desta conversa?")) return;
        localStorage.setItem(currentChatID, '[]');
        loadChatHistory();
    }

    function getConversationHistory() {
        const history = JSON.parse(localStorage.getItem(currentChatID)) || [];
        return history.slice(-10).map(msg => ({
            role: msg.sender === 'Você' ? 'user' : 'assistant',
            content: msg.text,
        }));
    }

    function handleNewChat() {
        currentChatID = createNewChat();
        loadChatHistory();
    }

    function createNewChat() {
        const newChatID = `chat_${Date.now()}`;
        const chatList = JSON.parse(localStorage.getItem('chatList')) || [];
        chatList.push({ id: newChatID, name: `Conversa ${chatList.length + 1}` });
        localStorage.setItem('chatList', JSON.stringify(chatList));
        localStorage.setItem(newChatID, '[]');
        return newChatID;
    }

    function loadChatList() {
        chatListDiv.innerHTML = '';
        const chatList = JSON.parse(localStorage.getItem('chatList')) || [];
        chatList.forEach((chat) => {
            const chatItem = document.createElement('div');
            chatItem.classList.add('chat-item');
            chatItem.dataset.id = chat.id;
            if (chat.id === currentChatID) chatItem.classList.add('active');

            const chatNameSpan = document.createElement('span');
            chatNameSpan.className = 'chat-name';
            chatNameSpan.textContent = chat.name;

            const chatActionsDiv = document.createElement('div');
            chatActionsDiv.className = 'chat-actions';

            const renameButton = document.createElement('button');
            renameButton.innerHTML = '<i class="fas fa-edit"></i>';
            renameButton.onclick = (e) => { e.stopPropagation(); renameChat(chat.id, chat.name); };

            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
            deleteButton.onclick = (e) => { e.stopPropagation(); deleteChat(chat.id, chat.name); };

            chatActionsDiv.appendChild(renameButton);
            chatActionsDiv.appendChild(deleteButton);

            chatItem.appendChild(chatNameSpan);
            chatItem.appendChild(chatActionsDiv);

            chatItem.addEventListener('click', () => { currentChatID = chat.id; loadChatHistory(); });
            chatListDiv.appendChild(chatItem);
        });
    }

    function renameChat(chatID, currentName) {
        const newName = prompt("Novo nome:", currentName);
        if (newName && newName.trim()) {
            const chatList = JSON.parse(localStorage.getItem('chatList'));
            const chat = chatList.find(c => c.id === chatID);
            if (chat) {
                chat.name = newName.trim();
                localStorage.setItem('chatList', JSON.stringify(chatList));
                loadChatList();
            }
        }
    }

    function deleteChat(chatID, chatName) {
        if (confirm(`Deletar "${chatName}"?`)) {
            let chatList = (JSON.parse(localStorage.getItem('chatList')) || []).filter(c => c.id !== chatID);
            localStorage.setItem('chatList', JSON.stringify(chatList));
            localStorage.removeItem(chatID);
            if (currentChatID === chatID) {
                currentChatID = (chatList.length > 0) ? chatList[0].id : createNewChat();
                loadChatHistory();
            } else {
                loadChatList();
            }
        }
    }

    function isChatExists(chatID) {
        return (JSON.parse(localStorage.getItem('chatList')) || []).some(c => c.id === chatID);
    }

// ============================================
// EXIBIÇÃO DE MENSAGENS
// ============================================
    function scrollToBottom(behavior = 'smooth') {
        // Usa requestAnimationFrame para scroll mais eficiente
        requestAnimationFrame(() => {
            const isNearBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < 100;

            if (isNearBottom || behavior === 'auto') {
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            } else {
                messagesDiv.scrollTo({
                    top: messagesDiv.scrollHeight,
                    behavior: 'smooth'
                });
            }
        });
    }

    function showLoadingIndicator(message = 'Processando resposta...') {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'loading-indicator';
        loadingDiv.className = 'message system-message';
        loadingDiv.innerHTML = `
            <div class="message-content">
                <strong>Sistema:</strong>
                <div style="display: flex; align-items: center; gap: 10px; justify-content: center;">
                    <div class="typing-indicator">
                        <span></span><span></span><span></span>
                    </div>
                    <span>${message}</span>
                </div>
            </div>
        `;
        messagesDiv.appendChild(loadingDiv);
        scrollToBottom();
    }

    function removeLoadingIndicator() {
        const loading = document.getElementById('loading-indicator');
        if (loading) loading.remove();
    }

    function addMessage(sender, text, messageClass, isMarkdown = false, save = false, isTyping = false) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', messageClass);
        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');

        if (isTyping) {
            contentElement.innerHTML = `<strong>${sender}:</strong> <span class="typing-indicator"><span></span><span></span><span></span></span>`;
            messageElement.classList.add('typing');
        } else {
            let cleanHtml;
            if (isMarkdown) {
                const parsed = marked.parse(text);
                cleanHtml = DOMPurify.sanitize(parsed);
            } else {
                cleanHtml = DOMPurify.sanitize(text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>"));
            }
            contentElement.innerHTML = `<strong>${sender}:</strong> ${cleanHtml}`;
        }

        messageElement.appendChild(contentElement);
        messagesDiv.appendChild(messageElement);
        scrollToBottom();

        if (save) saveMessage(sender, text, isMarkdown);
        if (isMarkdown && !isTyping) {
            messageElement.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });
            messageElement.querySelectorAll('pre').forEach(pre => {
                if (!pre.closest('.code-block-wrapper')) {
                    addCopyButton(pre);
                }
            });
        }
        return contentElement;
    }

    // Debounce para evitar múltiplas chamadas
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Syntax highlighting otimizado com debounce
    const highlightCodeBlocks = debounce((container) => {
        container.querySelectorAll('pre code').forEach(block => {
            if (!block.classList.contains('hljs')) {
                hljs.highlightElement(block);
            }
        });

        container.querySelectorAll('pre').forEach(pre => {
            if (!pre.closest('.code-block-wrapper')) {
                addCopyButton(pre);
            }
        });
    }, 100);

    /**
     * Orquestra o efeito de digitação usando a técnica "Type-then-Swap".
     * 1. Cria um contêiner <pre> temporário para a digitação do texto bruto.
     * 2. Anima a digitação do texto Markdown/puro nesse contêiner.
     * 3. Ao concluir, substitui o contêiner temporário pelo HTML final renderizado.
     */
    function addMessageWithTypingEffect(sender, text, messageClass, isMarkdown, save) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', messageClass);
        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');

        // Adiciona o nome do remetente
        contentElement.innerHTML = `<strong>${sender}:</strong> `;

        // Passo 1: Cria o contêiner temporário para a digitação do texto bruto.
        // Usar <pre><code> garante que o layout não quebre durante a digitação.
        const tempTypingWrapper = document.createElement('pre');
        tempTypingWrapper.style.display = 'inline'; // Para fluir junto com o nome do remetente
        tempTypingWrapper.style.margin = '0';
        tempTypingWrapper.style.padding = '0';
        tempTypingWrapper.style.background = 'none';
        tempTypingWrapper.style.whiteSpace = 'pre-wrap'; // Permite quebra de linha
        tempTypingWrapper.style.wordBreak = 'break-word';

        const tempTypingElement = document.createElement('code');
        tempTypingElement.style.fontFamily = 'inherit';
        tempTypingElement.style.color = 'inherit';
        tempTypingElement.style.background = 'none';
        tempTypingElement.style.padding = '0';
        tempTypingElement.classList.add('typing-content'); // Adiciona o cursor piscando

        tempTypingWrapper.appendChild(tempTypingElement);
        contentElement.appendChild(tempTypingWrapper);

        messageElement.appendChild(contentElement);
        messagesDiv.appendChild(messageElement);
        scrollToBottom('auto');

        // Função a ser chamada quando a digitação terminar
        const onTypingComplete = () => {
            // Passo 3: Troca o conteúdo bruto pelo HTML formatado
            tempTypingWrapper.remove(); // Remove o contêiner temporário

            const finalContentSpan = document.createElement('span');

            let finalHtml;
            if (isMarkdown) {
                finalHtml = DOMPurify.sanitize(marked.parse(text));
            } else {
                // Para texto puro, apenas escapa e substitui quebras de linha
                const tempDiv = document.createElement('div');
                tempDiv.textContent = text;
                finalHtml = tempDiv.innerHTML.replace(/\n/g, "<br>");
            }

            finalContentSpan.innerHTML = finalHtml;
            contentElement.appendChild(finalContentSpan);

            // Remove a classe do cursor piscando do elemento pai
            tempTypingElement.classList.remove('typing-content');

            // Aplica o highlighting e botões de cópia no conteúdo final
            if (isMarkdown) {
                highlightCodeBlocks(contentElement);
            }

            if (save) saveMessage(sender, text, isMarkdown);
        };

        // Passo 2: Inicia a digitação do texto bruto no contêiner temporário
        typeWriterSimple(tempTypingElement, text, onTypingComplete);
    }

    /**
     * Anima a digitação de texto puro em um elemento, caractere por caractere.
     */
    function typeWriterSimple(container, text, onComplete) {
        let i = 0;
        const charsPerFrame = 3; // Ajuste para controlar a velocidade (1 = lento, 5 = rápido)
        let animationFrameId = null;

        function type() {
            if (i < text.length) {
                const endIndex = Math.min(i + charsPerFrame, text.length);
                container.textContent += text.substring(i, endIndex);
                i = endIndex;

                // Mantém o scroll no fundo de forma eficiente
                const isScrolledToBottom = messagesDiv.scrollHeight - messagesDiv.clientHeight <= messagesDiv.scrollTop + 100;
                if (isScrolledToBottom) {
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                }

                animationFrameId = requestAnimationFrame(type);
            } else {
                if (onComplete) onComplete();
            }
        }

        animationFrameId = requestAnimationFrame(type);
    }

    function removeLastMessageIfTyping() {
        const typingMessage = messagesDiv.querySelector('.message.typing');
        if (typingMessage) messagesDiv.removeChild(typingMessage);
    }

    function saveMessage(sender, text, isMarkdown) {
        if (!currentChatID) return;
        const history = JSON.parse(localStorage.getItem(currentChatID)) || [];
        history.push({ sender, text, isMarkdown });
        localStorage.setItem(currentChatID, JSON.stringify(history));
    }

    function loadChatHistory() {
        messagesDiv.innerHTML = '';
        const history = JSON.parse(localStorage.getItem(currentChatID)) || [];
        history.forEach(msg => {
            const messageClass = msg.sender === 'Você' ? 'user-message' :
                (msg.sender === 'Sistema' ? 'system-message' : 'assistant-message');
            addMessage(msg.sender, msg.text, messageClass, msg.isMarkdown, false);
        });
        localStorage.setItem('currentChatID', currentChatID);
        loadChatList();
    }

// ============================================
// UI E TEMAS
// ============================================
    function toggleSidebar() {
        document.body.classList.toggle('sidebar-hidden');
        localStorage.setItem('sidebar', document.body.classList.contains('sidebar-hidden') ? 'hidden' : 'visible');
    }

    function toggleTheme() {
        document.body.classList.toggle('dark-mode');
        const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
        localStorage.setItem('theme', theme);
        const themeIcon = document.querySelector('#toggle-theme i');
        themeIcon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }

    function loadUserTheme() {
        const theme = localStorage.getItem('theme') || 'dark';
        const themeIcon = document.querySelector('#toggle-theme i');
        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
            themeIcon.className = 'fas fa-sun';
        } else {
            themeIcon.className = 'fas fa-moon';
        }
    }

// ============================================
// NOTIFICAÇÕES
// ============================================
    function showNotification(message, type = 'info', duration = 2000) {
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

// ============================================
// MOBILE E RESPONSIVIDADE
// ============================================
    function setupMobileInteractions() {
        if (window.innerWidth <= 768) {
            document.addEventListener('click', (e) => {
                const sidebar = document.getElementById('sidebar');
                const toggleBtn = document.getElementById('toggle-sidebar-hidden');

                if (!document.body.classList.contains('sidebar-hidden') &&
                    !sidebar.contains(e.target) &&
                    !toggleBtn.contains(e.target)) {
                    document.body.classList.add('sidebar-hidden');
                    localStorage.setItem('sidebar', 'hidden');
                }
            });
        }

        let lastTouchEnd = 0;
        document.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, false);

        if ('ontouchstart' in window) {
            messagesDiv.style.scrollBehavior = 'smooth';
        }
    }

    function handleOrientationChange() {
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                scrollToBottom();
                adjustTextareaHeight();
            }, 300);
        });
    }

    function adjustTextareaHeight() {
        const maxHeight = window.innerHeight * 0.3;
        userInput.style.maxHeight = `${maxHeight}px`;
    }

    function setupTouchOptimizations() {
        messagesDiv.style.webkitOverflowScrolling = 'touch';
        document.body.style.overscrollBehavior = 'contain';
    }

    function autoResizeTextarea() {
        this.style.height = 'auto';
        const maxHeight = window.innerWidth <= 768 ?
            window.innerHeight * 0.25 : 200;
        this.style.height = `${Math.min(this.scrollHeight, maxHeight)}px`;
    }

// ============================================
// BOTÕES DE COPIAR CÓDIGO
// ============================================
    function addCopyButtonsToCode() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        const preElements = node.querySelectorAll('pre');
                        preElements.forEach(pre => {
                            if (!pre.closest('.code-block-wrapper')) {
                                addCopyButton(pre);
                            }
                        });
                    }
                });
            });
        });

        observer.observe(messagesDiv, {
            childList: true,
            subtree: true
        });

        document.querySelectorAll('pre').forEach(pre => {
            if (!pre.closest('.code-block-wrapper')) {
                addCopyButton(pre);
            }
        });
    }

    function addCopyButton(preElement) {
        if (preElement.querySelector('.copy-button') || preElement.closest('.code-block-wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        preElement.parentNode.insertBefore(wrapper, preElement);
        wrapper.appendChild(preElement);

        const button = document.createElement('button');
        button.className = 'copy-button';
        button.innerHTML = '<i class="fas fa-copy"></i>';
        button.setAttribute('aria-label', 'Copiar código');

        button.onclick = async () => {
            const code = preElement.querySelector('code')?.textContent || preElement.textContent;
            try {
                await navigator.clipboard.writeText(code);
                button.innerHTML = '<i class="fas fa-check"></i>';
                button.classList.add('copied');
                setTimeout(() => {
                    button.innerHTML = '<i class="fas fa-copy"></i>';
                    button.classList.remove('copied');
                }, 2000);
            } catch (err) {
                console.error('Erro ao copiar:', err);
                button.innerHTML = '<i class="fas fa-times"></i>';
                button.classList.add('error');
                setTimeout(() => {
                    button.innerHTML = '<i class="fas fa-copy"></i>';
                    button.classList.remove('error');
                }, 2000);
            }
        };

        wrapper.appendChild(button);
    }

// ============================================
// INICIALIZA APLICAÇÃO
// ============================================
    initialize();
});

