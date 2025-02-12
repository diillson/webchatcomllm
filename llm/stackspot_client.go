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
	"strings"
	"sync"
	"time"
)

type StackSpotClient struct {
	tokenManager *TokenManager
	slug         string
	logger       *zap.Logger
}

func NewStackSpotClient(tokenManager *TokenManager, slug string, logger *zap.Logger) *StackSpotClient {
	return &StackSpotClient{
		tokenManager: tokenManager,
		slug:         slug,
		logger:       logger,
	}
}

func (c *StackSpotClient) GetModelName() string {
	return "GPT-4o"
}

// Função para formatar o histórico da conversa
func formatConversationHistory(history []models.Message) string {
	var conversationBuilder strings.Builder
	for _, msg := range history {
		role := "Usuário"
		if msg.Role == "assistant" {
			role = "Assistente"
		}
		conversationBuilder.WriteString(fmt.Sprintf("%s: %s\n", role, msg.Content))
	}
	return conversationBuilder.String()
}

func (c *StackSpotClient) SendPrompt(ctx context.Context, prompt string, history []models.Message) (string, error) {
	token, err := c.tokenManager.GetAccessToken(ctx)
	if err != nil {
		c.logger.Error("Erro ao obter o token", zap.Error(err))
		return "", fmt.Errorf("erro ao obter o token: %w", err)
	}

	// Formatar o histórico da conversa
	conversationHistory := formatConversationHistory(history)

	// Concatenar o histórico com o prompt atual
	fullPrompt := fmt.Sprintf("%sUsuário: %s", conversationHistory, prompt)

	// Enviar o prompt completo e obter o responseID
	responseID, err := c.sendRequestToLLMWithRetry(ctx, fullPrompt, token)
	if err != nil {
		c.logger.Error("Erro ao enviar a requisição para a LLM", zap.Error(err))
		return "", fmt.Errorf("erro ao enviar a requisição: %w", err)
	}

	var llmResponse string
	maxAttempts := 50
	for i := 0; i < maxAttempts; i++ {
		select {
		case <-ctx.Done():
			return "", fmt.Errorf("contexto cancelado ou expirado: %w", ctx.Err())
		case <-time.After(2 * time.Second):
			llmResponse, err = c.getLLMResponseWithRetry(ctx, responseID, token)
			if err == nil {
				return llmResponse, nil
			}

			if strings.Contains(err.Error(), "resposta ainda não está pronta") {
				c.logger.Info("Resposta ainda não está pronta", zap.Int("tentativa", i+1))
				continue
			}

			if strings.Contains(err.Error(), "a execução da LLM falhou") {
				c.logger.Error("Falha na execução da LLM", zap.Error(err))
				return "", fmt.Errorf("a LLM não pôde processar a solicitação")
			}

			c.logger.Error("Erro ao obter a resposta da LLM", zap.Error(err))
			return "", fmt.Errorf("erro ao obter a resposta: %w", err)
		}
	}

	c.logger.Error("Timeout ao obter a resposta da LLM")
	return "", fmt.Errorf("timeout ao obter a resposta da LLM")
}

// Implementação das funções auxiliares com retry

func (c *StackSpotClient) sendRequestToLLMWithRetry(ctx context.Context, prompt, accessToken string) (string, error) {
	maxAttempts := 5
	backoff := time.Second

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		responseID, err := c.sendRequestToLLM(ctx, prompt, accessToken)
		if err != nil {
			if isTemporaryError(err) {
				c.logger.Warn("Erro temporário ao enviar requisição para GPT-4o", zap.Int("attempt", attempt), zap.Error(err))
				if attempt < maxAttempts {
					time.Sleep(backoff)
					backoff *= 2 // Backoff exponencial
					continue
				}
			}
			return "", fmt.Errorf("erro ao enviar requisição para GPT-4o: %w", err)
		}
		return responseID, nil
	}

	return "", fmt.Errorf("falha ao enviar requisição para GPT-4o após %d tentativas", maxAttempts)
}

func (c *StackSpotClient) getLLMResponseWithRetry(ctx context.Context, responseID, accessToken string) (string, error) {
	maxAttempts := 3
	backoff := time.Second

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		llmResponse, err := c.getLLMResponse(ctx, responseID, accessToken)
		if err != nil {
			if isTemporaryError(err) {
				c.logger.Warn("Erro temporário ao obter resposta da GPT-4o", zap.Int("attempt", attempt), zap.Error(err))
				if attempt < maxAttempts {
					time.Sleep(backoff)
					backoff *= 2 // Backoff exponencial
					continue
				}
			}
			return "", fmt.Errorf("erro ao obter resposta da GPT-4o: %w", err)
		}
		return llmResponse, nil
	}

	return "", fmt.Errorf("falha ao obter resposta da GPT-4o após %d tentativas", maxAttempts)
}

func (c *StackSpotClient) sendRequestToLLM(ctx context.Context, prompt, accessToken string) (string, error) {
	conversationID := generateUUID()

	url := fmt.Sprintf("https://genai-code-buddy-api.stackspot.com/v1/quick-commands/create-execution/%s?conversation_id=%s", c.slug, conversationID)
	c.logger.Info("Fazendo POST para URL", zap.String("url", url))

	requestBody := map[string]string{
		"input_data": prompt,
	}
	jsonValue, _ := json.Marshal(requestBody)

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonValue))
	if err != nil {
		return "", fmt.Errorf("erro ao criar a requisição: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("erro ao fazer a requisição: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("erro ao ler a resposta: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		c.logger.Error("Erro na requisição à LLM", zap.Int("status_code", resp.StatusCode), zap.String("response", string(bodyBytes)))
		return "", fmt.Errorf("erro na requisição à LLM: status %d, resposta: %s", resp.StatusCode, string(bodyBytes))
	}

	var responseID string
	if err := json.Unmarshal(bodyBytes, &responseID); err != nil {
		c.logger.Error("Erro ao deserializar o responseID", zap.Error(err))
		return "", fmt.Errorf("erro ao deserializar o responseID: %w", err)
	}

	c.logger.Info("Response ID recebido", zap.String("response_id", responseID))
	return responseID, nil
}

func (c *StackSpotClient) getLLMResponse(ctx context.Context, responseID, accessToken string) (string, error) {
	url := fmt.Sprintf("https://genai-code-buddy-api.stackspot.com/v1/quick-commands/callback/%s", responseID)
	c.logger.Info("Fazendo GET para URL", zap.String("url", url))

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		c.logger.Error("Erro ao criar a requisição GET", zap.Error(err))
		return "", fmt.Errorf("erro ao criar a requisição GET: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	resp, err := client.Do(req)
	if err != nil {
		c.logger.Error("Erro na requisição GET para a LLM", zap.Error(err))
		return "", fmt.Errorf("erro na requisição GET para a LLM: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		c.logger.Error("Erro ao ler o corpo da resposta da LLM", zap.Error(err))
		return "", fmt.Errorf("erro ao ler o corpo da resposta da LLM: %w", err)
	}

	c.logger.Info("Resposta recebida", zap.Int("status_code", resp.StatusCode), zap.String("response", string(bodyBytes)))

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("erro na requisição de callback: status %d, resposta: %s", resp.StatusCode, string(bodyBytes))
	}

	var callbackResponse CallbackResponse
	if err := json.Unmarshal(bodyBytes, &callbackResponse); err != nil {
		c.logger.Error("Erro ao deserializar a resposta JSON", zap.Error(err))
		return "", fmt.Errorf("erro ao deserializar a resposta JSON: %w", err)
	}

	switch callbackResponse.Progress.Status {
	case "COMPLETED":
		if len(callbackResponse.Steps) > 0 {
			lastStepIndex := len(callbackResponse.Steps) - 1
			lastStep := callbackResponse.Steps[lastStepIndex]
			llmAnswer := lastStep.StepResult.Answer
			return llmAnswer, nil
		} else {
			return "", fmt.Errorf("nenhuma resposta disponível")
		}
	case "FAILURE":
		c.logger.Error("A execução falhou", zap.String("status", callbackResponse.Progress.Status))
		return "", fmt.Errorf("a execução da LLM falhou")
	default:
		c.logger.Info("Status da execução", zap.String("status", callbackResponse.Progress.Status))
		return "", fmt.Errorf("resposta ainda não está pronta")
	}
}

// Estruturas para decodificar a resposta da LLM

type CallbackResponse struct {
	ExecutionID      string   `json:"execution_id"`
	QuickCommandSlug string   `json:"quick_command_slug"`
	ConversationID   string   `json:"conversation_id"`
	Progress         Progress `json:"progress"`
	Steps            []Step   `json:"steps"`
	Result           string   `json:"result"`
}

type Progress struct {
	Start               string  `json:"start"`
	End                 string  `json:"end"`
	Duration            int     `json:"duration"`
	ExecutionPercentage float64 `json:"execution_percentage"`
	Status              string  `json:"status"`
}

type Step struct {
	StepName       string     `json:"step_name"`
	ExecutionOrder int        `json:"execution_order"`
	Type           string     `json:"type"`
	StepResult     StepResult `json:"step_result"`
}

type Source struct {
	Type          string  `json:"type,omitempty"`
	Name          string  `json:"name,omitempty"`
	Slug          string  `json:"slug,omitempty"`
	DocumentType  string  `json:"document_type,omitempty"`
	DocumentScore float64 `json:"document_score,omitempty"`
	DocumentID    string  `json:"document_id,omitempty"`
}

type StepResult struct {
	Answer  string   `json:"answer"`
	Sources []Source `json:"sources"`
}

// Implementação do TokenManager

type TokenManager struct {
	clientID     string
	clientSecret string
	accessToken  string
	expiresAt    time.Time
	mu           sync.RWMutex
	logger       *zap.Logger
}

func NewTokenManager(clientID, clientSecret string, logger *zap.Logger) *TokenManager {
	return &TokenManager{
		clientID:     clientID,
		clientSecret: clientSecret,
		logger:       logger,
	}
}

func (tm *TokenManager) GetAccessToken(ctx context.Context) (string, error) {
	tm.mu.RLock()
	token := tm.accessToken
	expiration := tm.expiresAt
	tm.mu.RUnlock()

	if time.Until(expiration) > 60*time.Second && token != "" {
		return token, nil
	}

	return tm.refreshToken(ctx)
}

func (tm *TokenManager) refreshToken(ctx context.Context) (string, error) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	tm.logger.Info("Renovando o access token...")

	tokenURL := "https://idm.stackspot.com/zup/oidc/oauth/token"
	data := strings.NewReader(fmt.Sprintf(
		"grant_type=client_credentials&client_id=%s&client_secret=%s",
		tm.clientID, tm.clientSecret))

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, data)
	if err != nil {
		return "", fmt.Errorf("erro ao criar a requisição: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("erro ao fazer a requisição: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := ioutil.ReadAll(resp.Body)
		errMsg := fmt.Sprintf("falha ao obter o token: %s", string(bodyBytes))
		tm.logger.Error(errMsg)
		return "", fmt.Errorf(errMsg)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("erro ao decodificar a resposta: %w", err)
	}

	accessToken, ok := result["access_token"].(string)
	if !ok {
		return "", fmt.Errorf("não foi possível obter o access_token")
	}

	expiresIn, ok := result["expires_in"].(float64)
	if !ok {
		return "", fmt.Errorf("não foi possível obter expires_in")
	}

	tm.accessToken = accessToken
	tm.expiresAt = time.Now().Add(time.Duration(expiresIn) * time.Second)
	tm.logger.Info("Token renovado com sucesso", zap.Time("expires_at", tm.expiresAt))

	return tm.accessToken, nil
}

// Função para gerar um UUID
func generateUUID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
