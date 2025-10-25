package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/webchatcomllm/llm/manager"
	"github.com/webchatcomllm/utils"
	"go.uber.org/zap"
)

type ClientV2 struct {
	id            string
	managedConn   *utils.ManagedConnection
	llmManager    manager.LLMManager
	fileProcessor *utils.FileProcessor
	logger        *zap.Logger
	mu            sync.Mutex
	messageQueue  [][]byte
	lastActivity  time.Time
}

func WebSocketHandlerV2(llmManager manager.LLMManager, logger *zap.Logger) http.HandlerFunc {
	fileProcessor := utils.NewFileProcessor(logger)
	clientRegistry := &sync.Map{}

	return func(w http.ResponseWriter, r *http.Request) {
		clientID := fmt.Sprintf("client_%d", time.Now().UnixNano())

		logger.Info("Nova conexão WebSocket",
			zap.String("client_id", clientID),
			zap.String("remote_addr", r.RemoteAddr),
			zap.String("user_agent", r.UserAgent()),
		)

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			logger.Error("Falha no upgrade WebSocket", zap.Error(err))
			return
		}

		config := utils.DefaultConnectionConfig()
		managedConn := utils.NewManagedConnection(logger, config)
		managedConn.SetConnection(conn)

		client := &ClientV2{
			id:            clientID,
			managedConn:   managedConn,
			llmManager:    llmManager,
			fileProcessor: fileProcessor,
			logger:        logger,
			messageQueue:  make([][]byte, 0),
			lastActivity:  time.Now(),
		}

		// Registra cliente
		clientRegistry.Store(clientID, client)
		defer clientRegistry.Delete(clientID)

		// Inicia goroutines
		go client.healthCheck()
		go client.writePump()
		client.readPump() // Bloqueia aqui
	}
}

func (c *ClientV2) healthCheck() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if time.Since(c.lastActivity) > 5*time.Minute {
				c.logger.Warn("Cliente inativo, fechando conexão",
					zap.String("client_id", c.id))
				c.managedConn.Close()
				return
			}

			if err := c.managedConn.Send([]byte(`{"type":"ping"}`)); err != nil {
				c.logger.Error("Erro ao enviar ping", zap.Error(err))
			}
		}
	}
}

func (c *ClientV2) writePump() {
	defer c.managedConn.Close()

	for {
		select {
		case message, ok := <-c.managedConn.SendQueue:
			if !ok {
				return
			}

			if err := c.writeMessage(message); err != nil {
				c.logger.Error("Erro ao escrever mensagem", zap.Error(err))

				// Adiciona à fila para reenvio
				c.mu.Lock()
				c.messageQueue = append(c.messageQueue, message)
				c.mu.Unlock()

				return
			}
		}
	}
}

func (c *ClientV2) writeMessage(data []byte) error {
	c.managedConn.Conn.SetWriteDeadline(time.Now().Add(45 * time.Second))
	return c.managedConn.Conn.WriteMessage(websocket.TextMessage, data)
}

func (c *ClientV2) readPump() {
	defer c.managedConn.Close()

	for {
		_, message, err := c.managedConn.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseGoingAway,
				websocket.CloseAbnormalClosure,
				websocket.CloseNormalClosure) {
				c.logger.Error("Erro inesperado ao ler", zap.Error(err))
			}
			break
		}

		c.lastActivity = time.Now()
		c.handleMessage(message)
	}
}

func (c *ClientV2) handleMessage(payload []byte) {
	var req RequestPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		c.sendError("Payload inválido: " + err.Error())
		return
	}

	// Validações...
	if req.Provider == "" {
		c.sendError("Provedor não especificado")
		return
	}

	// Processa mensagem
	go c.processMessage(req)
}

func (c *ClientV2) processMessage(req RequestPayload) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	client, err := c.llmManager.GetClient(req.Provider, req.Model)
	if err != nil {
		c.sendError(err.Error())
		return
	}

	response, err := client.SendPrompt(ctx, req.Prompt, req.History, 0)
	if err != nil {
		c.sendError("Erro ao processar: " + err.Error())
		return
	}

	c.sendJSON(ResponsePayload{
		Status:     "completed",
		Response:   response,
		IsMarkdown: detectMarkdown(response),
		Provider:   req.Provider,
	})
}

func (c *ClientV2) sendJSON(v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		c.logger.Error("Erro ao serializar JSON", zap.Error(err))
		return
	}

	if err := c.managedConn.Send(data); err != nil {
		c.logger.Error("Erro ao enviar JSON", zap.Error(err))
	}
}

func (c *ClientV2) sendError(message string) {
	c.sendJSON(ResponsePayload{
		Status:   "error",
		Response: message,
	})
}
