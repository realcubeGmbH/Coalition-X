/**
 * Partner Sync Service
 *
 * Business logic for receiving accredited partner data from POM+.
 * Creates Organization + User with OAuth credentials automatically.
 */

import { accreditedPartnerRepository } from "@/lib/repositories/partner-request.repository";
import { organizationRepository } from "@/lib/repositories/organization.repository";
import { userRepository } from "@/lib/repositories/user.repository";
import { auditService } from "./audit.service";
import { ApiError } from "@/lib/core/ErrorHandler";
import { createClientCredentials } from "@/lib/auth";
import { hashToken } from "@/lib/auth/tokens";
import type { ServiceContext } from "@/lib/domain/shared";
import type { PartnerSyncDto, PartnerSyncResultDto } from "@/lib/domain/partner-request";

// =============================================================================
// Service Class
// =============================================================================

export class PartnerSyncService {
  constructor(
    private partnerRepo = accreditedPartnerRepository,
    private orgRepo = organizationRepository,
    private userRepo = userRepository
  ) {}

  /**
   * Process an inbound partner sync request from POM+.
   *
   * 1. Hash the initial_secret
   * 2. Create Organization (ACCREDITED_PARTNER, ACTIVE)
   * 3. Generate OAuth credentials for the new org
   * 4. Create User linked to the new org
   * 5. Store the AccreditedPartner sync record
   * 6. Audit log the entire operation
   */
  async sync(dto: PartnerSyncDto, ctx: ServiceContext): Promise<PartnerSyncResultDto> {
    const initialSecretHash = hashToken(dto.initial_secret);

    const existingUser = await this.userRepo.findByEmail(dto.email);
    if (existingUser) {
      throw ApiError.conflict(
        `User with email ${dto.email} already exists`
      );
    }

    const org = await this.orgRepo.create({
      name: dto.org_id,
      type: "ACCREDITED_PARTNER",
      status: "ACTIVE",
    });

    const credentials = await createClientCredentials(org.id);

    const user = await this.userRepo.create({
      email: dto.email.toLowerCase(),
      name: dto.user_id,
      passwordHash: initialSecretHash,
      role: "PARTNER_ADMIN",
      did: dto.did,
      organization: { connect: { id: org.id } },
    });

    const syncRecord = await this.partnerRepo.create({
      externalUserId: dto.user_id,
      email: dto.email.toLowerCase(),
      externalOrgId: dto.org_id,
      techProviderId: dto.tech_provider_id,
      userRole: dto.user_role,
      accreditationFlag: dto.accreditation_flag === "Yes",
      did: dto.did,
      initialSecretHash,
      externalTimestamp: new Date(dto.time_stamp),
      organizationId: org.id,
      userId: user.id,
      sourceOrganizationId: ctx.organizationId!,
    });

    await auditService.logEvent(ctx, {
      action: "PARTNER_SYNC_RECEIVED",
      resource: "accredited_partner",
      resourceId: syncRecord.id,
      method: "POST",
      endpoint: "/api/partner-requests",
      statusCode: 201,
      payload: {
        user_id: dto.user_id,
        email: dto.email,
        org_id: dto.org_id,
        tech_provider_id: dto.tech_provider_id,
        user_role: dto.user_role,
        accreditation_flag: dto.accreditation_flag,
        did: dto.did,
        initial_secret: "[REDACTED]",
        time_stamp: dto.time_stamp,
      },
      response: {
        syncId: syncRecord.id,
        organizationId: org.id,
        userId: user.id,
      },
    });

    return {
      syncId: syncRecord.id,
      organization: {
        id: org.id,
        name: org.name,
        clientId: org.clientId,
      },
      credentials: {
        clientId: org.clientId,
        clientSecret: credentials.clientSecret,
      },
      userId: user.id,
      message: "Accredited partner created successfully.",
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const partnerSyncService = new PartnerSyncService();
