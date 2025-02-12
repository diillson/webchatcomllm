package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/webchatcomllm/models"
	"go.uber.org/zap"
	"io"
	"net/http"
	"time"
)

type ClaudeAIClient struct {
	apiKey string
	model  string
	logger *zap.Logger
	client *http.Client
}

func NewClaudeAIClient(apiKey, model string, logger *zap.Logger) *ClaudeAIClient {
	return &ClaudeAIClient{
		apiKey: apiKey,
		model:  model,
		logger: logger,
		client: &http.Client{
			Timeout: time.Second * 30,
		},
	}
}

func (c *ClaudeAIClient) GetModelName() string {
	return c.model
}

func (c *ClaudeAIClient) SendPrompt(ctx context.Context, prompt string, history []models.Message) (string, error) {
	messages := c.buildMessages(prompt, history)

	reqBody := map[string]interface{}{
		"model":      c.model,
		"messages":   messages,
		"max_tokens": 8192,
		"system":     "You are a helpful AI assistant.", // Opcional: mensagem do sistema
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("erro ao serializar request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewBuffer(jsonData))
	if err != nil {
		c.logger.Error("Erro ao criar a requisição", zap.Error(err))
		return "", fmt.Errorf("erro ao criar requisição: %w", err)
	}

	// Configurar headers corretos
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("anthropic-beta", "messages-2023-12-15") // Versão mais recente da API

	resp, err := c.client.Do(req)
	if err != nil {
		c.logger.Error("Erro na requisição", zap.Error(err))
		return "", fmt.Errorf("erro na requisição: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		c.logger.Error("Erro na resposta da API",
			zap.Int("status", resp.StatusCode),
			zap.String("response", string(bodyBytes)))
		return "", fmt.Errorf("erro na API (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	return c.parseResponse(resp)
}

func (c *ClaudeAIClient) buildMessages(prompt string, history []models.Message) []map[string]string {
	messages := make([]map[string]string, 0, len(history)+1)

	for _, msg := range history {
		role := "user"
		if msg.Role == "assistant" {
			role = "assistant"
		}
		messages = append(messages, map[string]string{
			"role":    role,
			"content": msg.Content,
		})
	}

	messages = append(messages, map[string]string{
		"role":    "user",
		"content": prompt,
	})

	return messages
}

func (c *ClaudeAIClient) parseResponse(resp *http.Response) (string, error) {
	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("erro ao decodificar resposta: %w", err)
	}

	if result.Error != nil {
		return "", fmt.Errorf("erro da API: %s", result.Error.Message)
	}

	var responseText string
	for _, content := range result.Content {
		if content.Type == "text" {
			responseText += content.Text
		}
	}

	if responseText == "" {
		return "", fmt.Errorf("resposta vazia da API")
	}

	return responseText, nil
}
