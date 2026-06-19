import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtExpiration: string;
  private readonly refreshSecret: string;
  private readonly refreshExpiration: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET', 'fallback_secret');
    this.jwtExpiration = this.configService.get<string>('JWT_EXPIRATION', '15m');
    this.refreshSecret = this.configService.get<string>('REFRESH_SECRET', 'fallback_refresh_secret');
    this.refreshExpiration = this.configService.get<string>('REFRESH_EXPIRATION', '7d');
  }

  public async register(payload: any): Promise<any> {
    const { name, email, password, role, larkUserId } = payload;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('A user with this email address already exists');
    }

    const hashedPassword = await argon2.hash(password);

    const user = await this.prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || 'developer',
        larkUserId,
      },
    });

    const tokens = this.generateTokens(user);

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
      throw new UnauthorizedException('Invalid email or password credentials');
    }

    const isPasswordValid = await argon2.verify(user.password, password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password credentials');
    }

    const tokens = this.generateTokens(user);

    return {
      ...tokens,
      user: this.sanitizeUser(user),
    };
  }

  public async refreshToken(token: string): Promise<any> {
    try {
      const payload = jwt.verify(token, this.refreshSecret) as any;
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User no longer exists');
      }

      const tokens = this.generateTokens(user);
      return {
        accessToken: tokens.accessToken,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  public async getProfile(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User profile not found');
    }

    return this.sanitizeUser(user);
  }

  private generateTokens(user: any): { accessToken: string; refreshToken: string } {
    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      larkUserId: user.larkUserId,
    };

    const accessToken = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiration,
    } as jwt.SignOptions);

    const refreshToken = jwt.sign({ sub: user.id }, this.refreshSecret, {
      expiresIn: this.refreshExpiration,
    } as jwt.SignOptions);

    return { accessToken, refreshToken };
  }

  private sanitizeUser(user: any): any {
    const { password, ...sanitized } = user;
    return sanitized;
  }
}
