package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"text/template"
	"time"

	"github.com/joho/godotenv"
	"github.com/webchatcomllm/handlers"
	"github.com/webchatcomllm/llm/manager"
	"github.com/webchatcomllm/middlewares"
	"go.uber.org/zap"
)

func main() {
	if err := godotenv.Load(); err != nil {
		fmt.Println("Nenhum arquivo .env encontrado, usando variáveis de ambiente do sistema.")
	}

	logger, _ := zap.NewProduction()
	defer logger.Sync()

	llmManager, err := manager.NewLLMManager(logger)
	if err != nil {
		logger.Fatal("Erro ao inicializar LLMManager", zap.Error(err))
	}

	mux := http.NewServeMux()

	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		tmpl, err := template.ParseFiles(filepath.Join("templates", "index.html"))
		if err != nil {
			http.Error(w, "Erro interno no servidor", http.StatusInternalServerError)
			logger.Error("Erro ao carregar template", zap.Error(err))
			return
		}
		if err := tmpl.Execute(w, nil); err != nil {
			logger.Error("Erro ao executar template", zap.Error(err))
		}
	})

	mux.HandleFunc("/ws", handlers.WebSocketHandler(llmManager, logger))

	finalHandler := middlewares.ForceHTTPSMiddleware(mux, logger)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      finalHandler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	logger.Info("Servidor iniciado na porta", zap.String("port", port))
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal("Erro ao iniciar servidor", zap.Error(err))
	}
}
