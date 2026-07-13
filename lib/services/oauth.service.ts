/**
 * OAuth Service
 *
 * Unified business logic layer for all OAuth 2.0 and authentication operations.
 * Consolidates user auth (login/register/logout) with OAuth grants.
 */

import { apiTokenRepository } from "@/lib/repositories/api-token.repository";
import { userRepository } from "@/lib/repositories/user.repository";
import { auditService } from "./audit.service";
import {
  validateClientCredentials,
  validateApiKey,
  DEFAULT_PARTNER_SCOPES,
  filterValidOAuthScopes,
  createTokenPair,
  refreshAccessToken,
  verifyAccessToken,
  hashToken,
  verifyPassword,
  hashPassword,
  validatePasswordStrength,
  ROLE_SCOPES,
  type TokenScope,
} from "@/lib/auth";
import type {
  OAuthTokenResponseDto,
  IntrospectionResponseDto,
} from "@/lib/domain/oauth";
import type {
  LoginDto,
  LoginWithDidDto,
  RegisterDto,
  LoginResponseDto,
  RegisterResponseDto,
  AuthOrganizationDto,
} from "@/lib/domain/auth";
import type { OrgType } from "@prisma/client";

// =============================================================================
// Types
// =============================================================================

interface OAuthContext {
  ipAddress: string;
  userAgent: string | null;
}

// =============================================================================
// Service Class
// =============================================================================

export class OAuthService {
  constructor(
    private tokenRepo = apiTokenRepository,
    private userRepo = userRepository
  ) {}

  // ===========================================================================
  // User Authentication (Login/Register/Logout)
  // ===========================================================================

  /**
   * Authenticate user with email and password
   */
  async login(dto: LoginDto, ctx: OAuthContext): Promise<LoginResponseDto> {
    // Find user with organization
    const user = await this.userRepo.findByEmailWithOrg(dto.email);

    // Generic error to prevent user enumeration
    if (!user) {
      throw new OAuthError("invalid_grant", "Invalid email or password", 401);
    }

    // Verify password
    const isValidPassword = await verifyPassword(dto.password, user.passwordHash);
    if (!isValidPassword) {
      // Log failed attempt
      await auditService.log({
        organizationId: user.organizationId,
        userId: user.id,
        action: "AUTH_FAILED",
        resource: "user",
        resourceId: user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      throw new OAuthError("invalid_grant", "Invalid email or password", 401);
    }

    // System admins don't need organization checks
    const isSystemAdmin = user.role === "SYSTEM_ADMIN";

    // For non-system-admin users, check organization status
    if (!isSystemAdmin) {
      if (!user.organization) {
        throw new OAuthError("access_denied", "User has no associated organization", 403);
      }
      if (user.organization.status !== "ACTIVE") {
        throw new OAuthError("access_denied", "Organization is not active", 403);
      }
    }

    // Get scopes based on role
    const scopes = this.getScopesForRole(user.role);

    // Generate tokens (organizationId is null for system admins)
    const tokens = await createTokenPair({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      scopes,
      name: "Web login",
      ipAddress: ctx.ipAddress,
    });

    // Log successful login
    await auditService.log({
      organizationId: user.organizationId,
      userId: user.id,
      action: "AUTH_LOGIN",
      resource: "user",
      resourceId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const organization: AuthOrganizationDto | null = isSystemAdmin
      ? null
      : {
          id: user.organization!.id,
          name: user.organization!.name,
          type: user.organization!.type as OrgType,
        };

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      organization,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt.toISOString(),
    };
  }

  /**
   * Authenticate a user with email + DID (digital identity).
   *
   * Used by the Erfassungs App. The DID is stored on the User (set at POM+
   * sync time) and validated directly against it — on a match we issue
   * tokens for that user. No password / 2FA.
   */
  async loginWithDid(dto: LoginWithDidDto, ctx: OAuthContext): Promise<LoginResponseDto> {
    // Validate the email + DID pair directly against the user record
    const user = await this.userRepo.findByEmailAndDid(dto.email, dto.did);

    // Generic error to prevent enumeration of emails / DIDs
    if (!user) {
      throw new OAuthError("invalid_grant", "Invalid email or DID", 401);
    }

    // System admins don't need organization checks
    const isSystemAdmin = user.role === "SYSTEM_ADMIN";

    // For non-system-admin users, check organization status
    if (!isSystemAdmin) {
      if (!user.organization) {
        throw new OAuthError("access_denied", "User has no associated organization", 403);
      }
      if (user.organization.status !== "ACTIVE") {
        throw new OAuthError("access_denied", "Organization is not active", 403);
      }
    }

    // Get scopes based on role
    const scopes = this.getScopesForRole(user.role);

    // Generate tokens (organizationId is null for system admins)
    const tokens = await createTokenPair({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      scopes,
      name: "Erfassungs DID login",
      ipAddress: ctx.ipAddress,
    });

    // Log successful login
    await auditService.log({
      organizationId: user.organizationId,
      userId: user.id,
      action: "AUTH_LOGIN",
      resource: "user",
      resourceId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const organization: AuthOrganizationDto | null = isSystemAdmin
      ? null
      : {
          id: user.organization!.id,
          name: user.organization!.name,
          type: user.organization!.type as OrgType,
        };

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      organization,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt.toISOString(),
    };
  }

  /**
   * Register a new user and organization
   */
  async register(dto: RegisterDto, ctx: OAuthContext): Promise<RegisterResponseDto> {
    // Check if email already exists
    if (await this.userRepo.emailExists(dto.email)) {
      throw new OAuthError("invalid_request", "User with this email already exists", 400);
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(dto.password);
    if (!passwordValidation.valid) {
      throw new OAuthError(
        "invalid_request",
        `Password requirements: ${passwordValidation.errors.join(", ")}`,
        400
      );
    }

    // Hash password
    const passwordHash = await hashPassword(dto.password);

    // Create user with organization
    const result = await this.userRepo.createWithOrganization({
      email: dto.email,
      name: dto.name,
      passwordHash,
      organizationName: dto.organizationName || `${dto.name}'s Organization`,
    });

    // Generate tokens
    const tokens = await createTokenPair({
      userId: result.user.id,
      organizationId: result.organization.id,
      role: result.user.role,
      scopes: ["assets:read", "assets:write", "kpis:read", "kpis:write"],
      name: "Initial login",
      ipAddress: ctx.ipAddress,
    });

    // Log registration
    await auditService.log({
      organizationId: result.organization.id,
      userId: result.user.id,
      action: "AUTH_LOGIN",
      resource: "user",
      resourceId: result.user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
      },
      organization: {
        id: result.organization.id,
        name: result.organization.name,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt.toISOString(),
    };
  }

  /**
   * Log user logout (audit only, actual token invalidation happens via cookie)
   */
  async logout(
    userId: string | null,
    organizationId: string | null,
    ctx: OAuthContext
  ): Promise<void> {
    if (organizationId) {
      await auditService.log({
        organizationId,
        userId,
        action: "AUTH_LOGOUT",
        resource: "user",
        resourceId: userId || undefined,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }
  }

  // ===========================================================================
  // Client Credentials Grant
  // ===========================================================================

  /**
   * Handle client_credentials grant
   */
  async clientCredentialsGrant(
    clientId: string,
    clientSecret: string,
    scope: string | undefined,
    ctx: OAuthContext
  ): Promise<OAuthTokenResponseDto> {
    // Validate credentials
    const result = await validateClientCredentials(clientId, clientSecret);

    if (!result.valid || !result.organization) {
      console.warn(
        `OAuth: Invalid client credentials attempt for ${clientId} from ${ctx.ipAddress}`
      );
      throw new OAuthError("invalid_client", "Invalid client credentials", 401);
    }

    const { organization } = result;

    // Check organization type
    if (organization.type !== "ACCREDITED_PARTNER") {
      throw new OAuthError(
        "unauthorized_client",
        "Client not authorized for this grant type",
        403
      );
    }

    // Parse requested scopes
    const requestedScopes = scope
      ? filterValidOAuthScopes(scope.split(" "))
      : [...DEFAULT_PARTNER_SCOPES];

    // Enforce restricted scopes — only the designated POM+ org can request partner:org-sync
    const restrictedScopes = this.getRestrictedScopes();
    const deniedScopes = requestedScopes.filter(
      (s) => restrictedScopes.includes(s) && !this.isAllowedRestrictedScope(organization.id, s)
    );
    if (deniedScopes.length > 0) {
      throw new OAuthError(
        "invalid_scope",
        `Your organization is not authorized for scope(s): ${deniedScopes.join(", ")}`,
        403
      );
    }

    // Generate tokens
    const tokens = await createTokenPair({
      userId: `org:${organization.id}`,
      organizationId: organization.id,
      role: "PARTNER_API",
      scopes: requestedScopes,
      name: "OAuth Client Credentials",
      ipAddress: ctx.ipAddress,
    });

    // Audit log
    await auditService.log({
      organizationId: organization.id,
      action: "API_TOKEN_CREATED",
      resource: "oauth_token",
      method: "POST",
      endpoint: "/api/oauth/token",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      payload: { grant_type: "client_credentials", scopes: requestedScopes },
    });

    return {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: tokens.refreshToken,
      scope: requestedScopes.join(" "),
    };
  }

  // ===========================================================================
  // API Key Grant (Legacy/Backward Compatibility)
  // ===========================================================================

  /**
   * Handle api_key grant - exchange API key for OAuth tokens
   * Supports both grant_type=api_key and X-API-Key header for backward compat
   */
  async apiKeyGrant(
    apiKey: string,
    ctx: OAuthContext
  ): Promise<OAuthTokenResponseDto> {
    // Validate API key
    const organization = await validateApiKey(apiKey);

    if (!organization) {
      console.warn(`OAuth: Invalid API key attempt from ${ctx.ipAddress}`);
      throw new OAuthError("invalid_client", "Invalid or revoked API key", 401);
    }

    // Check organization type
    if (organization.type !== "ACCREDITED_PARTNER") {
      throw new OAuthError(
        "unauthorized_client",
        "API access requires Accredited Partner status",
        403
      );
    }

    // Define scopes for partner API access
    const scopes: TokenScope[] = ["assets:read", "assets:write", "kpis:read", "kpis:write"];

    // Generate tokens
    const tokens = await createTokenPair({
      userId: `org:${organization.id}`,
      organizationId: organization.id,
      role: "PARTNER_API",
      scopes,
      name: "API key exchange",
      ipAddress: ctx.ipAddress,
    });

    // Log token creation
    await auditService.log({
      organizationId: organization.id,
      action: "API_TOKEN_CREATED",
      resource: "api_token",
      method: "POST",
      endpoint: "/api/oauth/token",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      payload: { grant_type: "api_key" },
    });

    return {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: tokens.refreshToken,
      scope: scopes.join(" "),
    };
  }

  // ===========================================================================
  // Refresh Token Grant
  // ===========================================================================

  /**
   * Handle refresh_token grant
   */
  async refreshTokenGrant(refreshToken: string): Promise<OAuthTokenResponseDto> {
    const result = await refreshAccessToken(refreshToken);

    if (!result) {
      throw new OAuthError(
        "invalid_grant",
        "Invalid or expired refresh token",
        401
      );
    }

    return {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
    };
  }

  // ===========================================================================
  // Token Revocation (RFC 7009)
  // ===========================================================================

  /**
   * Revoke a token
   * Per RFC 7009, always returns success even if token is invalid
   */
  async revokeToken(
    token: string,
    _tokenTypeHint: string | undefined,
    ctx: OAuthContext
  ): Promise<void> {
    try {
      const tokenHash = hashToken(token);

      // Find token by either access token hash or refresh token hash
      const tokenRecord = await this.tokenRepo.findByAnyHash(tokenHash);

      if (tokenRecord) {
        // Revoke the token
        await this.tokenRepo.revoke(tokenRecord.id, "oauth_revoke");

        // Audit log
        await auditService.log({
          organizationId: tokenRecord.organizationId,
          userId: tokenRecord.userId,
          action: "API_TOKEN_REVOKED",
          resource: "oauth_token",
          resourceId: tokenRecord.id,
          method: "POST",
          endpoint: "/api/oauth/revoke",
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
      }
    } catch (error) {
      // Per RFC 7009, errors should be silent
      console.error("Token revocation error:", error);
    }
  }

  // ===========================================================================
  // Token Introspection (RFC 7662)
  // ===========================================================================

  /**
   * Introspect a token
   */
  async introspectToken(token: string): Promise<IntrospectionResponseDto> {
    // Verify the JWT
    const payload = await verifyAccessToken(token);

    if (!payload) {
      return { active: false };
    }

    // Check if token exists and is not revoked in DB
    const tokenHash = hashToken(token);
    const tokenRecord = await this.tokenRepo.findByTokenHashWithOrg(tokenHash);

    if (!tokenRecord) {
      return { active: false };
    }

    // Check organization is still active
    if (tokenRecord.organization.status !== "ACTIVE") {
      return { active: false };
    }

    // Return introspection response
    return {
      active: true,
      scope: payload.scopes.join(" "),
      client_id: tokenRecord.organization.clientId,
      username: payload.sub,
      token_type: "Bearer",
      exp: payload.exp,
      iat: payload.iat,
      iss: payload.iss,
      aud: Array.isArray(payload.aud) ? payload.aud[0] : payload.aud,
      sub: payload.sub,
      org_id: payload.orgId ?? undefined,
      role: payload.role,
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Get scopes based on user role using centralized ROLE_SCOPES mapping
   */
  private getScopesForRole(role: string): TokenScope[] {
    return ROLE_SCOPES[role] || ["assets:read", "kpis:read"];
  }

  /**
   * Scopes that are restricted to specific organizations.
   * Any scope listed here will be rejected unless the org is explicitly allowed.
   */
  private getRestrictedScopes(): string[] {
    return ["partner:org-sync"];
  }

  /**
   * Check whether a specific organization is allowed a restricted scope.
   * POM+ org ID is configured via POM_PARTNER_ORG_ID env variable.
   */
  private isAllowedRestrictedScope(orgId: string, scope: string): boolean {
    const pomOrgId = process.env.POM_PARTNER_ORG_ID;
    if (scope === "partner:org-sync") {
      return !!pomOrgId && orgId === pomOrgId;
    }
    return false;
  }
}

// =============================================================================
// OAuth Error Class
// =============================================================================

export class OAuthError extends Error {
  constructor(
    public error: string,
    public errorDescription: string,
    public statusCode: number = 400
  ) {
    super(errorDescription);
    this.name = "OAuthError";
  }

  toResponse() {
    return {
      error: this.error,
      error_description: this.errorDescription,
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const oauthService = new OAuthService();
