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
    const fileInput = document.getElementById('file-input');
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
        uploadFileButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFilesSelected);
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
            addMessageWithTypingEffect(assistantName, data.response, 'assistant-message', true, true);
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
        if (attachedFiles.length > 0) addMessage('Sistema', `Enviando ${attachedFiles.length} arquivo(s) para análise...`, 'system-message', false, false);

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

        attachedFiles = [];
        updateFilePreview();

        const filePromises = files.map(file =>
            new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => {
                    attachedFiles.push({ name: file.webkitRelativePath || file.name, content: e.target.result });
                    resolve();
                };
                reader.onerror = () => reject(new Error(`Erro ao ler o arquivo ${file.name}`));
                reader.readAsText(file);
            })
        );

        try {
            await Promise.all(filePromises);
            updateFilePreview();
        } catch (error) {
            addMessage('Erro', error.message, 'error-message', false, false);
        }
        fileInput.value = '';
    }

    function updateFilePreview() {
        filePreviewContainer.innerHTML = '';
        if (attachedFiles.length === 0) {
            filePreviewContainer.style.display = 'none';
            return;
        }

        filePreviewContainer.style.display = 'block';
        const fileList = document.createElement('ul');
        attachedFiles.forEach((file, index) => {
            const listItem = document.createElement('li');
            listItem.textContent = file.name;
            const removeButton = document.createElement('button');
            removeButton.innerHTML = '&times;';
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

    function addMessage(sender, text, messageClass, isMarkdown = false, save = false, isTyping = false) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', messageClass);
        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');

        if (isTyping) {
            contentElement.innerHTML = `<strong>${sender}:</strong> <span class="typing-indicator"><span></span><span></span><span></span></span>`;
            messageElement.classList.add('typing');
        } else {
            const cleanHtml = isMarkdown ? DOMPurify.sanitize(marked.parse(text)) : DOMPurify.sanitize(text.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
            contentElement.innerHTML = `<strong>${sender}:</strong> ${cleanHtml}`;
        }

        messageElement.appendChild(contentElement);
        messagesDiv.appendChild(messageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        if (save) saveMessage(sender, text, isMarkdown);
        if (isMarkdown && !isTyping) {
            messageElement.querySelectorAll('pre code').forEach(hljs.highlightElement);
        }
        return contentElement;
    }

    function addMessageWithTypingEffect(sender, text, messageClass, isMarkdown, save) {
        const contentElement = addMessage(sender, '', messageClass, isMarkdown, false, false);
        typeWriterEffect(contentElement, sender, text, isMarkdown, () => {
            if (save) saveMessage(sender, text, isMarkdown);
            contentElement.querySelectorAll('pre code').forEach(hljs.highlightElement);
        });
    }

    function typeWriterEffect(element, sender, text, isMarkdown, onComplete) {
        let i = 0;
        const speed = 5; // Mais rápido

        element.innerHTML = `<strong>${sender}:</strong> `;
        const textContainer = document.createElement('span');
        element.appendChild(textContainer);

        function type() {
            if (i < text.length) {
                const char = text.charAt(i);
                i++;
                textContainer.textContent += char;
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
                setTimeout(type, speed);
            } else {
                // Ao final, renderiza o Markdown completo de uma vez para garantir a formatação correta
                const finalHtml = isMarkdown ? DOMPurify.sanitize(marked.parse(text)) : DOMPurify.sanitize(text);
                element.innerHTML = `<strong>${sender}:</strong> ${finalHtml}`;
                if (onComplete) onComplete();
            }
        }
        type();
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
        // Fechar sidebar ao clicar no overlay (mobile)
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

        // Prevenir zoom duplo no iOS
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, false);

        // Auto-scroll mais suave em mobile
        if ('ontouchstart' in window) {
            messagesDiv.style.scrollBehavior = 'smooth';
        }
    }

    function handleOrientationChange() {
        // Ajustar layout quando o dispositivo roda
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
                adjustTextareaHeight();
            }, 300);
        });
    }

    function adjustTextareaHeight() {
        const maxHeight = window.innerHeight * 0.3; // 30% da altura da tela
        userInput.style.maxHeight = `${maxHeight}px`;
    }

    function setupTouchOptimizations() {
        // Melhorar performance de scroll em mobile
        messagesDiv.style.webkitOverflowScrolling = 'touch';

        // Prevenir pull-to-refresh em alguns navegadores
        document.body.style.overscrollBehavior = 'contain';
    }

    // Atualizar a função autoResizeTextarea
    function autoResizeTextarea() {
        this.style.height = 'auto';
        const maxHeight = window.innerWidth <= 768 ?
            window.innerHeight * 0.25 : 200;
        this.style.height = `${Math.min(this.scrollHeight, maxHeight)}px`;
    }

    initialize();
});