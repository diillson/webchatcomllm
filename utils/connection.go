package utils

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

type ConnectionState int

const (
	StateConnecting ConnectionState = iota
	StateConnected
	StateReconnecting
	StateDisconnected
	StateClosed
)

type ConnectionConfig struct {
	MaxReconnectAttempts int
	InitialBackoff       time.Duration
	MaxBackoff           time.Duration
	PingInterval         time.Duration
	PongTimeout          time.Duration
	WriteTimeout         time.Duration
	ReadTimeout          time.Duration
	MessageQueueSize     int
}

func DefaultConnectionConfig() ConnectionConfig {
	return ConnectionConfig{
		MaxReconnectAttempts: 10,
		InitialBackoff:       time.Second,
		MaxBackoff:           30 * time.Second,
		PingInterval:         30 * time.Second,
		PongTimeout:          120 * time.Second,
		WriteTimeout:         45 * time.Second,
		ReadTimeout:          120 * time.Second,
		MessageQueueSize:     1000,
	}
}

type ManagedConnection struct {
	Conn           *websocket.Conn
	state          ConnectionState
	stateMu        sync.RWMutex
	config         ConnectionConfig
	logger         *zap.Logger
	SendQueue      chan []byte
	reconnectCount int
	lastPong       time.Time
	ctx            context.Context
	cancel         context.CancelFunc
	onStateChange  func(ConnectionState)
	circuitBreaker *CircuitBreaker
}

func NewManagedConnection(logger *zap.Logger, config ConnectionConfig) *ManagedConnection {
	ctx, cancel := context.WithCancel(context.Background())

	return &ManagedConnection{
		config:         config,
		logger:         logger,
		SendQueue:      make(chan []byte, config.MessageQueueSize),
		state:          StateDisconnected,
		ctx:            ctx,
		cancel:         cancel,
		lastPong:       time.Now(),
		circuitBreaker: NewCircuitBreaker(5, time.Minute),
	}
}

func (mc *ManagedConnection) SetConnection(conn *websocket.Conn) {
	mc.Conn = conn
	mc.setState(StateConnected)
	mc.reconnectCount = 0
	mc.lastPong = time.Now()

	mc.Conn.SetReadDeadline(time.Now().Add(mc.config.ReadTimeout))
	mc.Conn.SetPongHandler(func(string) error {
		mc.lastPong = time.Now()
		mc.Conn.SetReadDeadline(time.Now().Add(mc.config.ReadTimeout))
		return nil
	})
}

func (mc *ManagedConnection) GetState() ConnectionState {
	mc.stateMu.RLock()
	defer mc.stateMu.RUnlock()
	return mc.state
}

func (mc *ManagedConnection) setState(state ConnectionState) {
	mc.stateMu.Lock()
	oldState := mc.state
	mc.state = state
	mc.stateMu.Unlock()

	if oldState != state && mc.onStateChange != nil {
		mc.onStateChange(state)
	}

	mc.logger.Info("Connection state changed",
		zap.String("from", stateString(oldState)),
		zap.String("to", stateString(state)),
	)
}

func (mc *ManagedConnection) Send(data []byte) error {
	if mc.GetState() != StateConnected {
		return ErrNotConnected
	}

	if !mc.circuitBreaker.Allow() {
		return ErrCircuitOpen
	}

	select {
	case mc.SendQueue <- data:
		return nil
	case <-time.After(5 * time.Second):
		return ErrSendTimeout
	case <-mc.ctx.Done():
		return ErrConnectionClosed
	}
}

func (mc *ManagedConnection) StartHealthCheck() {
	ticker := time.NewTicker(mc.config.PingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if mc.GetState() != StateConnected {
				continue
			}

			if time.Since(mc.lastPong) > mc.config.PongTimeout {
				mc.logger.Warn("Pong timeout detected, connection may be dead")
				mc.circuitBreaker.RecordFailure()
				continue
			}

			if err := mc.sendPing(); err != nil {
				mc.logger.Error("Failed to send ping", zap.Error(err))
				mc.circuitBreaker.RecordFailure()
			} else {
				mc.circuitBreaker.RecordSuccess()
			}

		case <-mc.ctx.Done():
			return
		}
	}
}

func (mc *ManagedConnection) sendPing() error {
	if mc.Conn == nil {
		return ErrNotConnected
	}

	mc.Conn.SetWriteDeadline(time.Now().Add(mc.config.WriteTimeout))
	return mc.Conn.WriteMessage(websocket.PingMessage, nil)
}

func (mc *ManagedConnection) Close() error {
	mc.setState(StateClosed)
	mc.cancel()
	close(mc.SendQueue)

	if mc.Conn != nil {
		return mc.Conn.Close()
	}
	return nil
}

func stateString(state ConnectionState) string {
	switch state {
	case StateConnecting:
		return "CONNECTING"
	case StateConnected:
		return "CONNECTED"
	case StateReconnecting:
		return "RECONNECTING"
	case StateDisconnected:
		return "DISCONNECTED"
	case StateClosed:
		return "CLOSED"
	default:
		return "UNKNOWN"
	}
}

var (
	ErrNotConnected     = fmt.Errorf("connection not established")
	ErrCircuitOpen      = fmt.Errorf("circuit breaker is open")
	ErrSendTimeout      = fmt.Errorf("send operation timed out")
	ErrConnectionClosed = fmt.Errorf("connection is closed")
)
