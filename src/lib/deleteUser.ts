import { prisma } from "@/lib/db";

// Полное удаление пользователя и всей связанной истории.
//
// ExchangeAccount / TradeAnnotation каскадятся Prisma-relation'ом (onDelete:
// Cascade в schema.prisma) — их чистить не нужно. Но SupportTicket,
// SupportMessage и RiskProfile ссылаются на userId простой строкой (без FK),
// поэтому без явного удаления они осиротевали бы в БД после user.delete().
export async function deleteUserCascade(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.supportMessage.deleteMany({ where: { userId } }),
    prisma.supportTicket.deleteMany({ where: { userId } }),
    prisma.riskProfile.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}
