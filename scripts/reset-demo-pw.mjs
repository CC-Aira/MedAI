// 临时脚本：把测试中改掉的演示账号密码还原回 Medai@2026
// 用法：node scripts/reset-demo-pw.mjs
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const scrypt = promisify(scryptCb);
const prisma = new PrismaClient();

async function hash(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

const email = process.argv[2] || "zhouyu@medai.local";
const password = process.argv[3] || "Medai@2026";

await prisma.user.update({ where: { email }, data: { passwordHash: await hash(password) } });
console.log(`已还原 ${email} 的密码`);
await prisma.$disconnect();
