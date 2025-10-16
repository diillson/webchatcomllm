package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
		maxTokens = catalog.GetMaxTokens(catalog.ProviderOpenAI, c.model)
	}

	var messages []map[string]string
	for _, msg := range history {
		messages = append(messages, map[string]string{"role": msg.Role, "content": msg.Content})
	}
	messages = append(messages, map[string]string{"role": "user", "content": prompt})

	payload := map[string]interface{}{
		"model":    c.model,
		"messages": messages,
	}

	jsonValue, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("erro ao serializar payload: %w", err)
	}

	responseText, err := utils.Retry(ctx, c.logger, c.maxAttempts, c.backoff, func(ctx context.Context) (string, error) {
		req, err := http.NewRequestWithContext(ctx, "POST", config.OpenAIAPIURL, utils.NewJSONReader(jsonValue))
		if err != nil {
			return "", fmt.Errorf("erro ao criar requisição: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+c.apiKey)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return "", err
		}
		return parseOpenAIResponse(resp)
	})

	return responseText, err
}

func parseOpenAIResponse(resp *http.Response) (string, error) {
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("erro ao ler resposta: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", &utils.APIError{StatusCode: resp.StatusCode, Message: string(body)}
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("erro ao decodificar resposta: %w", err)
	}

	if len(result.Choices) == 0 {
		return "", fmt.Errorf("nenhuma resposta recebida da OpenAI")
	}

	return result.Choices[0].Message.Content, nil
}
