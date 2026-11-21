// Seeds one customer and one merchant. Safe to run repeatedly.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const password = process.env.SEED_PASSWORD || 'password123';

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);
  const users = [
    { id: 'usr_seedCustomer', name: 'Wanjiku Kamau', phone: '+254712345678', email: 'customer@pesapop.test', role: 'customer' as const },
    { id: 'usr_seedMerchant', name: 'Duka la Mama Njeri', phone: '+254722000111', email: 'merchant@pesapop.test', role: 'merchant' as const },
  ];
  for (const u of users) {
    await prisma.user.upsert({ where: { email: u.email }, update: { passwordHash }, create: { ...u, passwordHash } });
    console.info(`seeded ${u.role}: ${u.email}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
