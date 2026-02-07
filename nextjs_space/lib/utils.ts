import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import crypto from 'crypto';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateToken(length: number = 32): string {
  return crypto?.randomBytes?.(length)?.toString?.('hex') ?? '';
}

export function generateSlug(name: string): string {
  return (name ?? '')
    ?.toLowerCase?.()
    ?.replace?.(/[^a-z0-9]+/g, '-')
    ?.replace?.(/^-|-$/g, '') ?? '';
}

export function formatDate(date: Date | string): string {
  return new Date(date)?.toLocaleDateString?.('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }) ?? '';
}

export function formatDateTime(date: Date | string): string {
  return new Date(date)?.toLocaleString?.('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) ?? '';
}

export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now?.getTime?.() - then?.getTime?.();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}

export function truncate(str: string, length: number): string {
  if (!str || (str?.length ?? 0) <= length) return str ?? '';
  return `${str?.substring?.(0, length)}...`;
}

export function parseUserAgent(ua: string | null): { browser: string; os: string } {
  if (!ua) return { browser: 'Unknown', os: 'Unknown' };
  
  let browser = 'Unknown';
  let os = 'Unknown';
  
  if (ua?.includes?.('Chrome')) browser = 'Chrome';
  else if (ua?.includes?.('Firefox')) browser = 'Firefox';
  else if (ua?.includes?.('Safari')) browser = 'Safari';
  else if (ua?.includes?.('Edge')) browser = 'Edge';
  
  if (ua?.includes?.('Windows')) os = 'Windows';
  else if (ua?.includes?.('Mac')) os = 'macOS';
  else if (ua?.includes?.('Linux')) os = 'Linux';
  else if (ua?.includes?.('Android')) os = 'Android';
  else if (ua?.includes?.('iOS')) os = 'iOS';
  
  return { browser, os };
}
