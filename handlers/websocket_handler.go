package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/webchatcomllm/llm/manager"
	"github.com/webchatcomllm/models"
	"go.uber.org/zap"
)

const (
	MaxFileSize        = 5 * 1024 * 1024
	MaxTotalUploadSize = 20 * 1024 * 1024
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type FilePayload struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

type RequestPayload struct {
	Provider string           `json:"provider"`
	Model    string           `json:"model"`
	Prompt   string           `json:"prompt"`
	History  []models.Message `json:"history"`
	Files    []FilePayload    `json:"files,omitempty"`
}

type ResponsePayload struct {
	Status     string `json:"status"`
	Response   string `json:"response"`
	IsMarkdown bool   `json:"isMarkdown"` // NOVO: indica se a resposta é Markdown
	Provider   string `json:"provider"`   // NOVO: identifica o provedor
}

func WebSocketHandler(llmManager manager.LLMManager, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			logger.Error("Erro ao fazer upgrade para WebSocket", zap.Error(err))
			return
		}
		defer conn.Close()
		logger.Info("Cliente WebSocket conectado", zap.String("remote_addr", conn.RemoteAddr().String()))

		for {
			messageType, p, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					logger.Error("Erro de fechamento inesperado do WebSocket", zap.Error(err))
				} else {
					logger.Info("Cliente WebSocket desconectado", zap.String("remote_addr", conn.RemoteAddr().String()))
				}
				break
			}
			if messageType == websocket.TextMessage {
				go handleWebSocketMessage(conn, p, llmManager, logger)
			}
		}
	}
}

func handleWebSocketMessage(conn *websocket.Conn, payload []byte, llmManager manager.LLMManager, logger *zap.Logger) {
	var req RequestPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		sendErrorResponse(conn, "Payload inválido", req.Provider)
		return
	}

	fileContext, err := processFiles(req.Files, logger)
	if err != nil {
		sendErrorResponse(conn, err.Error(), req.Provider)
		return
	}

	fullPrompt := req.Prompt
	if fileContext != "" {
		fullPrompt = fileContext + "\n\n---\n\n" + req.Prompt
	}

	client, err := llmManager.GetClient(req.Provider, req.Model)
	if err != nil {
		sendErrorResponse(conn, err.Error(), req.Provider)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	llmResponse, err := client.SendPrompt(ctx, fullPrompt, req.History, 0)
	if err != nil {
		sendErrorResponse(conn, err.Error(), req.Provider)
		return
	}

	// NOVO: Detectar se a resposta contém Markdown
	isMarkdown := detectMarkdown(llmResponse)

	// Log para debug
	logger.Info("Resposta LLM processada",
		zap.String("provider", req.Provider),
		zap.Bool("is_markdown", isMarkdown),
		zap.Int("response_length", len(llmResponse)))

	if err := conn.WriteJSON(ResponsePayload{
		Status:     "completed",
		Response:   llmResponse,
		IsMarkdown: isMarkdown,
		Provider:   req.Provider,
	}); err != nil {
		logger.Error("Erro ao enviar resposta final do LLM", zap.Error(err))
	}
}

// NOVA FUNÇÃO: Detecta se o texto contém Markdown
func detectMarkdown(text string) bool {
	// Indicadores comuns de Markdown
	markdownIndicators := []string{
		"```",         // Code blocks
		"# ",          // Headers
		"## ",         // Headers
		"### ",        // Headers
		"- ",          // Lists
		"* ",          // Lists
		"1. ",         // Ordered lists
		"**",          // Bold
		"__",          // Bold
		"*",           // Italic
		"_",           // Italic
		"[",           // Links
		"](",          // Links
		"|",           // Tables
		"---",         // Horizontal rule
		"```yaml",     // YAML blocks
		"```json",     // JSON blocks
		"```python",   // Python blocks
		"apiVersion:", // Kubernetes YAML
		"kind:",       // Kubernetes YAML
		"metadata:",   // Kubernetes YAML
	}

	for _, indicator := range markdownIndicators {
		if strings.Contains(text, indicator) {
			return true
		}
	}

	// Se tem múltiplas quebras de linha seguidas, provavelmente é formatado
	if strings.Contains(text, "\n\n") {
		return true
	}

	return false
}

func processFiles(files []FilePayload, logger *zap.Logger) (string, error) {
	if len(files) == 0 {
		return "", nil
	}
	var totalSize int64
	var contextBuilder strings.Builder
	contextBuilder.WriteString("CONTEXTO DE ARQUIVOS FORNECIDO PELO USUÁRIO:\n\n📑 ÍNDICE DE ARQUIVOS:\n")
	for i, file := range files {
		contextBuilder.WriteString(fmt.Sprintf("%d. %s (%d bytes)\n", i+1, file.Name, len(file.Content)))
	}
	contextBuilder.WriteString("\n---\n\n")
	for i, file := range files {
		fileSize := int64(len(file.Content))
		if fileSize > MaxFileSize {
			return "", fmt.Errorf("o arquivo '%s' excede o limite de %d MB", file.Name, MaxFileSize/1024/1024)
		}
		totalSize += fileSize
		if totalSize > MaxTotalUploadSize {
			return "", fmt.Errorf("o tamanho total dos arquivos excede o limite de %d MB", MaxTotalUploadSize/1024/1024)
		}
		contextBuilder.WriteString(fmt.Sprintf("📄 ARQUIVO %d/%d: %s\n```\n%s\n```\n\n", i+1, len(files), file.Name, file.Content))
	}
	logger.Info("Arquivos processados para contexto", zap.Int("n_arquivos", len(files)), zap.Int64("tamanho_total", totalSize))
	return contextBuilder.String(), nil
}

func sendErrorResponse(conn *websocket.Conn, message string, provider string) {
	_ = conn.WriteJSON(ResponsePayload{
		Status:     "error",
		Response:   message,
		IsMarkdown: false,
		Provider:   provider,
	})
}
