import { z } from 'zod';

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

export class ChangePasswordBody {
  static readonly zodSchema = ChangePasswordSchema;

  currentPassword!: string;
  newPassword!: string;
}
