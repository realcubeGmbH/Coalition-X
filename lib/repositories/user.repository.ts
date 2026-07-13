/**
 * User Repository
 *
 * Data access layer for User operations.
 */

import prisma from "@/lib/prisma";
import type { User, Prisma } from "@prisma/client";

// =============================================================================
// Types
// =============================================================================

export type UserWithOrganization = User & {
  organization: {
    id: string;
    name: string;
    type: string;
    status: string;
  } | null; // Null for SYSTEM_ADMIN users
};

// =============================================================================
// Repository Class
// =============================================================================

export class UserRepository {
  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  /**
   * Find user by email with organization
   */
  async findByEmailWithOrg(email: string): Promise<UserWithOrganization | null> {
    return prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
          },
        },
      },
    });
  }

  /**
   * Find user by email + DID (digital identity), with organization.
   * Used to authenticate Erfassungs App logins (email + DID, no password).
   */
  async findByEmailAndDid(
    email: string,
    did: string
  ): Promise<UserWithOrganization | null> {
    return prisma.user.findFirst({
      where: { email: email.toLowerCase(), did },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
          },
        },
      },
    });
  }

  /**
   * Check if email exists
   */
  async emailExists(email: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    return !!user;
  }

  /**
   * Create a new user
   */
  async create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  }

  /**
   * Create user with organization in a transaction
   */
  async createWithOrganization(params: {
    email: string;
    name: string;
    passwordHash: string;
    organizationName: string;
  }): Promise<{
    user: User;
    organization: { id: string; name: string };
  }> {
    return prisma.$transaction(async (tx) => {
      // Create organization (CLIENT type for self-registration)
      const organization = await tx.organization.create({
        data: {
          name: params.organizationName,
          type: "CLIENT",
          status: "ACTIVE",
        },
      });

      // Create user
      const user = await tx.user.create({
        data: {
          email: params.email.toLowerCase(),
          name: params.name,
          passwordHash: params.passwordHash,
          role: "CLIENT_ADMIN", // First user is admin
          organizationId: organization.id,
        },
      });

      return {
        user,
        organization: {
          id: organization.id,
          name: organization.name,
        },
      };
    });
  }

  /**
   * Update user
   */
  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const userRepository = new UserRepository();
