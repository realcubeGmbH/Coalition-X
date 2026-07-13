/**
 * Auth Schemas
 *
 * Zod validation schemas for Authentication operations.
 */

import { z } from "zod";

// =============================================================================
// Login
// =============================================================================

export const LoginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

// =============================================================================
// Login with DID (Erfassungs App — email + digital identity, no password/2FA)
// =============================================================================

export const LoginWithDidSchema = z.object({
  email: z.string().email("Invalid email format"),
  did: z.string().min(1, "DID is required"),
});

export type LoginWithDidInput = z.infer<typeof LoginWithDidSchema>;

// =============================================================================
// Register
// =============================================================================

export const RegisterSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
  organizationName: z.string().optional(),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

// =============================================================================
// Refresh Token
// =============================================================================

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
