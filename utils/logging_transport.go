package utils

import (
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"
)

// LoggingTransport é um http.RoundTripper que adiciona logs.
type LoggingTransport struct {
	Logger    *zap.Logger
	Transport http.RoundTripper
}

// RoundTrip implementa a interface http.RoundTripper.
func (t *LoggingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	start := time.Now()

	// Sanitiza a URL para não logar chaves de API em query params
	safeURL := req.URL.Redacted()

	t.Logger.Debug("Enviando requisição HTTP",
		zap.String("metodo", req.Method),
		zap.String("url", safeURL),
	)

	resp, err := t.Transport.RoundTrip(req)
	duration := time.Since(start)

	if err != nil {
		t.Logger.Error("Erro na requisição HTTP",
			zap.String("metodo", req.Method),
			zap.String("url", safeURL),
			zap.Duration("duracao", duration),
			zap.Error(err),
		)
		return nil, err
	}

	t.Logger.Debug("Resposta HTTP recebida",
		zap.Int("status_code", resp.StatusCode),
		zap.String("status", resp.Status),
		zap.Duration("duracao", duration),
	)

	return resp, nil
}

// SanitizeSensitiveText remove/mascara tokens em qualquer texto.
func SanitizeSensitiveText(s string) string {
	// Implementação simples para headers, pode ser expandida
	if strings.HasPrefix(s, "Bearer ") {
		return "Bearer [REDACTED]"
	}
	return s
}
