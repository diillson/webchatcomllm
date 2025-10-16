package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/webchatcomllm/config"
	"github.com/webchatcomllm/llm/catalog"
	"github.com/webchatcomllm/models"
	"github.com/webchatcomllm/utils"
	"go.uber.org/zap"
)

type Client struct {
	apiKey      string
	model       string
	logger      *zap.Logger
	httpClient  *http.Client
	maxAttempts int
	backoff     time.Duration
}

func NewClient(apiKey, model string, logger *zap.Logger, maxAttempts int, backoff time.Duration) *Client {
	return &Client{
		apiKey:      apiKey,
		model:       model,
		logger:      logger,
		httpClient:  utils.NewHTTPClient(logger, 90*time.Second),
		maxAttempts: maxAttempts,
		backoff:     backoff,
	}
}

func (c *Client) GetModelName() string {
	return c.model
}

func (c *Client) SendPrompt(ctx context.Context, prompt string, history []models.Message, maxTokens int) (string, error) {
	if maxTokens <= 0 {
		maxTokens = catalog.GetMaxTokens(catalog.ProviderClaude, c.model)
	}

	messages := buildMessages(prompt, history)

	reqBody := map[string]interface{}{
		"model":      c.model,
		"messages":   messages,
		"max_tokens": maxTokens,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("erro ao serializar request: %w", err)
	}

	responseText, err := utils.Retry(ctx, c.logger, c.maxAttempts, c.backoff, func(ctx context.Context) (string, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, config.ClaudeAPIURL, utils.NewJSONReader(jsonData))
		if err != nil {
			return "", fmt.Errorf("erro ao criar requisição: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", c.apiKey)
		req.Header.Set("anthropic-version", config.ClaudeAPIVersion)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return "", err
		}
		return parseClaudeResponse(resp)
	})

	return responseText, err
}

func buildMessages(prompt string, history []models.Message) []map[string]string {
	var messages []map[string]string
	for _, msg := range history {
		role := "user"
		if msg.Role == "assistant" {
			role = "assistant"
		}
		messages = append(messages, map[string]string{"role": role, "content": msg.Content})
	}
	messages = append(messages, map[string]string{"role": "user", "content": prompt})
	return messages
}

func parseClaudeResponse(resp *http.Response) (string, error) {
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("erro ao ler resposta: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", &utils.APIError{StatusCode: resp.StatusCode, Message: string(body)}
	}

	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("erro ao decodificar resposta: %w", err)
	}

	var responseText strings.Builder
	for _, content := range result.Content {
		if content.Type == "text" {
			responseText.WriteString(content.Text)
		}
	}

	if responseText.Len() == 0 {
		return "", fmt.Errorf("resposta vazia da API")
	}

	return responseText.String(), nil
}
