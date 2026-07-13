/**
 * POST /api/auth/login-did
 * Erfassungs App Login (email + DID)
 *
 * Authenticates users with their email and digital identity (DID) — no
 * password or 2FA. The DID is validated against the accredited-partner
 * registry; on success OAuth tokens are returned and a session cookie set.
 */

import { NextRequest, NextResponse } from "next/server";
import { oauthService, OAuthError } from "@/lib/services";
import { LoginWithDidSchema } from "@/lib/domain/auth";
import { getClientIp, getUserAgent } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const dto = LoginWithDidSchema.parse(body);

    const result = await oauthService.loginWithDid(dto, {
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    // Create response with OAuth-style token response
    const response = NextResponse.json({
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      token_type: "Bearer",
      expires_in: 3600,
      expires_at: result.expiresAt,
      user: result.user,
      organization: result.organization,
    });

    // Set session cookie for web UI
    response.cookies.set("session", result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60, // 1 hour
      path: "/",
    });

    return response;
  } catch (error) {
    if (error instanceof OAuthError) {
      return NextResponse.json(error.toResponse(), { status: error.statusCode });
    }

    // Handle Zod validation errors
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Invalid request format" },
        { status: 400 }
      );
    }

    console.error("DID login error:", error);
    return NextResponse.json(
      { error: "server_error", error_description: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
