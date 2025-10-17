document.addEventListener('DOMContentLoaded', () => {
    // === DETECÇÃO DE BROWSER PARA WEBSOCKET ===
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

    // --- Estado da Aplicação ---
    let currentChatID = null;
    let ws = null;
    let isConnected = false;
    let assistantName = "Assistente";
    let attachedFiles = [];
    let processingFiles = false;

    // Tipos de arquivo suportados
    const SUPPORTED_TYPES = {
        // Imagens
        image: {
            extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'],
            mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml'],
            maxSize: 10 * 1024 * 1024, // 10MB
            icon: '🖼️',
            color: '#4CAF50'
        },
        // PDFs
        pdf: {
            extensions: ['.pdf'],
            mimeTypes: ['application/pdf'],
            maxSize: 25 * 1024 * 1024, // 25MB
            icon: '📕',
            color: '#F44336'
        },
        // Documentos Office
        docx: {
            extensions: ['.docx'],
            mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
            maxSize: 15 * 1024 * 1024, // 15MB
            icon: '📘',
            color: '#2196F3'
        },
        xlsx: {
            extensions: ['.xlsx'],
            mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
            maxSize: 15 * 1024 * 1024, // 15MB
            icon: '📊',
            color: '#4CAF50'
        },
        // Código e texto
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

    const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB
    const MAX_FILES = 50;

    function initialize() {
        loadUserTheme();
        loadChatList();
        const storedCurrentChat = localStorage.getItem('currentChatID');
        currentChatID = (storedCurrentChat && isChatExists(storedCurrentChat)) ? storedCurrentChat : createNewChat();

        loadChatHistory();
        updateAssistantName();
        connectWebSocket();
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

    function addEventListeners() {
        chatForm.addEventListener('submit', handleFormSubmit);
        userInput.addEventListener('input', autoResizeTextarea);
        llmProviderSelect.addEventListener('change', updateAssistantName);
        newChatButton.addEventListener('click', handleNewChat);
        toggleThemeButton.addEventListener('click', toggleTheme);
        toggleSidebarButton.addEventListener('click', toggleSidebar);
        toggleSidebarHiddenButton.addEventListener('click', toggleSidebar);

        uploadFileButton.addEventListener('click', () => fileInput.click());
        uploadFolderButton.addEventListener('click', () => folderInput.click());

        fileInput.addEventListener('change', handleFilesSelected);
        folderInput.addEventListener('change', handleFilesSelected);

        clearHistoryButton.addEventListener('click', clearCurrentChatHistory);

        // Drag and drop
        setupDragAndDrop();
    }

    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsURL = `${protocol}//${window.location.host}/ws`;

        console.log('🔌 Tentando conectar WebSocket:', wsURL);

        // CORREÇÃO: Configuração específica por browser
        if (browser === 'firefox') {
            // Firefox precisa de configurações específicas
            ws = new WebSocket(wsURL, ['chat']);
        } else {
            ws = new WebSocket(wsURL);
        }

        ws.onopen = () => {
            isConnected = true;
            console.log('✅ WebSocket conectado com sucesso');
            updateConnectionStatus(true);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (error) {
                console.error('❌ Erro ao processar mensagem:', error);
            }
        };

        ws.onclose = (event) => {
            isConnected = false;
            console.log('🔌 WebSocket desconectado. Código:', event.code, 'Razão:', event.reason);
            updateConnectionStatus(false);

            // Reconecta após 3 segundos
            setTimeout(() => {
                console.log('🔄 Tentando reconectar...');
                connectWebSocket();
            }, 3000);
        };

        ws.onerror = (error) => {
            console.error('❌ Erro no WebSocket:', error);
            updateConnectionStatus(false);
        };
    }

    function handleServerMessage(data) {
        // Remove mensagem de "pensando" se houver
        removeLastMessageIfTyping();

        if (data.status === 'completed') {
            const isMarkdown = data.isMarkdown !== undefined ? data.isMarkdown : true;

            console.log('Mensagem recebida:', {
                provider: data.provider,
                isMarkdown: isMarkdown,
                length: data.response.length,
                preview: data.response.substring(0, 100)
            });

            addMessageWithTypingEffect(assistantName, data.response, 'assistant-message', isMarkdown, true);
        } else if (data.status === 'error') {
            addMessage('Erro', data.response, 'error-message', false, false);
        } else if (data.status === 'processing') {
            // Atualiza progresso
            updateProcessingProgress(data);
        }
    }

    function updateProcessingProgress(data) {
        const progressMessage = messagesDiv.querySelector('.progress-message');

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
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'system-message', 'progress-message');

        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');
        contentElement.innerHTML = `
                <strong>Sistema:</strong>
                <div class="progress-container">
                    <div class="progress-text">${message}</div>
                    <div class="progress-bar">
                        <div class="progress-bar-fill" style="width: ${percentage}%"></div>
                    </div>
                </div>
            `;

        messageElement.appendChild(contentElement);
        messagesDiv.appendChild(messageElement);
        scrollToBottom();
    }

    function removeProgressMessage() {
        const progressMessage = messagesDiv.querySelector('.progress-message');
        if (progressMessage) {
            progressMessage.remove();
        }
    }

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
            addMessage('Sistema',
                `✅ ${processedFiles.length} arquivo(s) anexado(s) com sucesso (${formatSize(totalSize)})`,
                'system-message', false, false);

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
                // Atualiza progresso
                const percentage = Math.round(((i + 1) / files.length) * 100);
                updateProcessingProgress({
                    message: `Processando ${i + 1}/${files.length}: ${file.name}`,
                    percentage: percentage
                });

                // Valida tipo de arquivo
                const fileInfo = getFileInfo(file);
                if (!fileInfo) {
                    errors.push(`${file.name}: tipo de arquivo não suportado`);
                    continue;
                }

                // Valida tamanho individual
                if (file.size > fileInfo.maxSize) {
                    errors.push(`${file.name}: excede ${formatSize(fileInfo.maxSize)}`);
                    continue;
                }

                // Valida tamanho total
                if (totalSize + file.size > MAX_TOTAL_SIZE) {
                    errors.push(`${file.name}: limite total de ${formatSize(MAX_TOTAL_SIZE)} atingido`);
                    continue;
                }

                // Processa arquivo
                const processedFile = await processFile(file, fileInfo);
                processed.push(processedFile);
                totalSize += file.size;

            } catch (error) {
                errors.push(`${file.name}: ${error.message}`);
            }
        }

        // Mostra erros se houver
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

        // Se for texto genérico
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

                // Para imagens e binários, remove o prefixo data:
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

            // Escolhe o método de leitura apropriado
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

        // Header do preview
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

        // Lista de arquivos
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

    function handleFormSubmit(e) {
        e.preventDefault();
        const message = userInput.value.trim();
        if (!message && attachedFiles.length === 0) return;
        if (!isConnected) {
            addMessage('Erro', 'Conexão perdida. Tentando reconectar...', 'error-message', false, false);
            return;
        }

        if (message) addMessage('Você', message, 'user-message', false, true);

        if (attachedFiles.length > 0) {
            const totalSize = attachedFiles.reduce((sum, f) => sum + f.size, 0);
            addMessage('Sistema',
                `📎 Enviando ${attachedFiles.length} arquivo(s) (${formatSize(totalSize)}) para análise...`,
                'system-message', false, false);
        }

        sendMessageToServer(message);

        userInput.value = '';
        userInput.style.height = 'auto';
        attachedFiles = [];
        updateFilePreview();
    }

    function sendMessageToServer(message) {
        const history = getConversationHistory();
        const selectedOption = llmProviderSelect.options[llmProviderSelect.selectedIndex];
        const provider = selectedOption.value;
        const model = selectedOption.dataset.model || "";

        const payload = {
            provider,
            model,
            prompt: message,
            history,
            files: attachedFiles
        };

        ws.send(JSON.stringify(payload));
        addMessage(assistantName, '', 'assistant-message', false, false, true);
    }

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

    function updateAssistantName() {
        assistantName = llmProviderSelect.options[llmProviderSelect.selectedIndex].text;
    }

    function updateConnectionStatus(connected) {
        const existingStatus = document.querySelector('.connection-status');
        if (existingStatus) existingStatus.remove();

        if (!connected) {
            const statusDiv = document.createElement('div');
            statusDiv.className = 'connection-status offline';
            statusDiv.innerHTML = '<i class="fas fa-exclamation-circle"></i> Desconectado';
            document.querySelector('.top-bar').appendChild(statusDiv);
        }
    }

    function scrollToBottom(behavior = 'smooth') {
        requestAnimationFrame(() => {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });
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

    function addMessageWithTypingEffect(sender, text, messageClass, isMarkdown, save) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', messageClass);
        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');
        contentElement.innerHTML = `<strong>${sender}:</strong> <span class="typing-content"></span>`;

        messageElement.appendChild(contentElement);
        messagesDiv.appendChild(messageElement);
        scrollToBottom();

        const typingContainer = contentElement.querySelector('.typing-content');

        if (isMarkdown) {
            typeWriterMarkdown(typingContainer, text, () => {
                typingContainer.classList.add('complete');
                if (save) saveMessage(sender, text, isMarkdown);
                contentElement.querySelectorAll('pre code').forEach(block => {
                    hljs.highlightElement(block);
                });
                contentElement.querySelectorAll('pre').forEach(pre => {
                    if (!pre.closest('.code-block-wrapper')) {
                        addCopyButton(pre);
                    }
                });
            });
        } else {
            typeWriterPlainText(typingContainer, text, () => {
                typingContainer.classList.add('complete');
                if (save) saveMessage(sender, text, isMarkdown);
            });
        }
    }

    function typeWriterPlainText(container, text, onComplete) {
        let i = 0;
        const speed = 10;

        function type() {
            if (i < text.length) {
                container.textContent += text.charAt(i);
                i++;
                scrollToBottom();
                setTimeout(type, speed);
            } else {
                if (onComplete) onComplete();
            }
        }
        type();
    }

    function typeWriterMarkdown(container, markdown, onComplete) {
        const lines = markdown.split('\n');
        let currentLine = 0;
        let currentChar = 0;
        let inCodeBlock = false;
        let codeBlockContent = '';
        let codeBlockLanguage = '';
        let accumulatedContent = '';

        function typeNextChar() {
            if (currentLine >= lines.length) {
                const finalHtml = DOMPurify.sanitize(marked.parse(accumulatedContent));
                container.innerHTML = finalHtml;
                if (onComplete) onComplete();
                return;
            }

            const line = lines[currentLine];

            if (line.startsWith('```')) {
                if (!inCodeBlock) {
                    inCodeBlock = true;
                    codeBlockLanguage = line.substring(3).trim();
                    codeBlockContent = '';
                } else {
                    inCodeBlock = false;
                    accumulatedContent += '```' + codeBlockLanguage + '\n' + codeBlockContent + '\n```\n';
                    codeBlockContent = '';
                    codeBlockLanguage = '';
                    currentLine++;
                    currentChar = 0;
                    renderCurrentContent();
                    setTimeout(typeNextChar, 50);
                    return;
                }
                currentLine++;
                currentChar = 0;
                setTimeout(typeNextChar, 20);
                return;
            }

            if (inCodeBlock) {
                codeBlockContent += line + '\n';
                currentLine++;
                currentChar = 0;
                setTimeout(typeNextChar, 20);
                return;
            }

            if (currentChar < line.length) {
                accumulatedContent += line.charAt(currentChar);
                currentChar++;
                renderCurrentContent();
                setTimeout(typeNextChar, 5);
            } else {
                accumulatedContent += '\n';
                currentLine++;
                currentChar = 0;
                renderCurrentContent();
                setTimeout(typeNextChar, 20);
            }
        }

        function renderCurrentContent() {
            const html = DOMPurify.sanitize(marked.parse(accumulatedContent));
            container.innerHTML = html;
            scrollToBottom();
        }

        typeNextChar();
    }

    function removeLastMessageIfTyping() {
        const typingMessage = messagesDiv.querySelector('.message.typing');
        if (typingMessage) messagesDiv.removeChild(typingMessage);

        // Remove também mensagens de progresso
        removeProgressMessage();
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
            const messageClass = msg.sender === 'Você' ? 'user-message' : (msg.sender === 'Sistema' ? 'system-message' : 'assistant-message');
            addMessage(msg.sender, msg.text, messageClass, msg.isMarkdown, false);
        });
        localStorage.setItem('currentChatID', currentChatID);
        loadChatList();
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
            const code = preElement.querySelector('code').textContent;
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

    initialize();
});