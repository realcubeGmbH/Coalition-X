/**
 * Centralized Error Handler
 * 
 * Features:
 * - Typed error codes
 * - HTTP status code mapping
 * - Structured error responses
 * - Factory methods for common errors
 */

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

// =============================================================================
// Error Codes
// =============================================================================

export enum ErrorCode {
  // Validation
  VALIDATION_ERROR = "VALIDATION_ERROR",
  SCHEMA_NOT_FOUND = "SCHEMA_NOT_FOUND",
  SCHEMA_INACTIVE = "SCHEMA_INACTIVE",
  INVALID_JSON = "INVALID_JSON",
  MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",

  // Authentication
  UNAUTHORIZED = "UNAUTHORIZED",
  INVALID_TOKEN = "INVALID_TOKEN",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  MISSING_API_KEY = "MISSING_API_KEY",
  INVALID_API_KEY = "INVALID_API_KEY",

  // Authorization
  FORBIDDEN = "FORBIDDEN",
  INSUFFICIENT_SCOPE = "INSUFFICIENT_SCOPE",
  NOT_ACCREDITED = "NOT_ACCREDITED",

  // Resources
  NOT_FOUND = "NOT_FOUND",
  ASSET_NOT_FOUND = "ASSET_NOT_FOUND",
  DUPLICATE = "DUPLICATE",
  DUPLICATE_EXTERNAL_ID = "DUPLICATE_EXTERNAL_ID",
  CONFLICT = "CONFLICT",

  // Rate Limiting
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  // System
  DATABASE_ERROR = "DATABASE_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
}

// =============================================================================
// Error Response Type
// =============================================================================

export interface ErrorResponse {
  error: boolean;
  code: ErrorCode;
  message: string;
  details?: unknown;
  transactionId?: string;
  timestamp: string;
}

// =============================================================================
// ApiError Class
// =============================================================================

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly transactionId?: string;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 400,
    details?: unknown,
    transactionId?: string
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.transactionId = transactionId;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  // ===========================================================================
  // Factory Methods - Validation
  // ===========================================================================

  static validation(message: string, details?: unknown): ApiError {
    return new ApiError(ErrorCode.VALIDATION_ERROR, message, 400, details);
  }

  static invalidJson(message = "Invalid JSON body"): ApiError {
    return new ApiError(ErrorCode.INVALID_JSON, message, 400);
  }

  static schemaNotFound(version: string): ApiError {
    return new ApiError(
      ErrorCode.SCHEMA_NOT_FOUND,
      `Schema version "${version}" not found`,
      400
    );
  }

  static schemaInactive(version: string): ApiError {
    return new ApiError(
      ErrorCode.SCHEMA_INACTIVE,
      `Schema version "${version}" is not active`,
      400
    );
  }

  static missingField(field: string): ApiError {
    return new ApiError(
      ErrorCode.MISSING_REQUIRED_FIELD,
      `Missing required field: ${field}`,
      400,
      { field }
    );
  }

  // ===========================================================================
  // Factory Methods - Authentication
  // ===========================================================================

  static unauthorized(message = "Unauthorized"): ApiError {
    return new ApiError(ErrorCode.UNAUTHORIZED, message, 401);
  }

  static invalidToken(message = "Invalid or expired token"): ApiError {
    return new ApiError(ErrorCode.INVALID_TOKEN, message, 401);
  }

  static tokenExpired(): ApiError {
    return new ApiError(ErrorCode.TOKEN_EXPIRED, "Token has expired", 401);
  }

  static missingApiKey(): ApiError {
    return new ApiError(ErrorCode.MISSING_API_KEY, "Missing X-API-Key header", 401);
  }

  static invalidApiKey(): ApiError {
    return new ApiError(ErrorCode.INVALID_API_KEY, "Invalid or revoked API key", 401);
  }

  // ===========================================================================
  // Factory Methods - Authorization
  // ===========================================================================

  static forbidden(message = "Access forbidden"): ApiError {
    return new ApiError(ErrorCode.FORBIDDEN, message, 403);
  }

  static insufficientScope(requiredScopes: string[]): ApiError {
    return new ApiError(
      ErrorCode.INSUFFICIENT_SCOPE,
      `Missing required scope(s): ${requiredScopes.join(", ")}`,
      403,
      { requiredScopes }
    );
  }

  static notAccredited(): ApiError {
    return new ApiError(
      ErrorCode.NOT_ACCREDITED,
      "API access requires Accredited Partner status",
      403
    );
  }

  // ===========================================================================
  // Factory Methods - Resources
  // ===========================================================================

  static notFound(resource: string, id?: string): ApiError {
    const message = id ? `${resource} "${id}" not found` : `${resource} not found`;
    return new ApiError(ErrorCode.NOT_FOUND, message, 404);
  }

  static assetNotFound(assetId: string): ApiError {
    return new ApiError(
      ErrorCode.ASSET_NOT_FOUND,
      `Asset "${assetId}" not found or access denied`,
      404
    );
  }

  static conflict(message: string): ApiError {
    return new ApiError(ErrorCode.CONFLICT, message, 409);
  }

  static duplicate(resource: string, field?: string): ApiError {
    const message = field
      ? `${resource} with this ${field} already exists`
      : `${resource} already exists`;
    return new ApiError(ErrorCode.DUPLICATE, message, 409, { field });
  }

  static duplicateExternalId(externalId: string): ApiError {
    return new ApiError(
      ErrorCode.DUPLICATE_EXTERNAL_ID,
      `Asset with externalId "${externalId}" already exists`,
      409,
      { externalId }
    );
  }

  // ===========================================================================
  // Factory Methods - Rate Limiting
  // ===========================================================================

  static rateLimitExceeded(retryAfter?: number): ApiError {
    const error = new ApiError(
      ErrorCode.RATE_LIMIT_EXCEEDED,
      "Rate limit exceeded. Please try again later.",
      429
    );
    if (retryAfter) {
      (error as { retryAfter?: number }).retryAfter = retryAfter;
    }
    return error;
  }

  // ===========================================================================
  // Factory Methods - System
  // ===========================================================================

  static internal(message = "An unexpected error occurred"): ApiError {
    return new ApiError(ErrorCode.INTERNAL_ERROR, message, 500);
  }

  static databaseError(message = "Database operation failed"): ApiError {
    return new ApiError(ErrorCode.DATABASE_ERROR, message, 500);
  }

  static serviceUnavailable(service?: string): ApiError {
    const message = service ? `${service} is temporarily unavailable` : "Service temporarily unavailable";
    return new ApiError(ErrorCode.SERVICE_UNAVAILABLE, message, 503);
  }

  // ===========================================================================
  // Response Methods
  // ===========================================================================

  /**
   * Convert error to JSON response object
   */
  toResponse(): ErrorResponse {
    return {
      error: true,
      code: this.code,
      message: this.message,
      ...(this.details !== undefined && { details: this.details }),
      ...(this.transactionId && { transactionId: this.transactionId }),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Convert error to NextResponse
   */
  toNextResponse(): NextResponse<ErrorResponse> {
    const headers: HeadersInit = {};
    
    // Add Retry-After header for rate limiting
    if (this.code === ErrorCode.RATE_LIMIT_EXCEEDED && (this as { retryAfter?: number }).retryAfter) {
      headers["Retry-After"] = String((this as { retryAfter?: number }).retryAfter);
    }

    return NextResponse.json(this.toResponse(), {
      status: this.statusCode,
      headers,
    });
  }

  /**
   * Set transaction ID for tracking
   */
  withTransactionId(transactionId: string): ApiError {
    return new ApiError(
      this.code,
      this.message,
      this.statusCode,
      this.details,
      transactionId
    );
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Whether an error is a unique-constraint violation (Prisma P2002), optionally
 * on a specific column. Lets callers turn a race into a proper conflict instead
 * of letting the driver error escape.
 */
export function isUniqueConstraintError(
  error: unknown,
  field?: string,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  if (!field) return true;
  const target = error.meta?.target;
  return Array.isArray(target) && target.includes(field);
}

/**
 * Convert any error to an ApiError.
 *
 * Prisma errors are mapped explicitly: they used to fall through to
 * `internal(error.message)`, which answered a duplicate idempotency key with a
 * 500 quoting the raw driver text ("Unique constraint failed on the fields:
 * (`idempotencyKey`)") — wrong status, and it leaks column names.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = error.meta?.target;
      const field = Array.isArray(target) ? target.join(", ") : undefined;
      return ApiError.duplicate("Record", field);
    }
    if (error.code === "P2025") {
      return ApiError.notFound("Record");
    }
    return ApiError.databaseError();
  }

  if (error instanceof Error) {
    return ApiError.internal(error.message);
  }

  return ApiError.internal();
}

/**
 * Handle error and return NextResponse
 */
export function handleError(error: unknown): NextResponse<ErrorResponse> {
  const apiError = toApiError(error);
  return apiError.toNextResponse();
}

