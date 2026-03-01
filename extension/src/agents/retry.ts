/**
 * PixelClaw Retry & Failsafe Utilities
 *
 * Provides exponential backoff retry, circuit breaker, and health check
 * primitives for resilient agent operations.
 */

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs: number;
  /** Multiplier for each subsequent delay (default: 2) */
  backoffMultiplier: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxDelayMs: number;
  /** Called on each retry with attempt number and error */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Predicate to decide if error is retryable (default: all errors) */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
};

/**
 * Execute an async function with exponential backoff retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Check if retryable
      if (opts.isRetryable && !opts.isRetryable(err)) {
        throw err;
      }

      if (attempt < opts.maxAttempts) {
        opts.onRetry?.(attempt, err);
        console.log(`[Retry] Attempt ${attempt}/${opts.maxAttempts} failed, retrying in ${delay}ms...`);
        await sleep(delay);
        delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
      }
    }
  }

  throw lastError;
}

/**
 * Execute with a timeout. Rejects if the operation takes too long.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label = 'Operation',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Try a primary function, fall back to alternatives on failure.
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallbacks: Array<() => Promise<T>>,
  label = 'Operation',
): Promise<T> {
  try {
    return await primary();
  } catch (primaryErr) {
    console.warn(`[Fallback] ${label} primary failed:`, primaryErr);

    for (let i = 0; i < fallbacks.length; i++) {
      try {
        console.log(`[Fallback] ${label} trying fallback ${i + 1}/${fallbacks.length}...`);
        return await fallbacks[i]();
      } catch (fbErr) {
        console.warn(`[Fallback] ${label} fallback ${i + 1} failed:`, fbErr);
      }
    }

    throw new Error(`${label}: all ${fallbacks.length + 1} attempts failed. Primary error: ${primaryErr}`);
  }
}

// ─── Circuit Breaker ────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 60000,
    private readonly halfOpenSuccessThreshold: number = 2,
  ) {}

  /**
   * Execute a function through the circuit breaker.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'half-open';
        this.successCount = 0;
        console.log('[CircuitBreaker] Transitioning to half-open');
      } else {
        throw new Error('Circuit breaker is OPEN — request rejected');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
        console.log('[CircuitBreaker] Circuit closed (recovered)');
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      console.log(`[CircuitBreaker] Circuit OPEN after ${this.failureCount} failures`);
    }
  }

  getState(): CircuitState { return this.state; }
  getFailureCount(): number { return this.failureCount; }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
  }
}

// ─── Health Check ───────────────────────────────────────────────────────────

export interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  modelCount?: number;
  loadedCount?: number;
  error?: string;
}

/**
 * Check if LM Studio API is reachable and responsive.
 */
export async function checkLmStudioHealth(
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs = 5000,
): Promise<HealthStatus> {
  const start = Date.now();
  try {
    const resp = await withTimeout(
      () => fetch(`${baseUrl}/api/v1/models`, { headers }),
      timeoutMs,
      'LM Studio health check',
    );

    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      return { healthy: false, latencyMs, error: `HTTP ${resp.status}` };
    }

    const body = await resp.json() as { models?: unknown[] };
    const models = body.models || [];
    const loaded = (models as Array<{ loaded_instances?: unknown[] }>)
      .filter(m => m.loaded_instances && (m.loaded_instances as unknown[]).length > 0);

    return {
      healthy: true,
      latencyMs,
      modelCount: models.length,
      loadedCount: loaded.length,
    };
  } catch (err) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
