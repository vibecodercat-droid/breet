import { PrismaClient } from '@prisma/client';

let prisma;
export function getPrisma() {
  if (prisma) return prisma;
  try {
    prisma = new PrismaClient();
  } catch (e) {
    prisma = null;
  }
  return prisma;
}


