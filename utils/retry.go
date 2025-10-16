package utils

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"

	"go.uber.org/zap"
)

// APIError é um erro estruturado para respostas HTTP com status code.
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("API error: status %d - %s", e.StatusCode, e.Message)
}

// Retry executa uma função com retry exponencial para erros temporários.
func Retry[T any](ctx context.Context, logger *zap.Logger, maxAttempts int, initialBackoff time.Duration, fn func(context.Context) (T, error)) (T, error) {
	var zero T
	backoff := initialBackoff

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		res, err := fn(ctx)
		if err == nil {
			return res, nil
		}

		if IsTemporaryError(err) {
			if attempt < maxAttempts {
				logger.Warn("Erro temporário, tentando novamente...",
					zap.Int("tentativa", attempt),
					zap.Int("max_tentativas", maxAttempts),
					zap.Duration("espera", backoff),
					zap.Error(err))
				time.Sleep(backoff)
				backoff *= 2 // Backoff exponencial
				continue
			}
		}

		// Erro permanente ou última tentativa
		return zero, err
	}

	return zero, fmt.Errorf("falha após %d tentativas", maxAttempts)
}

// IsTemporaryError verifica se o erro é temporário e pode ser alvo de retry.
func IsTemporaryError(err error) bool {
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}

	var apiErr *APIError
	if errors.As(err, &apiErr) {
		// Retry para Rate Limit (429) e Erros de Servidor (5xx)
		return apiErr.StatusCode == 429 || (apiErr.StatusCode >= 500 && apiErr.StatusCode < 600)
	}

	return false
}
