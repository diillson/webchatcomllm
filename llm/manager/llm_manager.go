package manager

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/webchatcomllm/config"
	"github.com/webchatcomllm/llm/catalog"
	"github.com/webchatcomllm/llm/claude"
	"github.com/webchatcomllm/llm/client"
	"github.com/webchatcomllm/llm/openai"
	"github.com/webchatcomllm/llm/stackspot"
	"github.com/webchatcomllm/llm/token"
	"go.uber.org/zap"
)

type LLMManager interface {
	GetClient(provider string, model string) (client.LLMClient, error)
}

type llmManagerImpl struct {
	factories map[string]func(string) (client.LLMClient, error)
	logger    *zap.Logger
}

func NewLLMManager(logger *zap.Logger) (LLMManager, error) {
	manager := &llmManagerImpl{
		factories: make(map[string]func(string) (client.LLMClient, error)),
		logger:    logger,
	}

	maxRetries := config.DefaultMaxRetries
	backoff := config.DefaultInitialBackoff

	manager.configureStackSpot(maxRetries, backoff)
	manager.configureOpenAI(maxRetries, backoff)
	manager.configureClaude(maxRetries, backoff)

	if len(manager.factories) == 0 {
		return nil, fmt.Errorf("nenhum provedor de LLM foi configurado. Verifique seu arquivo .env")
	}

	return manager, nil
}

func (m *llmManagerImpl) GetClient(provider, model string) (client.LLMClient, error) {
	p := strings.ToUpper(provider)
	if p == "GPT-5" {
		p = catalog.ProviderStackSpot
	}

	// CORREÇÃO: Log detalhado
	m.logger.Debug("GetClient chamado",
		zap.String("provider_original", provider),
		zap.String("provider_normalizado", p),
		zap.String("model", model),
	)

	factory, ok := m.factories[p]
	if !ok {
		// Lista provedores disponíveis
		available := make([]string, 0, len(m.factories))
		for key := range m.factories {
			available = append(available, key)
		}

		m.logger.Error("Provedor não encontrado",
			zap.String("provider_solicitado", provider),
			zap.String("provider_normalizado", p),
			zap.Strings("provedores_disponiveis", available),
		)

		return nil, fmt.Errorf("provedor LLM '%s' não é suportado ou não está configurado. Provedores disponíveis: %v", provider, available)
	}
	return factory(model)
}

func (m *llmManagerImpl) configureStackSpot(maxRetries int, backoff time.Duration) {
	clientID := os.Getenv("CLIENT_ID")
	clientKey := os.Getenv("CLIENT_KEY")
	realm := os.Getenv("STACKSPOT_REALM")
	agentID := os.Getenv("STACKSPOT_AGENT_ID")

	if clientID != "" && clientKey != "" && realm != "" && agentID != "" {
		tokenManager := token.NewTokenManager(clientID, clientKey, realm, m.logger)
		m.factories[catalog.ProviderStackSpot] = func(model string) (client.LLMClient, error) {
			return stackspot.NewClient(tokenManager, agentID, m.logger, maxRetries, backoff), nil
		}
		m.logger.Info("Provedor StackSpot (GPT-5) configurado.")
	} else {
		m.logger.Warn("Provedor StackSpot (GPT-5) não configurado. Faltam variáveis de ambiente.")
	}
}

func (m *llmManagerImpl) configureOpenAI(maxRetries int, backoff time.Duration) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey != "" {
		m.factories[catalog.ProviderOpenAI] = func(model string) (client.LLMClient, error) {
			return openai.NewClient(apiKey, config.OpenAIDefaultModel, m.logger, maxRetries, backoff), nil
		}
		m.logger.Info("Provedor OpenAI configurado.")
	} else {
		m.logger.Warn("Provedor OpenAI não configurado. OPENAI_API_KEY não definida.")
	}
}

func (m *llmManagerImpl) configureClaude(maxRetries int, backoff time.Duration) {
	apiKey := os.Getenv("CLAUDEAI_API_KEY")
	if apiKey != "" {
		m.factories[catalog.ProviderClaude] = func(model string) (client.LLMClient, error) {
			if model != config.ClaudeSonnet4 && model != config.ClaudeSonnet45 {
				m.logger.Warn("Modelo Claude não suportado, usando Sonnet 4.5 como padrão", zap.String("solicitado", model))
				model = config.ClaudeSonnet45
			}
			return claude.NewClient(apiKey, model, m.logger, maxRetries, backoff), nil
		}
		m.logger.Info("Provedor Claude configurado.")
	} else {
		m.logger.Warn("Provedor Claude não configurado. CLAUDEAI_API_KEY não definida.")
	}
}
