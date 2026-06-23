import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { encrypt, decrypt } from './crypto.util.js';

/**
 * Input shape for creating a new Connected Account record.
 */
export interface CreateConnectedAccountInput {
  userId: string;
  provider: string;
  providerAccountId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  displayName: string;
}

/**
 * Display-safe shape returned by findAllByUser — never exposes tokens.
 */
export interface ConnectedAccountDisplay {
  provider: string;
  displayName: string;
  status: string;
  createdAt: Date;
}

@Injectable()
export class ConnectedAccountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new connected account record.
   * Encrypts accessToken and optional refreshToken before persisting.
   */
  async create(data: CreateConnectedAccountInput) {
    const encryptedAccessToken = encrypt(data.accessToken);
    const encryptedRefreshToken = data.refreshToken
      ? encrypt(data.refreshToken)
      : null;

    return this.prisma.connectedAccount.create({
      data: {
        userId: data.userId,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
        displayName: data.displayName,
      },
    });
  }

  /**
   * Find a connected account by userId and provider.
   * Returns the raw database record (including encrypted tokens).
   */
  async findByUserAndProvider(userId: string, provider: string) {
    return this.prisma.connectedAccount.findUnique({
      where: {
        userId_provider: { userId, provider },
      },
    });
  }

  /**
   * Find all connected accounts for a user.
   * Returns ONLY display-safe fields — never exposes tokens.
   */
  async findAllByUser(userId: string): Promise<ConnectedAccountDisplay[]> {
    return this.prisma.connectedAccount.findMany({
      where: { userId },
      select: {
        provider: true,
        displayName: true,
        status: true,
        createdAt: true,
      },
    });
  }

  /**
   * Delete (disconnect) a connected account record.
   */
  async disconnect(userId: string, provider: string): Promise<void> {
    await this.prisma.connectedAccount.delete({
      where: {
        userId_provider: { userId, provider },
      },
    });
  }

  /**
   * Mark a connected account as disconnected without deleting it.
   */
  async markDisconnected(userId: string, provider: string): Promise<void> {
    await this.prisma.connectedAccount.update({
      where: {
        userId_provider: { userId, provider },
      },
      data: { status: 'disconnected' },
    });
  }

  /**
   * Retrieve and decrypt the tokens for a connected account.
   */
  async getDecryptedToken(
    userId: string,
    provider: string,
  ): Promise<{ accessToken: string; refreshToken?: string }> {
    const account = await this.findByUserAndProvider(userId, provider);
    if (!account) {
      throw new Error(
        `No connected account found for user ${userId} and provider ${provider}`,
      );
    }

    const accessToken = decrypt(account.accessToken);
    const refreshToken = account.refreshToken
      ? decrypt(account.refreshToken)
      : undefined;

    return { accessToken, refreshToken };
  }
}
