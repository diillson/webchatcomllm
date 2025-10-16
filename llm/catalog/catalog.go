package catalog

import (
	"strings"

	"github.com/webchatcomllm/config"
)

// Nomes internos dos provedores
const (
	ProviderStackSpot = "STACKSPOT"
	ProviderOpenAI    = "OPENAI"
	ProviderClaude    = "CLAUDE"
)

// ModelMeta guarda metadados dos modelos
type ModelMeta struct {
	ID        string
	Provider  string
	MaxTokens int
}

var registry = []ModelMeta{
	// StackSpot (Exibido como "GPT-5")
	{
		ID:        config.StackSpotDefaultModel,
		Provider:  ProviderStackSpot,
		MaxTokens: 8192,
	},
	// OpenAI
	{
		ID:        config.OpenAIDefaultModel,
		Provider:  ProviderOpenAI,
		MaxTokens: 4096,
	},
	// Claude
	{
		ID:        config.ClaudeSonnet4,
		Provider:  ProviderClaude,
		MaxTokens: 4096,
	},
	{
		ID:        config.ClaudeSonnet45,
		Provider:  ProviderClaude,
		MaxTokens: 4096,
	},
}

// Resolve encontra metadados de um modelo pelo provedor e ID.
func Resolve(provider, modelID string) (ModelMeta, bool) {
	p := strings.ToUpper(provider)
	m := strings.ToLower(modelID)

	for _, meta := range registry {
		// Mapeamento especial para o nome de exibição "GPT-5"
		if p == "GPT-5" && meta.Provider == ProviderStackSpot {
			return meta, true
		}
		if meta.Provider == p && meta.ID == m {
			return meta, true
		}
	}
	return ModelMeta{}, false
}

// GetMaxTokens retorna o limite de tokens de um modelo.
func GetMaxTokens(provider, modelID string) int {
	if meta, ok := Resolve(provider, modelID); ok {
		return meta.MaxTokens
	}
	return 4096 // Fallback genérico
}
