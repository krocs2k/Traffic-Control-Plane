import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create password hash for demo users
  const passwordHash = await bcrypt.hash('password123', 12);
  const testPasswordHash = await bcrypt.hash('johndoe123', 12);

  // Create test user first (required for auth testing)
  const testUser = await prisma.user.upsert({
    where: { email: 'john@doe.com' },
    update: {},
    create: {
      email: 'john@doe.com',
      name: 'John Doe',
      passwordHash: testPasswordHash,
      status: 'ACTIVE',
    },
  });
  console.log('Created test user:', testUser.email);

  // Create demo organizations
  const acmeCorp = await prisma.organization.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      name: 'Acme Corp',
      slug: 'acme-corp',
      settings: {
        theme: 'dark',
        notifications: true,
      },
    },
  });
  console.log('Created organization:', acmeCorp.name);

  const techStart = await prisma.organization.upsert({
    where: { slug: 'techstart-inc' },
    update: {},
    create: {
      name: 'TechStart Inc',
      slug: 'techstart-inc',
      settings: {
        theme: 'light',
        notifications: true,
      },
    },
  });
  console.log('Created organization:', techStart.name);

  // Create demo users
  const alice = await prisma.user.upsert({
    where: { email: 'alice@acme.com' },
    update: {},
    create: {
      email: 'alice@acme.com',
      name: 'Alice Johnson',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@acme.com' },
    update: {},
    create: {
      email: 'bob@acme.com',
      name: 'Bob Smith',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const carol = await prisma.user.upsert({
    where: { email: 'carol@techstart.com' },
    update: {},
    create: {
      email: 'carol@techstart.com',
      name: 'Carol Williams',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const dave = await prisma.user.upsert({
    where: { email: 'dave@techstart.com' },
    update: {},
    create: {
      email: 'dave@techstart.com',
      name: 'Dave Brown',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const eve = await prisma.user.upsert({
    where: { email: 'eve@external.com' },
    update: {},
    create: {
      email: 'eve@external.com',
      name: 'Eve Davis',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  console.log('Created demo users: Alice, Bob, Carol, Dave, Eve');

  // Create organization memberships
  // Test user is Owner of Acme Corp
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: acmeCorp.id,
        userId: testUser.id,
      },
    },
    update: {},
    create: {
      orgId: acmeCorp.id,
      userId: testUser.id,
      role: 'OWNER' as Role,
    },
  });

  // Alice is Admin at Acme Corp
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: acmeCorp.id,
        userId: alice.id,
      },
    },
    update: {},
    create: {
      orgId: acmeCorp.id,
      userId: alice.id,
      role: 'ADMIN' as Role,
      invitedById: testUser.id,
    },
  });

  // Bob is Operator at Acme Corp
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: acmeCorp.id,
        userId: bob.id,
      },
    },
    update: {},
    create: {
      orgId: acmeCorp.id,
      userId: bob.id,
      role: 'OPERATOR' as Role,
      invitedById: alice.id,
    },
  });

  // Eve is Auditor at Acme Corp
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: acmeCorp.id,
        userId: eve.id,
      },
    },
    update: {},
    create: {
      orgId: acmeCorp.id,
      userId: eve.id,
      role: 'AUDITOR' as Role,
      invitedById: testUser.id,
    },
  });

  // Carol is Owner of TechStart Inc
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: techStart.id,
        userId: carol.id,
      },
    },
    update: {},
    create: {
      orgId: techStart.id,
      userId: carol.id,
      role: 'OWNER' as Role,
    },
  });

  // Dave is Viewer at TechStart Inc
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: techStart.id,
        userId: dave.id,
      },
    },
    update: {},
    create: {
      orgId: techStart.id,
      userId: dave.id,
      role: 'VIEWER' as Role,
      invitedById: carol.id,
    },
  });

  // Test user is also a Viewer at TechStart Inc
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: techStart.id,
        userId: testUser.id,
      },
    },
    update: {},
    create: {
      orgId: techStart.id,
      userId: testUser.id,
      role: 'VIEWER' as Role,
      invitedById: carol.id,
    },
  });

  console.log('Created organization memberships');

  // Create some audit logs
  await prisma.auditLog.createMany({
    data: [
      {
        orgId: acmeCorp.id,
        userId: testUser.id,
        action: 'org.create',
        resourceType: 'organization',
        resourceId: acmeCorp.id,
        details: { name: 'Acme Corp' },
      },
      {
        orgId: acmeCorp.id,
        userId: testUser.id,
        action: 'user.invite',
        resourceType: 'organizationInvite',
        details: { email: 'alice@acme.com', role: 'ADMIN' },
      },
      {
        orgId: acmeCorp.id,
        userId: alice.id,
        action: 'user.invite',
        resourceType: 'organizationInvite',
        details: { email: 'bob@acme.com', role: 'OPERATOR' },
      },
      {
        orgId: techStart.id,
        userId: carol.id,
        action: 'org.create',
        resourceType: 'organization',
        resourceId: techStart.id,
        details: { name: 'TechStart Inc' },
      },
    ],
  });

  console.log('Created audit log entries');
  console.log('\nSeeding completed successfully!');
  console.log('\nDemo Organizations:');
  console.log('  - Acme Corp (acme-corp)');
  console.log('  - TechStart Inc (techstart-inc)');
  console.log('\nDemo Users (all passwords: password123):');
  console.log('  - alice@acme.com (Admin at Acme Corp)');
  console.log('  - bob@acme.com (Operator at Acme Corp)');
  console.log('  - carol@techstart.com (Owner at TechStart Inc)');
  console.log('  - dave@techstart.com (Viewer at TechStart Inc)');
  console.log('  - eve@external.com (Auditor at Acme Corp)');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
