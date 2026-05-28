/**
 * Error handling utilities for GeoIntelliSense
 * Provides structured error types, error codes, and retry logic
 */

/**
 * Error codes for categorizing different types of errors
 */
export enum ErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_KEY_INVALID = 'API_KEY_INVALID',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  DATA_NOT_FOUND = 'DATA_NOT_FOUND',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  SERVER_ERROR = 'SERVER_ERROR',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  GEOLOCATION_ERROR = 'GEOLOCATION_ERROR',
  PARSE_ERROR = 'PARSE_ERROR'
}

/**
 * Custom error class for data service errors
 */
export class DataServiceError extends Error {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly details?: unknown;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: ErrorCode,
    retryable: boolean = false,
    details?: unknown
  ) {
    super(message);
    this.name = 'DataServiceError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    this.timestamp = new Date();

    // Maintains proper stack trace for where error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DataServiceError);
    }
  }

  /**
   * Creates a user-friendly message based on the error code
   */
  getUserMessage(): string {
    switch (this.code) {
      case ErrorCode.NETWORK_ERROR:
        return 'Unable to connect. Please check your internet connection.';
      case ErrorCode.API_KEY_INVALID:
        return 'Authentication failed. Please check your API configuration.';
      case ErrorCode.RATE_LIMIT_EXCEEDED:
        return 'Too many requests. Please wait a moment and try again.';
      case ErrorCode.DATA_NOT_FOUND:
        return 'The requested data is not available.';
      case ErrorCode.INVALID_PARAMETERS:
        return 'Invalid request parameters. Please check your input.';
      case ErrorCode.SERVER_ERROR:
        return 'Server error. Our team has been notified.';
      case ErrorCode.TIMEOUT:
        return 'Request timed out. Please try again.';
      case ErrorCode.GEOLOCATION_ERROR:
        return 'Unable to get your location. Please enable location services.';
      case ErrorCode.PARSE_ERROR:
        return 'Unable to process the response. Please try again.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }

  /**
   * Converts the error to a JSON-serializable object
   */
  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      details: this.details,
      timestamp: this.timestamp.toISOString()
    };
  }
}

/**
 * Determines if an error is retryable based on its type
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof DataServiceError) {
    return error.retryable;
  }
  
  // Network errors are generally retryable
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  
  return false;
}

/**
 * Converts an unknown error to a DataServiceError
 */
export function toDataServiceError(error: unknown): DataServiceError {
  if (error instanceof DataServiceError) {
    return error;
  }

  if (error instanceof Error) {
    // Check for common error patterns
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return new DataServiceError(
        error.message,
        ErrorCode.NETWORK_ERROR,
        true,
        error
      );
    }
    
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return new DataServiceError(
        error.message,
        ErrorCode.TIMEOUT,
        true,
        error
      );
    }

    if (error.message.includes('401') || error.message.includes('403')) {
      return new DataServiceError(
        error.message,
        ErrorCode.API_KEY_INVALID,
        false,
        error
      );
    }

    if (error.message.includes('429')) {
      return new DataServiceError(
        error.message,
        ErrorCode.RATE_LIMIT_EXCEEDED,
        true,
        error
      );
    }

    if (error.message.includes('404')) {
      return new DataServiceError(
        error.message,
        ErrorCode.DATA_NOT_FOUND,
        false,
        error
      );
    }

    if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
      return new DataServiceError(
        error.message,
        ErrorCode.SERVER_ERROR,
        true,
        error
      );
    }

    return new DataServiceError(
      error.message,
      ErrorCode.UNKNOWN_ERROR,
      false,
      error
    );
  }

  return new DataServiceError(
    'An unknown error occurred',
    ErrorCode.UNKNOWN_ERROR,
    false,
    error
  );
}

/**
 * Options for retry logic
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2
};

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with retry logic using exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on the last attempt or if the error is not retryable
      if (attempt >= opts.maxRetries || !isRetryable(error)) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.initialDelay * Math.pow(opts.backoffFactor, attempt),
        opts.maxDelay
      );

      // Call the onRetry callback if provided
      opts.onRetry?.(attempt + 1, lastError, delay);

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Creates a fetch wrapper with timeout support
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new DataServiceError(
        'Request timed out',
        ErrorCode.TIMEOUT,
        true
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Safe JSON parse with error handling
 */
export function safeJsonParse<T>(json: string, fallback?: T): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new DataServiceError(
      'Failed to parse JSON response',
      ErrorCode.PARSE_ERROR,
      false,
      error
    );
  }
}

/**
 * Error logger for development and production environments
 */
export function logError(error: unknown, context?: string): void {
  const timestamp = new Date().toISOString();
  const prefix = context ? `[${context}]` : '';
  
  if (error instanceof DataServiceError) {
    console.error(`${timestamp} ${prefix} DataServiceError:`, error.toJSON());
  } else if (error instanceof Error) {
    console.error(`${timestamp} ${prefix} Error:`, {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  } else {
    console.error(`${timestamp} ${prefix} Unknown error:`, error);
  }

  // In production, you would send this to an error tracking service
  // e.g., Sentry, LogRocket, etc.
}
