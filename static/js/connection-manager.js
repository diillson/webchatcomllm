/**
 * Gerenciador de Conexão Robusto
 * Mantém conexão estável com reconexão automática
 */

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
        // VALIDAÇÃO ANTES DE ADICIONAR À FILA
        if (this.state !== 'connected') {
            console.warn('⚠️ Não conectado, adicionando à fila');

            // VALIDA SE TEM PROVIDER ANTES DE ENFILEIRAR
            if (data.provider) {
                this.messageQueue.push(data);
                console.log('📦 Mensagem adicionada à fila:', {
                    provider: data.provider,
                    prompt_length: data.prompt?.length || 0,
                    queue_size: this.messageQueue.length
                });
            } else {
                console.error('❌ Tentativa de enfileirar mensagem sem provider!', data);
            }
            return false;
        }

        try {
            const jsonString = JSON.stringify(data);

            // VALIDAÇÃO FINAL DO JSON
            if (!jsonString.includes('"provider"')) {
                console.error('❌ CRÍTICO: JSON não contém provider!', jsonString);
                return false;
            }

            this.ws.send(jsonString);
            console.log('✅ Mensagem enviada com sucesso');
            return true;
        } catch (error) {
            console.error('❌ Erro ao enviar:', error);

            // SÓ ENFILEIRA SE TIVER PROVIDER
            if (data.provider) {
                this.messageQueue.push(data);
            }
            return false;
        }
    }

    flushMessageQueue() {
        if (this.messageQueue.length === 0) return;

        console.log(`📤 Processando fila: ${this.messageQueue.length} mensagem(ns)`);

        // VALIDA CADA MENSAGEM ANTES DE REENVIAR
        const validMessages = this.messageQueue.filter(msg => {
            if (!msg.provider) {
                console.error('❌ Mensagem na fila sem provider, descartando:', msg);
                return false;
            }
            return true;
        });

        // Limpa fila original
        this.messageQueue = [];

        // Reenvia apenas mensagens válidas
        validMessages.forEach((message, index) => {
            console.log(`📨 Reenviando ${index + 1}/${validMessages.length}:`, {
                provider: message.provider,
                model: message.model
            });

            if (!this.send(message)) {
                // Se falhar, recoloca na fila
                this.messageQueue.push(message);
            }
        });

        if (this.messageQueue.length > 0) {
            console.warn(`⚠️ ${this.messageQueue.length} mensagem(ns) ainda na fila`);
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

// Exporta para uso global
window.ConnectionManager = ConnectionManager;