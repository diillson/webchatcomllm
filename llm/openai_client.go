package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/webchatcomllm/models"
	"go.uber.org/zap"
	"io/ioutil"
	"net/http"
	"time"
)

type OpenAIClient struct {
	apiKey string
	model  string
	logger *zap.Logger
}

func NewOpenAIClient(apiKey, model string, logger *zap.Logger) *OpenAIClient {
	return &OpenAIClient{
		apiKey: apiKey,
		model:  model,
		logger: logger,
	}
}

func (c *OpenAIClient) GetModelName() string {
	return c.model
}

func (c *OpenAIClient) SendPrompt(ctx context.Context, prompt string, history []models.Message) (string, error) {
	url := "https://api.openai.com/v1/chat/completions"

	// Construir o array de mensagens
	messages := []map[string]string{}

	// Adicionar o histórico
	for _, msg := range history {
		messages = append(messages, map[string]string{
			"role":    msg.Role,
			"content": msg.Content,
		})
	}

	// Adicionar a nova mensagem do usuário
	messages = append(messages, map[string]string{
		"role":    "user",
		"content": prompt,
	})

	payload := map[string]interface{}{
		"model":    c.model,
		"messages": messages,
	}

	jsonValue, _ := json.Marshal(payload)

	maxAttempts := 3
	backoff := time.Second

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonValue))
		if err != nil {
			return "", fmt.Errorf("erro ao criar a requisição: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+c.apiKey)

		client := &http.Client{
			Timeout: 30 * time.Second,
		}
		resp, err := client.Do(req)
		if err != nil {
			if isTemporaryError(err) {
				c.logger.Warn("Erro temporário ao chamar OpenAI", zap.Int("attempt", attempt), zap.Error(err))
				if attempt < maxAttempts {
					time.Sleep(backoff)
					backoff *= 2 // Backoff exponencial
					continue
				}
			}
			return "", fmt.Errorf("erro ao fazer a requisição para OpenAI: %w", err)
		}
		defer resp.Body.Close()

		bodyBytes, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return "", fmt.Errorf("erro ao ler a resposta da OpenAI: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			errMsg := fmt.Sprintf("Erro na requisição à OpenAI: status %d, resposta: %s", resp.StatusCode, string(bodyBytes))
			return "", fmt.Errorf(errMsg)
		}

		var result map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &result); err != nil {
			return "", fmt.Errorf("erro ao decodificar a resposta da OpenAI: %w", err)
		}

		choices, ok := result["choices"].([]interface{})
		if !ok || len(choices) == 0 {
			return "", fmt.Errorf("Nenhuma resposta recebida da OpenAI")
		}

		firstChoice := choices[0].(map[string]interface{})
		message := firstChoice["message"].(map[string]interface{})
		content := message["content"].(string)

		return content, nil
	}

	return "", fmt.Errorf("Falha ao obter resposta da OpenAI após %d tentativas", maxAttempts)
}
