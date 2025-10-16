document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos do DOM ---
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

        // Em mobile, iniciar com sidebar fechada
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

        // Botões de upload
        uploadFileButton.addEventListener('click', () => fileInput.click());
        uploadFolderButton.addEventListener('click', () => folderInput.click());

        fileInput.addEventListener('change', handleFilesSelected);
        folderInput.addEventListener('change', handleFilesSelected);

        clearHistoryButton.addEventListener('click', clearCurrentChatHistory);
    }

    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsURL = `${protocol}//${window.location.host}/ws`;
        ws = new WebSocket(wsURL);

        ws.onopen = () => { isConnected = true; console.log('WebSocket conectado.'); };
        ws.onmessage = (event) => handleServerMessage(JSON.parse(event.data));
        ws.onclose = () => { isConnected = false; console.log('WebSocket desconectado. Reconectando...'); setTimeout(connectWebSocket, 3000); };
        ws.onerror = (error) => { console.error('Erro no WebSocket:', error); ws.close(); };
    }

    function handleServerMessage(data) {
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
            const totalSize = attachedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
            addMessage('Sistema', `Enviando ${attachedFiles.length} arquivo(s) (${(totalSize / 1024).toFixed(2)}KB) para análise...`, 'system-message', false, false);
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

        ws.send(JSON.stringify({ provider, model, prompt: message, history, files: attachedFiles }));
        addMessage(assistantName, '', 'assistant-message', false, false, true);
    }

    async function handleFilesSelected(event) {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;

        addMessage('Sistema', `Processando ${files.length} arquivo(s)...`, 'system-message', false, false);

        attachedFiles = [];
        const maxFileSize = 5 * 1024 * 1024;
        const maxTotalSize = 20 * 1024 * 1024;
        let totalSize = 0;
        let skippedFiles = [];

        const filePromises = files.map(file =>
            new Promise((resolve, reject) => {
                if (file.size > maxFileSize) {
                    skippedFiles.push(`${file.name} (muito grande: ${(file.size / 1024 / 1024).toFixed(2)}MB)`);
                    resolve();
                    return;
                }

                if (totalSize + file.size > maxTotalSize) {
                    skippedFiles.push(`${file.name} (limite total atingido)`);
                    resolve();
                    return;
                }

                const reader = new FileReader();
                reader.onload = e => {
                    const relativePath = file.webkitRelativePath || file.name;
                    attachedFiles.push({
                        name: relativePath,
                        content: e.target.result,
                        size: file.size
                    });
                    totalSize += file.size;
                    resolve();
                };
                reader.onerror = () => reject(new Error(`Erro ao ler ${file.name}`));
                reader.readAsText(file);
            })
        );

        try {
            await Promise.all(filePromises);
            removeLastMessageIfSystem();

            if (skippedFiles.length > 0) {
                addMessage('Aviso',
                    `Arquivos ignorados:\n${skippedFiles.join('\n')}`,
                    'system-message', false, false);
            }

            if (attachedFiles.length > 0) {
                addMessage('Sistema',
                    `${attachedFiles.length} arquivo(s) anexado(s) (${(totalSize / 1024).toFixed(2)}KB)`,
                    'system-message', false, false);
                updateFilePreview();
            } else {
                addMessage('Erro',
                    'Nenhum arquivo válido foi selecionado.',
                    'error-message', false, false);
            }
        } catch (error) {
            removeLastMessageIfSystem();
            addMessage('Erro', error.message, 'error-message', false, false);
        }
        fileInput.value = '';
        folderInput.value = '';
    }

    function updateFilePreview() {
        filePreviewContainer.innerHTML = '';
        if (attachedFiles.length === 0) {
            filePreviewContainer.style.display = 'none';
            return;
        }

        filePreviewContainer.style.display = 'block';

        const totalSize = attachedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
        const summary = document.createElement('div');
        summary.style.cssText = 'font-size: 11px; color: #999; margin-bottom: 5px; padding: 5px;';
        summary.textContent = `${attachedFiles.length} arquivo(s) - ${(totalSize / 1024).toFixed(2)}KB total`;
        filePreviewContainer.appendChild(summary);

        const fileList = document.createElement('ul');
        fileList.style.maxHeight = '150px';
        fileList.style.overflowY = 'auto';

        attachedFiles.forEach((file, index) => {
            const listItem = document.createElement('li');
            const fileSize = file.size ? ` (${(file.size / 1024).toFixed(1)}KB)` : '';
            listItem.innerHTML = `
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" 
                          title="${file.name}">
                        ${file.name}${fileSize}
                    </span>
                `;

            const removeButton = document.createElement('button');
            removeButton.innerHTML = '&times;';
            removeButton.title = 'Remover arquivo';
            removeButton.onclick = () => {
                attachedFiles.splice(index, 1);
                updateFilePreview();
            };
            listItem.appendChild(removeButton);
            fileList.appendChild(listItem);
        });
        filePreviewContainer.appendChild(fileList);
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
                cleanHtml = DOMPurify.sanitize(text.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
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
    }

    function removeLastMessageIfSystem() {
        const messages = messagesDiv.querySelectorAll('.message.system-message');
        if (messages.length > 0) {
            const lastSystem = messages[messages.length - 1];
            if (lastSystem.textContent.includes('Processando')) {
                messagesDiv.removeChild(lastSystem);
            }
        }
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