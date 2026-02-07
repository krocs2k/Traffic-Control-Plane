import { generateSecret as otpGenerateSecret, generateURI, verifySync, generateSync } from 'otplib';
import * as QRCode from 'qrcode';
import crypto from 'crypto';

export interface MfaSetupData {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

/**
 * Generate a new MFA secret for a user
 */
export function generateMfaSecret(): string {
  return otpGenerateSecret();
}

/**
 * Generate QR code data URL for authenticator app
 */
export async function generateQrCodeUrl(
  secret: string,
  email: string,
  issuer: string = 'Traffic Control Plane'
): Promise<string> {
  const otpauth = generateURI({
    secret,
    label: email,
    issuer,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
  });
  return QRCode.toDataURL(otpauth);
}

/**
 * Verify a TOTP token against a secret
 */
export function verifyMfaToken(token: string, secret: string): boolean {
  try {
    const result = verifySync({
      token,
      secret,
      strategy: 'totp',
      epochTolerance: 30, // Allow 30 seconds tolerance (1 step)
    });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Generate backup codes for MFA recovery
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric codes
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Hash a backup code for storage
 */
export function hashBackupCode(code: string): string {
  return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
}

/**
 * Verify a backup code against stored hashes
 */
export function verifyBackupCode(code: string, hashedCodes: string[]): { valid: boolean; index: number } {
  const hashedInput = hashBackupCode(code);
  const index = hashedCodes.findIndex(hashed => hashed === hashedInput);
  return { valid: index !== -1, index };
}

/**
 * Complete MFA setup - returns everything needed for user setup
 */
export async function initiateMfaSetup(email: string): Promise<MfaSetupData> {
  const secret = generateMfaSecret();
  const qrCodeUrl = await generateQrCodeUrl(secret, email);
  const backupCodes = generateBackupCodes(10);
  
  return {
    secret,
    qrCodeUrl,
    backupCodes,
  };
}

/**
 * Get the current TOTP token for a secret (for testing/debugging only)
 */
export function getCurrentToken(secret: string): string {
  return generateSync({ secret, strategy: 'totp' });
}
