package handlers

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/webchatcomllm/llm"
	"github.com/webchatcomllm/models"
	"go.uber.org/zap"
	"net/http"
	"time"
)

func SendMessageHandler(manager *llm.LLMManager, store *ResponseStore, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Método não suportado", http.StatusMethodNotAllowed)
			return
		}

		// Estrutura para receber os dados do corpo da requisição
		var data struct {
			Provider  string           `json:"provider"`
			Model     string           `json:"model"`
			Prompt    string           `json:"prompt"`
			History   []models.Message `json:"history"`
			SessionID string           `json:"session_id"`
		}

		// Decodificar o corpo da requisição
		err := json.NewDecoder(r.Body).Decode(&data)
		if err != nil {
			logger.Error("Erro ao decodificar o JSON", zap.Error(err))
			http.Error(w, "Dados inválidos", http.StatusBadRequest)
			return
		}

		// Verificar se o session_id foi enviado
		if data.SessionID == "" {
			http.Error(w, "session_id não fornecido", http.StatusBadRequest)
			return
		}

		// Obter o cliente LLM com base no provider e model
		client, err := manager.GetClient(data.Provider, data.Model)
		if err != nil {
			logger.Error("Erro ao obter o cliente LLM", zap.Error(err))
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Gerar um ID único para a mensagem
		messageID := uuid.New().String()

		// Armazenar o status inicial como "processing"
		store.SetResponse(data.SessionID, messageID, &models.ResponseData{
			Status: "processing",
		})

		// Iniciar o processamento em background
		go func(sessionID, messageID string, client llm.LLMClient, prompt string, history []models.Message) {
			// Criar um novo contexto com timeout
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			llmResponse, err := client.SendPrompt(ctx, prompt, history)
			if err != nil {
				logger.Error("Erro ao obter a resposta da LLM", zap.Error(err))
				store.SetResponse(sessionID, messageID, &models.ResponseData{
					Status:  "error",
					Message: err.Error(),
				})
				return
			}

			// Armazenar a resposta com status "completed"
			store.SetResponse(sessionID, messageID, &models.ResponseData{
				Status:   "completed",
				Response: llmResponse,
			})
		}(data.SessionID, messageID, client, data.Prompt, data.History)

		// Retornar o messageID para o cliente
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"message_id": messageID,
		})
	}
}
