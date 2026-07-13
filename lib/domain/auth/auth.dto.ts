/**
 * Auth DTOs
 *
 * Data Transfer Objects for Authentication operations.
 */

import type { OrgType } from "@prisma/client";

// =============================================================================
// Input DTOs (Requests)
// =============================================================================

/**
 * DTO for user login
 */
export interface LoginDto {
  email: string;
  password: string;
}

/**
 * DTO for user login via email + DID (digital identity, no password)
 */
export interface LoginWithDidDto {
  email: string;
  did: string;
}

/**
 * DTO for user registration
 */
export interface RegisterDto {
  email: string;
  password: string;
  name: string;
  organizationName?: string;
}

/**
 * DTO for token refresh
 */
export interface RefreshTokenDto {
  refreshToken: string;
}

/**
 * DTO for API key token exchange
 */
export interface TokenExchangeDto {
  apiKey: string;
}

// =============================================================================
// Output DTOs (Responses)
// =============================================================================

/**
 * Basic user info in auth responses
 */
export interface AuthUserDto {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

/**
 * Organization info in auth responses
 */
export interface AuthOrganizationDto {
  id: string;
  name: string;
  type: OrgType;
}

/**
 * Token pair response
 */
export interface TokenPairDto {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/**
 * Login response
 */
export interface LoginResponseDto {
  user: AuthUserDto;
  organization: AuthOrganizationDto | null; // Null for SYSTEM_ADMIN users
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/**
 * Register response
 */
export interface RegisterResponseDto {
  user: AuthUserDto;
  organization: {
    id: string;
    name: string;
  };
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/**
 * Token exchange response (API key to OAuth)
 */
export interface TokenExchangeResponseDto {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  expiresAt: string;
  scope: string;
}

/**
 * Refresh token response
 */
export interface RefreshResponseDto {
  accessToken: string;
  expiresAt: string;
}
