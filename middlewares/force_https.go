package middlewares

import (
	"net/http"
	"os"

	"go.uber.org/zap"
)

func ForceHTTPSMiddleware(next http.Handler, logger *zap.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		env := os.Getenv("ENV")
		if env != "prod" {
			next.ServeHTTP(w, r)
			return
		}

		if r.Header.Get("X-Forwarded-Proto") != "https" {
			target := "https://" + r.Host + r.URL.RequestURI()
			logger.Info("Redirecionando para HTTPS", zap.String("target", target))
			http.Redirect(w, r, target, http.StatusPermanentRedirect)
			return
		}

		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		next.ServeHTTP(w, r)
	})
}
