package utils

import (
	"bytes"
	"io"
)

// NewJSONReader cria um io.Reader a partir de um []byte para requisições HTTP.
func NewJSONReader(data []byte) io.Reader {
	return bytes.NewReader(data)
}
