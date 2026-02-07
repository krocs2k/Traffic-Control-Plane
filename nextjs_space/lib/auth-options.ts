import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { UserStatus, Role } from '@prisma/client';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      avatarUrl?: string | null;
      currentOrgId?: string;
      currentOrgRole?: Role;
    };
  }
  interface User {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    status: UserStatus;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    currentOrgId?: string;
    currentOrgRole?: Role;
  }
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password required');
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email?.toLowerCase?.() },
        });

        if (!user) {
          throw new Error('Invalid email or password');
        }

        if (user?.status === 'INACTIVE') {
          throw new Error('Account has been deactivated');
        }

        const isValid = await bcrypt.compare(credentials.password, user?.passwordHash ?? '');
        if (!isValid) {
          throw new Error('Invalid email or password');
        }

        return {
          id: user?.id ?? '',
          email: user?.email ?? '',
          name: user?.name ?? '',
          avatarUrl: user?.avatarUrl,
          status: user?.status ?? 'ACTIVE',
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user?.id ?? '';
        token.email = user?.email ?? '';
        token.name = user?.name ?? '';
        token.avatarUrl = (user as any)?.avatarUrl;
      }
      
      if (trigger === 'update' && session) {
        if (session?.currentOrgId) {
          token.currentOrgId = session?.currentOrgId;
          const membership = await prisma.organizationMember.findUnique({
            where: {
              orgId_userId: {
                orgId: session?.currentOrgId,
                userId: token?.id ?? '',
              },
            },
          });
          token.currentOrgRole = membership?.role;
        }
        if (session?.name) token.name = session?.name;
        if (session?.avatarUrl !== undefined) token.avatarUrl = session?.avatarUrl;
      }
      
      // Set default org if not set
      if (!token?.currentOrgId && token?.id) {
        const firstMembership = await prisma.organizationMember.findFirst({
          where: { userId: token?.id ?? '' },
          orderBy: { joinedAt: 'asc' },
        });
        if (firstMembership) {
          token.currentOrgId = firstMembership?.orgId;
          token.currentOrgRole = firstMembership?.role;
        }
      }
      
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        session.user.id = token?.id ?? '';
        session.user.email = token?.email ?? '';
        session.user.name = token?.name ?? '';
        session.user.avatarUrl = token?.avatarUrl;
        session.user.currentOrgId = token?.currentOrgId;
        session.user.currentOrgRole = token?.currentOrgRole;
      }
      return session;
    },
  },
};
