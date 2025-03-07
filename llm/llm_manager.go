package llm

import (
	"fmt"
	"go.uber.org/zap"
	"os"
)

type LLMManager struct {
	clients map[string]func(string) (LLMClient, error)
	logger  *zap.Logger
}

func NewLLMManager(logger *zap.Logger) (*LLMManager, error) {
	manager := &LLMManager{
		clients: make(map[string]func(string) (LLMClient, error)),
		logger:  logger,
	}

	// Configurar a fábrica para OpenAI
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		logger.Warn("OPENAI_API_KEY não está definido")
	} else {
		manager.clients["OPENAI"] = func(model string) (LLMClient, error) {
			model = os.Getenv("OPENAI_MODEL")
			if model == "" {
				model = "gpt-3.5-turbo" // Modelo padrão
			}
			return NewOpenAIClient(apiKey, model, logger), nil
		}
	}

	// Configurar a fábrica para StackSpot
	clientID := os.Getenv("CLIENT_ID")
	clientSecret := os.Getenv("CLIENT_SECRET")
	slug := os.Getenv("SLUG_NAME")
	if clientID == "" || clientSecret == "" || slug == "" {
		logger.Warn("As credenciais do StackSpot não estão definidas")
	} else {
		tokenManager := NewTokenManager(clientID, clientSecret, logger)
		manager.clients["SPOT"] = func(model string) (LLMClient, error) {
			return NewStackSpotClient(tokenManager, slug, logger), nil
		}
	}

	// Configurar a fábrica para ClaudeAI
	claudeAPIKey := os.Getenv("CLAUDEAI_API_KEY")
	if claudeAPIKey == "" {
		logger.Warn("CLAUDEAI_API_KEY não está definido")
	} else {
		manager.clients["CLAUDEAI"] = func(model string) (LLMClient, error) {
			model = os.Getenv("CLAUDEAI_MODEL")
			if model == "" {
				model = "claude-3-5-sonnet-20241022" // Modelo padrão
			}
			return NewClaudeAIClient(claudeAPIKey, model, logger), nil
		}
	}

	// Configurar a fábrica para ClaudeAI_3_7
	claude_3_7APIKey := os.Getenv("CLAUDEAI_API_KEY")
	if claudeAPIKey == "" {
		logger.Warn("CLAUDEAI_API_KEY não está definido")
	} else {
		manager.clients["CLAUDEAI-3.7"] = func(model string) (LLMClient, error) {
			model = os.Getenv("CLAUDEAI_3_7_MODEL")
			if model == "" {
				model = "claude-3-7-sonnet-20250219" // Modelo padrão
			}
			return NewClaudeAI_3_7Client(claude_3_7APIKey, model, logger), nil
		}
	}

	return manager, nil
}

func (m *LLMManager) GetClient(provider string, model string) (LLMClient, error) {
	factoryFunc, ok := m.clients[provider]
	if !ok {
		return nil, fmt.Errorf("Provedor LLM '%s' não suportado", provider)
	}

	// Cada provedor deve usar seu próprio modelo específico
	var selectedModel string
	switch provider {
	case "OPENAI":
		selectedModel = os.Getenv("OPENAI_MODEL")
		if selectedModel == "" {
			selectedModel = "gpt-3.5-turbo" // Modelo padrão OpenAI
		}
		m.logger.Info("Selecionando modelo OpenAI", zap.String("model", selectedModel))
	case "CLAUDEAI":
		selectedModel = os.Getenv("CLAUDEAI_MODEL")
		if selectedModel == "" {
			selectedModel = "claude-3-5-sonnet-20241022" // Modelo padrão Claude
		}
		m.logger.Info("Selecionando modelo ClaudeAI", zap.String("model", selectedModel))
	case "CLAUDEAI-3.7":
		selectedModel = os.Getenv("CLAUDEAI_3_7_MODEL")
		if selectedModel == "" {
			selectedModel = "claude-3-7-sonnet-20250219" // Modelo padrão Claude
		}
		m.logger.Info("Selecionando modelo ClaudeAI 3.7", zap.String("model", selectedModel))
	case "SPOT":
		selectedModel = "spot-default"
		m.logger.Info("Selecionando modelo GPT-4o", zap.String("model", selectedModel))
	}

	m.logger.Info("Criando cliente LLM",
		zap.String("provider", provider),
		zap.String("selectedModel", selectedModel))

	client, err := factoryFunc(selectedModel)
	if err != nil {
		return nil, fmt.Errorf("erro ao criar cliente para provedor %s: %w", provider, err)
	}

	return client, nil
}
