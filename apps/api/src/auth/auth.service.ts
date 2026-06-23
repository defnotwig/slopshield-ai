import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import * as jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtExpiration: string;
  private readonly refreshSecret: string;
  private readonly refreshExpiration: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    // Production must supply real secrets; env validation (Req 11.3) enforces
    // that JWT_SECRET and REFRESH_SECRET are present and distinct in prod, so
    // no insecure literal fallback is used here. Outside production the dev
    // defaults keep local/test runs working without secret-shaped literals.
    const isProduction = this.configService.get<string>("NODE_ENV") === "production";

    this.jwtSecret = this.resolveSecret("JWT_SECRET", isProduction, "dev-access");
    this.jwtExpiration = this.configService.get<string>(
      "JWT_EXPIRATION",
      "15m",
    );
    this.refreshSecret = this.resolveSecret(
      "REFRESH_SECRET",
      isProduction,
      "dev-refresh",
    );
    this.refreshExpiration = this.configService.get<string>(
      "REFRESH_EXPIRATION",
      "7d",
    );
  }

  /**
   * Resolves a signing secret from the environment. In production the secret
   * MUST be configured (no literal fallback); outside production a clearly
   * labelled, non-secret-shaped development default is used so local runs and
   * tests work without provisioning secrets.
   */
  private resolveSecret(
    key: string,
    isProduction: boolean,
    devLabel: string,
  ): string {
    const value = this.configService.get<string>(key);
    if (value && value.length > 0) {
      return value;
    }
    if (isProduction) {
      throw new Error(
        `${key} must be configured in production; refusing to start with an insecure default`,
      );
    }
    return `slopshield_${devLabel}_only`;
  }

  public async register(payload: any): Promise<any> {
    const { name, email, password, role, larkUserId } = payload;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException(
        "A user with this email address already exists",
      );
    }

    const hashedPassword = await argon2.hash(password);

    const user = await this.prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || "developer",
        larkUserId,
      },
    });

    const tokens = await this.issueTokens(user);

    return {
      ...tokens,
      user: this.sanitizeUser(user),
    };
  }

  public async login(payload: any): Promise<any> {
    const { email, password } = payload;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException("Invalid email or password credentials");
    }

    const isPasswordValid = await argon2.verify(user.password, password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid email or password credentials");
    }

    const tokens = await this.issueTokens(user);

    return {
      ...tokens,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * Exchanges a refresh token for a new access token (Req 1.6, 1.7).
   *
   * The token must (a) verify under REFRESH_SECRET, (b) carry a `jti` that
   * maps to a stored RefreshToken row, and (c) not be revoked or expired.
   * Any failure results in a 401.
   */
  public async refreshToken(token: string): Promise<any> {
    if (!token) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    let payload: any;
    try {
      payload = jwt.verify(token, this.refreshSecret) as any;
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const jti = payload?.jti;
    if (!jti) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { jti },
    });

    if (!stored || stored.revokedAt !== null) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException("User no longer exists");
    }

    const accessToken = this.signAccessToken(user);
    return { accessToken };
  }

  /**
   * Logs a user out by revoking the supplied refresh token so it can no longer
   * be exchanged (Req 1.5). Invalid or already-revoked tokens are treated as a
   * no-op success — logout is idempotent and must never leak token validity.
   */
  public async logout(token: string): Promise<{ success: boolean }> {
    if (!token) {
      return { success: true };
    }

    let payload: any;
    try {
      payload = jwt.verify(token, this.refreshSecret) as any;
    } catch {
      return { success: true };
    }

    const jti = payload?.jti;
    if (!jti) {
      return { success: true };
    }

    await this.prisma.refreshToken.updateMany({
      where: { jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  public async getProfile(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException("User profile not found");
    }

    return this.sanitizeUser(user);
  }

  /**
   * Signs an access + refresh token pair and persists the refresh token's
   * `jti` so it can be revoked later (logout) and validated on refresh.
   */
  private async issueTokens(user: any): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const accessToken = this.signAccessToken(user);

    const jti = randomUUID();
    const refreshToken = jwt.sign({ sub: user.id }, this.refreshSecret, {
      expiresIn: this.refreshExpiration,
      jwtid: jti,
    } as jwt.SignOptions);

    const decoded = jwt.decode(refreshToken) as { exp?: number } | null;
    const expiresAt =
      decoded?.exp != null
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        jti,
        userId: user.id,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private signAccessToken(user: any): string {
    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      larkUserId: user.larkUserId,
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiration,
    } as jwt.SignOptions);
  }

  private sanitizeUser(user: any): any {
    const { password, ...sanitized } = user;
    return sanitized;
  }
}
