package utils

import (
	"sync"
	"time"
)

type CircuitState int

const (
	CircuitClosed CircuitState = iota
	CircuitOpen
	CircuitHalfOpen
)

type CircuitBreaker struct {
	mu           sync.RWMutex
	state        CircuitState
	failureCount int
	successCount int
	threshold    int
	timeout      time.Duration
	nextAttempt  time.Time
}

func NewCircuitBreaker(threshold int, timeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		state:     CircuitClosed,
		threshold: threshold,
		timeout:   timeout,
	}
}

func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case CircuitClosed:
		return true

	case CircuitOpen:
		if time.Now().After(cb.nextAttempt) {
			cb.state = CircuitHalfOpen
			cb.successCount = 0
			return true
		}
		return false

	case CircuitHalfOpen:
		return true

	default:
		return false
	}
}

func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failureCount = 0

	if cb.state == CircuitHalfOpen {
		cb.successCount++
		if cb.successCount >= 3 {
			cb.state = CircuitClosed
		}
	}
}

func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failureCount++

	if cb.state == CircuitHalfOpen {
		cb.state = CircuitOpen
		cb.nextAttempt = time.Now().Add(cb.timeout)
		return
	}

	if cb.failureCount >= cb.threshold {
		cb.state = CircuitOpen
		cb.nextAttempt = time.Now().Add(cb.timeout)
	}
}

func (cb *CircuitBreaker) GetState() CircuitState {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}
