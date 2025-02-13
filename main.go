package main

import (
	"encoding/json"
	"fmt"
	"github.com/joho/godotenv"
	"github.com/webchatcomllm/handlers"
	"github.com/webchatcomllm/llm"
	"github.com/webchatcomllm/middlewares"
	"go.uber.org/zap"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func indexHandler(logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tmpl, err := template.ParseFiles(filepath.Join("templates", "index.html"))
		if err != nil {
			logger.Error("Erro ao carregar o template", zap.Error(err))
			http.Error(w, "Erro ao carregar o template", http.StatusInternalServerError)
			return
		}

		data := map[string]string{
			"OpenAIModel":  os.Getenv("OPENAI_MODEL"),
			"ClaudeModel":  os.Getenv("CLAUDEAI_MODEL"),
			"DefaultModel": "spot-default",
			"CurrentModel": os.Getenv("OPENAI_MODEL"), // Modelo inicial
		}

		if data["OpenAIModel"] == "" {
			data["OpenAIModel"] = "gpt-4o-mini"
		}
		if data["ClaudeModel"] == "" {
			data["ClaudeModel"] = "claude-3-5-sonnet-20241022"
		}

		logger.Info("Carregando página com modelos",
			zap.String("openai_model", data["OpenAIModel"]),
			zap.String("claude_model", data["ClaudeModel"]))

		tmpl.Execute(w, data)
	}
}

func getModelsHandler(logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		models := map[string]string{
			"openai":  os.Getenv("OPENAI_MODEL"),
			"claude":  os.Getenv("CLAUDEAI_MODEL"),
			"default": "spot-default",
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models)
	}
}

func main() {
	// Carrega variáveis de ambiente
	err := godotenv.Load()
	if err != nil {
		fmt.Println("Nenhum arquivo .env encontrado, continuando sem ele")
	}

	// Configurar o logger
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	manager, err := llm.NewLLMManager(logger)
	if err != nil {
		logger.Fatal("Erro ao inicializar o LLMManager", zap.Error(err))
	}

	// Inicializa o ResponseStore
	responseStore := handlers.NewResponseStore()

	mux := http.NewServeMux()
	mux.HandleFunc("/", indexHandler(logger))
	mux.HandleFunc("/send", handlers.SendMessageHandler(manager, responseStore, logger))
	mux.HandleFunc("/get-response", handlers.GetResponseHandler(responseStore, logger))
	mux.HandleFunc("/api/models", getModelsHandler(logger))
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	finalHandler := middlewares.ForceHTTPSMiddleware(mux, logger)

	logger.Info("Servidor iniciado", zap.String("port", port))

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      finalHandler,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal("Erro ao iniciar o servidor", zap.Error(err))
	}
}
