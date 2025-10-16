package utils

import (
	"net/http"
	"time"

	"go.uber.org/zap"
)

// NewHTTPClient cria um cliente HTTP com LoggingTransport e timeout configurado.
func NewHTTPClient(logger *zap.Logger, timeout time.Duration) *http.Client {
	return &http.Client{
		Transport: &LoggingTransport{
			Logger:    logger,
			Transport: http.DefaultTransport,
		},
		Timeout: timeout,
	}
}
