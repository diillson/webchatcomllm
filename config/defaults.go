package config

import "time"

const (
	// StackSpot AI (Exibido como "GPT-5")
	StackSpotBaseURL      = "https://genai-inference-app.stackspot.com/v1"
	StackSpotDefaultModel = "StackSpotAI" // Nome interno para o catálogo
	DefaultStackSpotRealm = "zup"         // Realm padrão, pode ser sobrescrito por .env

	// OpenAI
	OpenAIDefaultModel = "gpt-4o"
	OpenAIAPIURL       = "https://api.openai.com/v1/chat/completions"

	// Claude AI
	ClaudeSonnet4    = "claude-sonnet-4-20250514"   // Exemplo, use o ID real se for diferente
	ClaudeSonnet45   = "claude-sonnet-4-5-20250929" // Exemplo, use o ID real se for diferente
	ClaudeAPIURL     = "https://api.anthropic.com/v1/messages"
	ClaudeAPIVersion = "2023-06-01"

	// Configurações de Retry
	DefaultMaxRetries     = 3
	DefaultInitialBackoff = 2 * time.Second

	// Configurações Gerais de Log
	DefaultLogFile = "app.log"
)
