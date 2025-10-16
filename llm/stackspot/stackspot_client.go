package stackspot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/webchatcomllm/config"
	"github.com/webchatcomllm/llm/token"
	"github.com/webchatcomllm/models"
	"github.com/webchatcomllm/utils"
	"go.uber.org/zap"
)

type Client struct {
	tokenManager token.Manager
	agentID      string
	logger       *zap.Logger
	httpClient   *http.Client
	maxAttempts  int
	backoff      time.Duration
}

func NewClient(tm token.Manager, agentID string, logger *zap.Logger, maxAttempts int, backoff time.Duration) *Client {
	return &Client{
		tokenManager: tm,
		agentID:      agentID,
		logger:       logger,
		httpClient:   utils.NewHTTPClient(logger, 90*time.Second),
		maxAttempts:  maxAttempts,
		backoff:      backoff,
	}
}

func (c *Client) GetModelName() string {
	return "GPT-5" // Nome de exibição para o frontend
}

func (c *Client) SendPrompt(ctx context.Context, prompt string, history []models.Message, maxTokens int) (string, error) {
	var conversationBuilder strings.Builder
	for _, msg := range history {
		role := "Usuário"
		if msg.Role == "assistant" {
			role = "Assistente"
		}
		conversationBuilder.WriteString(fmt.Sprintf("%s: %s\n", role, msg.Content))
	}
	fullPrompt := conversationBuilder.String() + "Usuário: " + prompt

	llmResponse, err := utils.Retry(ctx, c.logger, c.maxAttempts, c.backoff, func(ctx context.Context) (string, error) {
		return c.executeWithTokenRetry(ctx, func(token string) (string, error) {
			return c.sendChatRequest(ctx, fullPrompt, token)
		})
	})

	return llmResponse, err
}

func (c *Client) executeWithTokenRetry(ctx context.Context, requestFunc func(string) (string, error)) (string, error) {
	token, err := c.tokenManager.GetAccessToken(ctx)
	if err != nil {
		return "", fmt.Errorf("erro ao obter o token: %w", err)
	}

	response, err := requestFunc(token)
	if err != nil {
		var apiErr *utils.APIError
		if errors.As(err, &apiErr) && (apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden) {
			c.logger.Info("Token inválido ou expirado, renovando...")
			newToken, tokenErr := c.tokenManager.RefreshToken(ctx)
			if tokenErr != nil {
				return "", fmt.Errorf("erro ao renovar o token: %w", tokenErr)
			}
			return requestFunc(newToken)
		}
		return "", err
	}
	return response, nil
}

func (c *Client) sendChatRequest(ctx context.Context, prompt, accessToken string) (string, error) {
	url := fmt.Sprintf("%s/agent/%s/chat", config.StackSpotBaseURL, c.agentID)

	// CORREÇÃO: Adicionados os campos "streaming" e "stackspot_knowledge"
	requestBody := map[string]interface{}{
		"user_prompt":         prompt,
		"streaming":           false,
		"stackspot_knowledge": true,
	}
	jsonValue, _ := json.Marshal(requestBody)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, utils.NewJSONReader(jsonValue))
	if err != nil {
		return "", fmt.Errorf("erro ao criar requisição: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("erro ao ler resposta: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", &utils.APIError{StatusCode: resp.StatusCode, Message: string(body)}
	}

	var response struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("erro ao decodificar resposta: %w", err)
	}

	return response.Message, nil
}
