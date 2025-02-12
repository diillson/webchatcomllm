// handlers/response_store.go

package handlers

import (
	"github.com/webchatcomllm/models"
	"sync"
)

type ResponseStore struct {
	mu        sync.RWMutex
	responses map[string]map[string]*models.ResponseData // Mapa para armazenar por session_id
}

func NewResponseStore() *ResponseStore {
	return &ResponseStore{
		responses: make(map[string]map[string]*models.ResponseData),
	}
}

// Armazenar a resposta associada ao session_id e messageID
func (store *ResponseStore) SetResponse(sessionID, messageID string, data *models.ResponseData) {
	store.mu.Lock()
	defer store.mu.Unlock()

	// Verificar se já existe um mapa de respostas para o sessionID
	if store.responses[sessionID] == nil {
		store.responses[sessionID] = make(map[string]*models.ResponseData)
	}
	store.responses[sessionID][messageID] = data
}

// Obter a resposta associada ao session_id e messageID
func (store *ResponseStore) GetResponse(sessionID, messageID string) (*models.ResponseData, bool) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	if responsesForSession, exists := store.responses[sessionID]; exists {
		data, found := responsesForSession[messageID]
		return data, found
	}
	return nil, false
}
