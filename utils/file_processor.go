package utils

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"path/filepath"
	"strings"

	"github.com/gabriel-vasile/mimetype"
	"github.com/h2non/filetype"
	"github.com/ledongthuc/pdf"
	"github.com/xuri/excelize/v2"
	"go.uber.org/zap"
)

const (
	MaxImageSize = 10 * 1024 * 1024 // 10MB para imagens
	MaxPDFSize   = 25 * 1024 * 1024 // 25MB para PDFs
	MaxDocSize   = 15 * 1024 * 1024 // 15MB para documentos Office
)

// FileType representa o tipo de arquivo processado
type FileType string

const (
	FileTypeText     FileType = "text"
	FileTypeImage    FileType = "image"
	FileTypePDF      FileType = "pdf"
	FileTypeDocx     FileType = "docx"
	FileTypeXlsx     FileType = "xlsx"
	FileTypeCode     FileType = "code"
	FileTypeMarkdown FileType = "markdown"
	FileTypeYAML     FileType = "yaml"
	FileTypeJSON     FileType = "json"
	FileTypeXML      FileType = "xml"
	FileTypeCSV      FileType = "csv"
	FileTypeBinary   FileType = "binary"
	FileTypeUnknown  FileType = "unknown"
)

// ProcessedFile representa um arquivo processado
type ProcessedFile struct {
	Name        string                 `json:"name"`
	Content     string                 `json:"content"`
	ContentType string                 `json:"contentType"`
	FileType    FileType               `json:"fileType"`
	Size        int64                  `json:"size"`
	IsBase64    bool                   `json:"isBase64"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// FileProcessor processa diferentes tipos de arquivo
type FileProcessor struct {
	logger *zap.Logger
}

// NewFileProcessor cria uma nova instância do processador
func NewFileProcessor(logger *zap.Logger) *FileProcessor {
	return &FileProcessor{logger: logger}
}

// ProcessFile processa um arquivo baseado em seu tipo
func (fp *FileProcessor) ProcessFile(name string, content []byte) (*ProcessedFile, error) {
	if len(content) == 0 {
		return nil, fmt.Errorf("arquivo vazio: %s", name)
	}

	// Detecta MIME type
	mtype := mimetype.Detect(content)
	contentType := mtype.String()
	ext := strings.ToLower(filepath.Ext(name))

	fp.logger.Debug("Processando arquivo",
		zap.String("name", name),
		zap.String("mime", contentType),
		zap.String("ext", ext),
		zap.Int("size", len(content)),
	)

	processed := &ProcessedFile{
		Name:        name,
		ContentType: contentType,
		Size:        int64(len(content)),
		Metadata:    make(map[string]interface{}),
	}

	// Roteamento por tipo de arquivo
	switch {
	case fp.isImage(contentType, ext):
		return fp.processImage(processed, content)
	case fp.isPDF(contentType, ext):
		return fp.processPDF(processed, content)
	case fp.isDocx(contentType, ext):
		return fp.processDocx(processed, content)
	case fp.isXlsx(contentType, ext):
		return fp.processXlsx(processed, content)
	case fp.isText(contentType, ext):
		return fp.processText(processed, content, ext)
	default:
		return fp.processBinary(processed, content)
	}
}

// isImage verifica se é uma imagem
func (fp *FileProcessor) isImage(mime, ext string) bool {
	imageExts := map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
		".bmp": true, ".webp": true, ".svg": true, ".ico": true,
	}
	return strings.HasPrefix(mime, "image/") || imageExts[ext]
}

// isPDF verifica se é PDF
func (fp *FileProcessor) isPDF(mime, ext string) bool {
	return mime == "application/pdf" || ext == ".pdf"
}

// isDocx verifica se é documento Word
func (fp *FileProcessor) isDocx(mime, ext string) bool {
	return mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext == ".docx"
}

// isXlsx verifica se é planilha Excel
func (fp *FileProcessor) isXlsx(mime, ext string) bool {
	return mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || ext == ".xlsx"
}

// isText verifica se é texto
func (fp *FileProcessor) isText(mime, ext string) bool {
	textExts := map[string]bool{
		".txt": true, ".md": true, ".markdown": true,
		".go": true, ".js": true, ".ts": true, ".py": true,
		".java": true, ".c": true, ".cpp": true, ".h": true,
		".cs": true, ".rb": true, ".php": true, ".html": true,
		".css": true, ".scss": true, ".sass": true, ".less": true,
		".json": true, ".yaml": true, ".yml": true, ".xml": true,
		".toml": true, ".ini": true, ".conf": true, ".config": true,
		".sh": true, ".bash": true, ".zsh": true, ".fish": true,
		".ps1": true, ".bat": true, ".cmd": true,
		".sql": true, ".log": true, ".csv": true, ".tsv": true,
		".env": true, ".gitignore": true, ".dockerignore": true,
		".dockerfile": true, ".makefile": true,
		".rst": true, ".tex": true, ".r": true, ".scala": true,
		".swift": true, ".kt": true, ".groovy": true, ".lua": true,
		".vim": true, ".el": true, ".clj": true, ".erl": true,
		".ex": true, ".exs": true, ".dart": true, ".proto": true,
	}
	return strings.HasPrefix(mime, "text/") || textExts[ext]
}

// processImage processa imagens
func (fp *FileProcessor) processImage(pf *ProcessedFile, content []byte) (*ProcessedFile, error) {
	if int64(len(content)) > MaxImageSize {
		return nil, fmt.Errorf("imagem excede o limite de %d MB", MaxImageSize/1024/1024)
	}

	// Valida se é realmente uma imagem
	kind, err := filetype.Match(content)
	if err != nil || !filetype.IsImage(content) {
		return nil, fmt.Errorf("arquivo não é uma imagem válida")
	}

	// Tenta decodificar para obter dimensões
	img, format, err := image.Decode(bytes.NewReader(content))
	if err == nil {
		bounds := img.Bounds()
		pf.Metadata["width"] = bounds.Dx()
		pf.Metadata["height"] = bounds.Dy()
		pf.Metadata["format"] = format
	}

	pf.FileType = FileTypeImage
	pf.IsBase64 = true
	pf.Content = base64.StdEncoding.EncodeToString(content)
	pf.Metadata["kind"] = kind.Extension

	fp.logger.Info("Imagem processada",
		zap.String("name", pf.Name),
		zap.String("format", format),
		zap.Any("dimensions", pf.Metadata),
	)

	return pf, nil
}

// processPDF extrai texto de PDFs
func (fp *FileProcessor) processPDF(pf *ProcessedFile, content []byte) (*ProcessedFile, error) {
	if int64(len(content)) > MaxPDFSize {
		return nil, fmt.Errorf("PDF excede o limite de %d MB", MaxPDFSize/1024/1024)
	}

	reader := bytes.NewReader(content)
	pdfReader, err := pdf.NewReader(reader, int64(len(content)))
	if err != nil {
		return nil, fmt.Errorf("erro ao abrir PDF: %w", err)
	}

	var textContent strings.Builder
	numPages := pdfReader.NumPage()
	pf.Metadata["pages"] = numPages

	for pageNum := 1; pageNum <= numPages; pageNum++ {
		page := pdfReader.Page(pageNum)
		if page.V.IsNull() {
			continue
		}

		text, err := page.GetPlainText(nil)
		if err != nil {
			fp.logger.Warn("Erro ao extrair texto da página",
				zap.Int("page", pageNum),
				zap.Error(err),
			)
			continue
		}

		textContent.WriteString(fmt.Sprintf("\n--- Página %d ---\n", pageNum))
		textContent.WriteString(text)
	}

	extractedText := textContent.String()
	if len(strings.TrimSpace(extractedText)) == 0 {
		return nil, fmt.Errorf("não foi possível extrair texto do PDF")
	}

	pf.FileType = FileTypePDF
	pf.Content = extractedText
	pf.IsBase64 = false

	fp.logger.Info("PDF processado",
		zap.String("name", pf.Name),
		zap.Int("pages", numPages),
		zap.Int("text_length", len(extractedText)),
	)

	return pf, nil
}

// DocxDocument estrutura para parsear documento Word
type DocxDocument struct {
	XMLName xml.Name `xml:"document"`
	Body    DocxBody `xml:"body"`
}

type DocxBody struct {
	Paragraphs []DocxParagraph `xml:"p"`
	Tables     []DocxTable     `xml:"tbl"`
}

type DocxParagraph struct {
	Runs []DocxRun `xml:"r"`
}

type DocxRun struct {
	Text string `xml:"t"`
}

type DocxTable struct {
	Rows []DocxTableRow `xml:"tr"`
}

type DocxTableRow struct {
	Cells []DocxTableCell `xml:"tc"`
}

type DocxTableCell struct {
	Paragraphs []DocxParagraph `xml:"p"`
}

// processDocx extrai texto de documentos Word
func (fp *FileProcessor) processDocx(pf *ProcessedFile, content []byte) (*ProcessedFile, error) {
	if int64(len(content)) > MaxDocSize {
		return nil, fmt.Errorf("documento excede o limite de %d MB", MaxDocSize/1024/1024)
	}

	// Abre o arquivo DOCX como ZIP
	zipReader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return nil, fmt.Errorf("erro ao abrir documento Word: %w", err)
	}

	// Procura pelo arquivo document.xml
	var documentXML []byte
	for _, file := range zipReader.File {
		if file.Name == "word/document.xml" {
			rc, err := file.Open()
			if err != nil {
				return nil, fmt.Errorf("erro ao abrir document.xml: %w", err)
			}
			documentXML, err = io.ReadAll(rc)
			rc.Close()
			if err != nil {
				return nil, fmt.Errorf("erro ao ler document.xml: %w", err)
			}
			break
		}
	}

	if len(documentXML) == 0 {
		return nil, fmt.Errorf("document.xml não encontrado no arquivo DOCX")
	}

	// Parseia o XML
	var doc DocxDocument
	if err := xml.Unmarshal(documentXML, &doc); err != nil {
		return nil, fmt.Errorf("erro ao parsear XML do documento: %w", err)
	}

	var textContent strings.Builder

	// Extrai texto dos parágrafos
	paragraphCount := 0
	for _, para := range doc.Body.Paragraphs {
		var paraText strings.Builder
		for _, run := range para.Runs {
			paraText.WriteString(run.Text)
		}
		text := paraText.String()
		if strings.TrimSpace(text) != "" {
			textContent.WriteString(text)
			textContent.WriteString("\n")
			paragraphCount++
		}
	}

	// Extrai texto das tabelas
	tableCount := 0
	for _, table := range doc.Body.Tables {
		textContent.WriteString(fmt.Sprintf("\n--- Tabela %d ---\n", tableCount+1))
		for _, row := range table.Rows {
			for _, cell := range row.Cells {
				for _, para := range cell.Paragraphs {
					var cellText strings.Builder
					for _, run := range para.Runs {
						cellText.WriteString(run.Text)
					}
					text := cellText.String()
					if strings.TrimSpace(text) != "" {
						textContent.WriteString(text)
						textContent.WriteString(" | ")
					}
				}
			}
			textContent.WriteString("\n")
		}
		tableCount++
	}

	extractedText := textContent.String()
	if len(strings.TrimSpace(extractedText)) == 0 {
		return nil, fmt.Errorf("documento Word está vazio")
	}

	pf.FileType = FileTypeDocx
	pf.Content = extractedText
	pf.IsBase64 = false
	pf.Metadata["paragraphs"] = paragraphCount
	pf.Metadata["tables"] = tableCount

	fp.logger.Info("Documento Word processado",
		zap.String("name", pf.Name),
		zap.Int("paragraphs", paragraphCount),
		zap.Int("tables", tableCount),
	)

	return pf, nil
}

// processXlsx extrai dados de planilhas Excel
func (fp *FileProcessor) processXlsx(pf *ProcessedFile, content []byte) (*ProcessedFile, error) {
	if int64(len(content)) > MaxDocSize {
		return nil, fmt.Errorf("planilha excede o limite de %d MB", MaxDocSize/1024/1024)
	}

	reader := bytes.NewReader(content)
	f, err := excelize.OpenReader(reader)
	if err != nil {
		return nil, fmt.Errorf("erro ao abrir planilha Excel: %w", err)
	}
	defer f.Close()

	var textContent strings.Builder
	sheets := f.GetSheetList()
	pf.Metadata["sheets"] = len(sheets)

	for _, sheetName := range sheets {
		textContent.WriteString(fmt.Sprintf("\n=== Planilha: %s ===\n", sheetName))

		rows, err := f.GetRows(sheetName)
		if err != nil {
			fp.logger.Warn("Erro ao ler planilha",
				zap.String("sheet", sheetName),
				zap.Error(err),
			)
			continue
		}

		for rowIndex, row := range rows {
			if rowIndex > 1000 { // Limite de 1000 linhas por planilha
				textContent.WriteString(fmt.Sprintf("\n... (mais %d linhas omitidas)\n", len(rows)-1000))
				break
			}

			for colIndex, cell := range row {
				if colIndex > 0 {
					textContent.WriteString(" | ")
				}
				textContent.WriteString(cell)
			}
			textContent.WriteString("\n")
		}
	}

	extractedText := textContent.String()
	if len(strings.TrimSpace(extractedText)) == 0 {
		return nil, fmt.Errorf("planilha Excel está vazia")
	}

	pf.FileType = FileTypeXlsx
	pf.Content = extractedText
	pf.IsBase64 = false

	fp.logger.Info("Planilha Excel processada",
		zap.String("name", pf.Name),
		zap.Int("sheets", len(sheets)),
	)

	return pf, nil
}

// processText processa arquivos de texto
func (fp *FileProcessor) processText(pf *ProcessedFile, content []byte, ext string) (*ProcessedFile, error) {
	text := string(content)

	// Detecta tipo específico de arquivo de texto
	switch ext {
	case ".json":
		pf.FileType = FileTypeJSON
	case ".yaml", ".yml":
		pf.FileType = FileTypeYAML
	case ".xml":
		pf.FileType = FileTypeXML
	case ".md", ".markdown":
		pf.FileType = FileTypeMarkdown
	case ".csv":
		pf.FileType = FileTypeCSV
	case ".go", ".js", ".ts", ".py", ".java", ".c", ".cpp", ".h", ".cs", ".rb", ".php":
		pf.FileType = FileTypeCode
		pf.Metadata["language"] = strings.TrimPrefix(ext, ".")
	default:
		pf.FileType = FileTypeText
	}

	pf.Content = text
	pf.IsBase64 = false
	pf.Metadata["lines"] = strings.Count(text, "\n") + 1

	fp.logger.Debug("Arquivo de texto processado",
		zap.String("name", pf.Name),
		zap.String("type", string(pf.FileType)),
		zap.Int("lines", pf.Metadata["lines"].(int)),
	)

	return pf, nil
}

// processBinary processa arquivos binários (como fallback)
func (fp *FileProcessor) processBinary(pf *ProcessedFile, content []byte) (*ProcessedFile, error) {
	// Para arquivos binários não suportados, retorna informações básicas
	pf.FileType = FileTypeBinary
	pf.Content = fmt.Sprintf("[Arquivo binário: %s - %d bytes - Tipo: %s]",
		pf.Name, pf.Size, pf.ContentType)
	pf.IsBase64 = false

	fp.logger.Warn("Arquivo binário não processado",
		zap.String("name", pf.Name),
		zap.String("type", pf.ContentType),
	)

	return pf, nil
}

// ValidateFileSize valida o tamanho do arquivo baseado no tipo
func (fp *FileProcessor) ValidateFileSize(size int64, contentType string) error {
	switch {
	case strings.HasPrefix(contentType, "image/"):
		if size > MaxImageSize {
			return fmt.Errorf("imagem excede o limite de %d MB", MaxImageSize/1024/1024)
		}
	case contentType == "application/pdf":
		if size > MaxPDFSize {
			return fmt.Errorf("PDF excede o limite de %d MB", MaxPDFSize/1024/1024)
		}
	case strings.Contains(contentType, "wordprocessingml") || strings.Contains(contentType, "spreadsheetml"):
		if size > MaxDocSize {
			return fmt.Errorf("documento excede o limite de %d MB", MaxDocSize/1024/1024)
		}
	}
	return nil
}
