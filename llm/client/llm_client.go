package client

import (
	"context"

	"github.com/webchatcomllm/models"
)

// LLMClient define a interface para todos os clientes de LLM.
type LLMClient interface {
	SendPrompt(ctx context.Context, prompt string, history []models.Message, maxTokens int) (string, error)
	GetModelName() string
}
