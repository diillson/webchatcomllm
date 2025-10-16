package token

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/webchatcomllm/utils"
	"go.uber.org/zap"
)

type Manager interface {
	GetAccessToken(ctx context.Context) (string, error)
	RefreshToken(ctx context.Context) (string, error)
}

type tokenManagerImpl struct {
	clientID     string
	clientSecret string
	realm        string
	accessToken  string
	expiresAt    time.Time
	mu           sync.RWMutex
	logger       *zap.Logger
	httpClient   *http.Client
}

func NewTokenManager(clientID, clientSecret, realm string, logger *zap.Logger) Manager {
	return &tokenManagerImpl{
		clientID:     clientID,
		clientSecret: clientSecret,
		realm:        realm,
		logger:       logger,
		httpClient:   utils.NewHTTPClient(logger, 30*time.Second),
	}
}

func (tm *tokenManagerImpl) GetAccessToken(ctx context.Context) (string, error) {
	tm.mu.RLock()
	if time.Until(tm.expiresAt) > 60*time.Second && tm.accessToken != "" {
		token := tm.accessToken
		tm.mu.RUnlock()
		return token, nil
	}
	tm.mu.RUnlock()
	return tm.RefreshToken(ctx)
}

func (tm *tokenManagerImpl) RefreshToken(ctx context.Context) (string, error) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if time.Until(tm.expiresAt) > 60*time.Second && tm.accessToken != "" {
		return tm.accessToken, nil
	}

	tm.logger.Info("Renovando access token", zap.String("realm", tm.realm))

	tokenURL := fmt.Sprintf("https://idm.stackspot.com/%s/oidc/oauth/token", tm.realm)
	data := strings.NewReader(fmt.Sprintf("grant_type=client_credentials&client_id=%s&client_secret=%s", tm.clientID, tm.clientSecret))

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, data)
	if err != nil {
		return "", fmt.Errorf("erro ao criar requisição de token: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := tm.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("erro ao fazer requisição de token: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("erro ao ler resposta de token: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("falha ao obter token (status %d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		AccessToken string  `json:"access_token"`
		ExpiresIn   float64 `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("erro ao decodificar resposta de token: %w", err)
	}

	if result.AccessToken == "" {
		return "", errors.New("access_token não encontrado na resposta")
	}

	tm.accessToken = result.AccessToken
	tm.expiresAt = time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)
	tm.logger.Info("Token renovado com sucesso")

	return tm.accessToken, nil
}
