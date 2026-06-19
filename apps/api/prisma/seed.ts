import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create demo users
  const hashedPassword = await argon2.hash('password123');

  const users = [
    {
      name: 'Developer Alice',
      email: 'alice@example.com',
      password: hashedPassword,
      role: 'developer',
    },
    {
      name: 'Reviewer Bob',
      email: 'bob@example.com',
      password: hashedPassword,
      role: 'reviewer',
    },
    {
      name: 'Team Lead Charlie',
      email: 'charlie@example.com',
      password: hashedPassword,
      role: 'team-lead',
    },
    {
      name: 'Admin Admin',
      email: 'admin@example.com',
      password: hashedPassword,
      role: 'admin',
    },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: u,
    });
  }
  console.log('Demo users seeded.');

  // Create demo project
  const project = await prisma.project.upsert({
    where: { id: '9bc6279f-09e8-4228-aa92-803a5661d4bd' }, // fixed uuid for seeder consistency
    update: {},
    create: {
      id: '9bc6279f-09e8-4228-aa92-803a5661d4bd',
      name: 'SlopShield Demo Project',
      repositoryUrl: 'https://github.com/slopshield/demo',
      framework: 'React / Next.js',
      minimumScore: 80,
    },
  });
  console.log('Demo project seeded:', project.name);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
