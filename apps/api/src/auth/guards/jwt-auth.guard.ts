import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as jwt from "jsonwebtoken";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException(
        "Missing or invalid Authorization header",
      );
    }

    const token = authHeader.split(" ")[1];
    try {
      const secret = this.resolveAccessSecret();
      const payload = jwt.verify(token, secret) as any;
      request.user = payload;
      return true;
    } catch (err) {
      throw new UnauthorizedException("Token is invalid or has expired");
    }
  }

  /**
   * Resolves the access-token signing secret. In production the secret MUST be
   * configured — no insecure literal fallback (Req 1.11, 11.3). Outside
   * production a clearly labelled, non-secret-shaped development default is
   * used, matching AuthService so locally-issued tokens verify correctly.
   */
  private resolveAccessSecret(): string {
    const value = this.configService.get<string>("JWT_SECRET");
    if (value && value.length > 0) {
      return value;
    }
    if (this.configService.get<string>("NODE_ENV") === "production") {
      throw new Error(
        "JWT_SECRET must be configured in production; refusing to verify with an insecure default",
      );
    }
    return "slopshield_dev-access_only";
  }
}
