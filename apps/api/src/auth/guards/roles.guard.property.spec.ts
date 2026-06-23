// Feature: production-grade-system, Property 5: Role-restricted endpoints reject unauthorized roles
//
// Property 5: Role-restricted endpoints reject unauthorized roles.
// Validates: Requirements 1.12
//
// For any user whose role is NOT in the set of roles required by a
// role-restricted endpoint, the RolesGuard rejects the request by throwing a
// ForbiddenException (which NestJS maps to HTTP 403). For any user whose role
// IS authorized, the guard permits the request (canActivate returns true).
//
// Strategy: fast-check generates a non-empty set of required roles plus a
// candidate user role drawn from a pool that overlaps the required set. The
// oracle is simple set membership: authorized iff requiredRoles includes the
// user's role. We build a minimal ExecutionContext stub that mirrors how
// NestJS exposes handler/class metadata and the request user.

import "reflect-metadata";
import {
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import fc from "fast-check";
import { RolesGuard } from "./roles.guard";
import { ROLES_KEY } from "../decorators/roles.decorator";

// Pool of role identifiers the generators draw from. Kept small so the
// generated user role frequently overlaps (authorized) and frequently misses
// (unauthorized) the required-role set.
const ROLE_POOL = ["admin", "user", "auditor", "owner", "viewer", "guest"];

/**
 * Build a minimal ExecutionContext that returns `requiredRoles` from the
 * Reflector metadata lookup and exposes `user` on the HTTP request, exactly
 * as the production guard reads them.
 */
function makeContext(
  requiredRoles: string[] | undefined,
  user: unknown,
): { context: ExecutionContext; reflector: Reflector } {
  const handler = (): void => undefined;

  class FakeController {}

  const reflector = new Reflector();
  // Attach metadata to the handler so the real Reflector resolves it.
  if (requiredRoles !== undefined) {
    Reflect.defineMetadata(ROLES_KEY, requiredRoles, handler);
  }

  const context = {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;

  return { context, reflector };
}

describe("RolesGuard — Property 5: Role-restricted endpoints reject unauthorized roles", () => {
  it("permits authorized roles and rejects unauthorized roles with 403", () => {
    fc.assert(
      fc.property(
        // A non-empty set of required roles for the endpoint.
        fc
          .uniqueArray(fc.constantFrom(...ROLE_POOL), {
            minLength: 1,
            maxLength: ROLE_POOL.length,
          }),
        // The role assigned to the requesting user.
        fc.constantFrom(...ROLE_POOL),
        (requiredRoles, userRole) => {
          const { context, reflector } = makeContext(requiredRoles, {
            role: userRole,
          });
          const guard = new RolesGuard(reflector);

          const authorized = requiredRoles.includes(userRole);

          if (authorized) {
            expect(guard.canActivate(context)).toBe(true);
          } else {
            let thrown: unknown;
            try {
              guard.canActivate(context);
            } catch (err) {
              thrown = err;
            }
            expect(thrown).toBeInstanceOf(ForbiddenException);
            expect((thrown as ForbiddenException).getStatus()).toBe(
              HttpStatus.FORBIDDEN,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects with 403 when the request has no authenticated user/role", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...ROLE_POOL), {
          minLength: 1,
          maxLength: ROLE_POOL.length,
        }),
        // Users that lack a usable role: undefined, null, or an object with no role.
        fc.constantFrom(undefined, null, {}, { role: "" }, { role: undefined }),
        (requiredRoles, user) => {
          const { context, reflector } = makeContext(requiredRoles, user);
          const guard = new RolesGuard(reflector);

          let thrown: unknown;
          try {
            guard.canActivate(context);
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeInstanceOf(ForbiddenException);
          expect((thrown as ForbiddenException).getStatus()).toBe(
            HttpStatus.FORBIDDEN,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("permits any request when the endpoint declares no required roles", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ROLE_POOL),
        fc.constantFrom(undefined, []),
        (userRole, requiredRoles) => {
          const { context, reflector } = makeContext(
            requiredRoles as string[] | undefined,
            { role: userRole },
          );
          const guard = new RolesGuard(reflector);
          expect(guard.canActivate(context)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
