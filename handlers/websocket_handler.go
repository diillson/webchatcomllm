package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/webchatcomllm/llm/manager"
	"github.com/webchatcomllm/models"
	"github.com/webchatcomllm/utils"
	"go.uber.org/zap"
)

const (
	MaxFileSize        = 5 * 1024 * 1024
	MaxTotalUploadSize = 50 * 1024 * 1024
	MaxFilesPerRequest = 50

	// WebSocket timeouts otimizados para Firefox
	writeWait      = 30 * time.Second
	pongWait       = 90 * time.Second
	pingPeriod     = (pongWait * 8) / 10
	maxMessageSize = 1024 * 1024 // 1MB
)

// CORREÇÃO: Upgrader com configurações específicas para Firefox
var upgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin: func(r *http.Request) bool {
		return true // Em produção, valide o origin adequadamente
	},
	Subprotocols: []string{"chat", ""},
	// IMPORTANTE: Não força compressão (Firefox tem problemas)
	EnableCompression: false,
	// IMPORTANTE: HandshakeTimeout maior para Firefox
	HandshakeTimeout: 10 * time.Second,
}

type FilePayload struct {
	Name        string                 `json:"name"`
	Content     string                 `json:"content"`
	ContentType string                 `json:"contentType"`
	FileType    string                 `json:"fileType"`
	Size        int64                  `json:"size"`
	IsBase64    bool                   `json:"isBase64"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
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
	IsMarkdown bool   `json:"isMarkdown"`
	Provider   string `json:"provider"`
}

type ProgressPayload struct {
	Status     string `json:"status"`
	Message    string `json:"message"`
	Current    int    `json:"current,omitempty"`
	Total      int    `json:"total,omitempty"`
	Percentage int    `json:"percentage,omitempty"`
}

// Client representa uma conexão WebSocket com proteção contra race conditions
type Client struct {
	conn          *websocket.Conn
	send          chan []byte
	llmManager    manager.LLMManager
	fileProcessor *utils.FileProcessor
	logger        *zap.Logger
	mu            sync.Mutex
	closed        bool
}

func WebSocketHandler(llmManager manager.LLMManager, logger *zap.Logger) http.HandlerFunc {
	fileProcessor := utils.NewFileProcessor(logger)

	return func(w http.ResponseWriter, r *http.Request) {
		// Detecta Firefox
		userAgent := r.UserAgent()
		isFirefox := strings.Contains(strings.ToLower(userAgent), "firefox")

		logger.Info("Nova tentativa de conexão WebSocket",
			zap.String("remote_addr", r.RemoteAddr),
			zap.String("user_agent", userAgent),
			zap.String("origin", r.Header.Get("Origin")),
			zap.Bool("is_firefox", isFirefox),
		)

		// CORREÇÃO: Headers específicos para Firefox
		responseHeader := http.Header{}
		if isFirefox {
			responseHeader.Set("Access-Control-Allow-Origin", "*")
			responseHeader.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			responseHeader.Set("Access-Control-Allow-Headers", "Content-Type")
		}

		conn, err := upgrader.Upgrade(w, r, responseHeader)
		if err != nil {
			logger.Error("Erro ao fazer upgrade para WebSocket",
				zap.Error(err),
				zap.String("user_agent", userAgent),
				zap.Bool("is_firefox", isFirefox),
			)
			return
		}

		client := &Client{
			conn:          conn,
			send:          make(chan []byte, 256),
			llmManager:    llmManager,
			fileProcessor: fileProcessor,
			logger:        logger,
			closed:        false,
		}

		logger.Info("Cliente WebSocket conectado com sucesso",
			zap.String("remote_addr", conn.RemoteAddr().String()),
			zap.String("user_agent", userAgent),
			zap.Bool("is_firefox", isFirefox),
		)

		// Inicia goroutines
		go client.writePump()
		go client.readPump()
	}
}

// readPump processa mensagens recebidas
func (c *Client) readPump() {
	defer func() {
		c.close()
		c.logger.Info("Cliente desconectado (readPump)",
			zap.String("remote_addr", c.conn.RemoteAddr().String()))
	}()

	// Configurações otimizadas
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		messageType, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseGoingAway,
				websocket.CloseAbnormalClosure,
				websocket.CloseNormalClosure,
				websocket.CloseNoStatusReceived) {
				c.logger.Error("Erro inesperado ao ler mensagem", zap.Error(err))
			}
			break
		}

		if messageType == websocket.TextMessage {
			c.handleMessage(message)
		}
	}
}

// writePump envia mensagens para o cliente
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))

			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// CORREÇÃO: Tenta escrever, mas não trava se der erro
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				c.logger.Warn("Erro ao escrever mensagem (cliente pode ter desconectado)",
					zap.Error(err))
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.logger.Debug("Erro ao enviar ping (cliente pode ter desconectado)",
					zap.Error(err))
				return
			}
		}
	}
}

// close fecha a conexão de forma segura
func (c *Client) close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return
	}

	c.closed = true
	close(c.send)
	c.conn.Close()
}

// isClosed verifica se a conexão está fechada
func (c *Client) isClosed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}

// handleMessage processa uma mensagem recebida
func (c *Client) handleMessage(payload []byte) {
	var req RequestPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		c.sendError("Payload inválido: " + err.Error())
		return
	}

	// CORREÇÃO: Valida campos obrigatórios
	if req.Provider == "" {
		c.logger.Error("Provider vazio recebido",
			zap.String("payload", string(payload)),
		)
		c.sendError("Provedor LLM não especificado. Selecione um provedor e tente novamente.")
		return
	}

	if req.Prompt == "" && len(req.Files) == 0 {
		c.sendError("Mensagem vazia. Digite algo ou anexe arquivos.")
		return
	}

	c.logger.Debug("Mensagem recebida",
		zap.String("provider", req.Provider),
		zap.String("model", req.Model),
		zap.String("prompt_preview", truncate(req.Prompt, 50)),
		zap.Int("files", len(req.Files)),
		zap.Int("history_length", len(req.History)),
	)

	// Valida número de arquivos
	if len(req.Files) > MaxFilesPerRequest {
		c.sendError(fmt.Sprintf("Número máximo de arquivos excedido. Limite: %d", MaxFilesPerRequest))
		return
	}

	// Processa arquivos se houver
	fileContext := ""
	if len(req.Files) > 0 {
		var err error
		fileContext, err = processFilesAdvanced(req.Files, c.fileProcessor, c, c.logger)
		if err != nil {
			c.sendError(err.Error())
			return
		}
	}

	// Monta prompt completo
	fullPrompt := req.Prompt
	if fileContext != "" {
		fullPrompt = fileContext + "\n\n---\n\n**Pergunta do usuário:**\n" + req.Prompt
	}

	// Obtém cliente LLM
	client, err := c.llmManager.GetClient(req.Provider, req.Model)
	if err != nil {
		c.sendError(err.Error())
		return
	}

	// Envia para LLM
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	llmResponse, err := client.SendPrompt(ctx, fullPrompt, req.History, 0)
	if err != nil {
		c.sendError("Erro ao processar resposta do LLM: " + err.Error())
		return
	}

	// Detecta Markdown
	isMarkdown := detectMarkdown(llmResponse)

	c.logger.Info("Resposta LLM processada",
		zap.String("provider", req.Provider),
		zap.Bool("is_markdown", isMarkdown),
		zap.Int("response_length", len(llmResponse)),
		zap.Int("files_processed", len(req.Files)),
	)

	c.sendJSON(ResponsePayload{
		Status:     "completed",
		Response:   llmResponse,
		IsMarkdown: isMarkdown,
		Provider:   req.Provider,
	})
}

// sendJSON envia um objeto JSON para o cliente
func (c *Client) sendJSON(v interface{}) {
	if c.isClosed() {
		c.logger.Warn("Tentativa de enviar para conexão fechada")
		return
	}

	data, err := json.Marshal(v)
	if err != nil {
		c.logger.Error("Erro ao serializar JSON", zap.Error(err))
		return
	}

	select {
	case c.send <- data:
		// Sucesso
	case <-time.After(5 * time.Second):
		c.logger.Warn("Timeout ao enviar mensagem para cliente")
	}
}

// sendError envia uma mensagem de erro
func (c *Client) sendError(message string) {
	c.logger.Warn("Enviando erro para cliente", zap.String("error", message))
	c.sendJSON(ResponsePayload{
		Status:   "error",
		Response: message,
	})
}

// sendProgress envia progresso
func (c *Client) sendProgress(message string, current, total, percentage int) {
	c.sendJSON(ProgressPayload{
		Status:     "processing",
		Message:    message,
		Current:    current,
		Total:      total,
		Percentage: percentage,
	})
}

// truncate trunca uma string para debug
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func processFilesAdvanced(files []FilePayload, fp *utils.FileProcessor, c *Client, logger *zap.Logger) (string, error) {
	if len(files) == 0 {
		return "", nil
	}

	c.sendProgress("Iniciando processamento dos arquivos...", 0, len(files), 0)

	var totalSize int64
	var contextBuilder strings.Builder
	var processedFiles []utils.ProcessedFile
	var failedFiles []string

	contextBuilder.WriteString("# 📁 CONTEXTO DE ARQUIVOS FORNECIDO PELO USUÁRIO\n\n")
	contextBuilder.WriteString("## 📑 ÍNDICE DE ARQUIVOS:\n\n")

	for i, file := range files {
		percentage := ((i + 1) * 100) / len(files)
		c.sendProgress(fmt.Sprintf("Processando arquivo %d de %d: %s", i+1, len(files), file.Name), i+1, len(files), percentage)

		var content []byte
		var err error

		if file.IsBase64 {
			content, err = base64.StdEncoding.DecodeString(file.Content)
			if err != nil {
				failedFiles = append(failedFiles, fmt.Sprintf("%s (erro ao decodificar base64)", file.Name))
				logger.Warn("Erro ao decodificar base64", zap.String("file", file.Name), zap.Error(err))
				continue
			}
		} else {
			content = []byte(file.Content)
		}

		fileSize := int64(len(content))
		if fileSize > MaxFileSize && !strings.HasPrefix(file.ContentType, "image/") && file.ContentType != "application/pdf" {
			failedFiles = append(failedFiles, fmt.Sprintf("%s (tamanho excede %dMB)", file.Name, MaxFileSize/1024/1024))
			continue
		}

		totalSize += fileSize
		if totalSize > MaxTotalUploadSize {
			return "", fmt.Errorf("tamanho total dos arquivos excede o limite de %d MB", MaxTotalUploadSize/1024/1024)
		}

		processed, err := fp.ProcessFile(file.Name, content)
		if err != nil {
			failedFiles = append(failedFiles, fmt.Sprintf("%s (%s)", file.Name, err.Error()))
			logger.Warn("Erro ao processar arquivo", zap.String("file", file.Name), zap.Error(err))
			continue
		}

		processedFiles = append(processedFiles, *processed)
	}

	c.sendProgress("Gerando contexto dos arquivos...", len(files), len(files), 100)

	for i, pf := range processedFiles {
		icon := getFileIcon(pf.FileType)
		sizeStr := formatSize(pf.Size)
		contextBuilder.WriteString(fmt.Sprintf("%d. %s **%s** `%s` (%s)\n", i+1, icon, pf.Name, pf.FileType, sizeStr))
	}

	if len(failedFiles) > 0 {
		contextBuilder.WriteString("\n### ⚠️ Arquivos com falha no processamento:\n")
		for _, failed := range failedFiles {
			contextBuilder.WriteString(fmt.Sprintf("- %s\n", failed))
		}
	}

	contextBuilder.WriteString("\n---\n\n")

	for i, pf := range processedFiles {
		contextBuilder.WriteString(fmt.Sprintf("## 📄 ARQUIVO %d/%d: %s\n\n", i+1, len(processedFiles), pf.Name))

		if len(pf.Metadata) > 0 {
			contextBuilder.WriteString("**Metadados:**\n")
			for key, value := range pf.Metadata {
				contextBuilder.WriteString(fmt.Sprintf("- %s: %v\n", key, value))
			}
			contextBuilder.WriteString("\n")
		}

		switch pf.FileType {
		case utils.FileTypeImage:
			contextBuilder.WriteString(fmt.Sprintf("![%s](data:%s;base64,%s)\n\n", pf.Name, pf.ContentType, pf.Content))
			contextBuilder.WriteString("*Nota: Imagem anexada para análise visual.*\n\n")

		case utils.FileTypeCode, utils.FileTypeJSON, utils.FileTypeYAML, utils.FileTypeXML:
			lang := getLanguageFromFileType(pf.FileType, pf.Metadata)
			contextBuilder.WriteString(fmt.Sprintf("```%s\n%s\n```\n\n", lang, pf.Content))

		case utils.FileTypePDF, utils.FileTypeDocx, utils.FileTypeXlsx:
			contextBuilder.WriteString(fmt.Sprintf("```\n%s\n```\n\n", pf.Content))

		default:
			contextBuilder.WriteString(fmt.Sprintf("```\n%s\n```\n\n", pf.Content))
		}

		contextBuilder.WriteString("---\n\n")
	}

	contextBuilder.WriteString(fmt.Sprintf("\n**Resumo:** %d arquivo(s) processado(s) com sucesso, %d falha(s), tamanho total: %s\n\n",
		len(processedFiles), len(failedFiles), formatSize(totalSize)))

	logger.Info("Arquivos processados para contexto",
		zap.Int("total", len(files)),
		zap.Int("success", len(processedFiles)),
		zap.Int("failed", len(failedFiles)),
		zap.Int64("total_size", totalSize),
	)

	return contextBuilder.String(), nil
}

func detectMarkdown(text string) bool {
	markdownIndicators := []string{
		"```", "# ", "## ", "### ", "- ", "* ", "1. ",
		"**", "__", "*", "_", "[", "](", "|", "---",
		"```yaml", "```json", "```python", "apiVersion:", "kind:", "metadata:",
	}

	for _, indicator := range markdownIndicators {
		if strings.Contains(text, indicator) {
			return true
		}
	}

	return strings.Contains(text, "\n\n")
}

func getFileIcon(fileType utils.FileType) string {
	icons := map[utils.FileType]string{
		utils.FileTypeImage:    "🖼️",
		utils.FileTypePDF:      "📕",
		utils.FileTypeDocx:     "📘",
		utils.FileTypeXlsx:     "📊",
		utils.FileTypeCode:     "💻",
		utils.FileTypeJSON:     "📋",
		utils.FileTypeYAML:     "⚙️",
		utils.FileTypeXML:      "📰",
		utils.FileTypeMarkdown: "📝",
		utils.FileTypeCSV:      "📈",
		utils.FileTypeText:     "📄",
		utils.FileTypeBinary:   "📦",
	}
	if icon, ok := icons[fileType]; ok {
		return icon
	}
	return "📄"
}

func getLanguageFromFileType(fileType utils.FileType, metadata map[string]interface{}) string {
	if lang, ok := metadata["language"].(string); ok {
		return lang
	}

	switch fileType {
	case utils.FileTypeJSON:
		return "json"
	case utils.FileTypeYAML:
		return "yaml"
	case utils.FileTypeXML:
		return "xml"
	default:
		return ""
	}
}

func formatSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}
