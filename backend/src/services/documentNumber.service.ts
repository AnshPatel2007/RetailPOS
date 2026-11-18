import { Prisma } from '@prisma/client';
import prisma from '../config/database';

export async function nextDocumentSequence(client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma): Promise<bigint> {
  const [row] = await client.$queryRaw<{ value: bigint }[]>`SELECT nextval('document_reference_seq') AS value`;
  return row.value;
}

export async function nextDocumentNumber(prefix: 'PO' | 'INV' | 'EXP' | 'EX' | 'CC' | 'TRF', client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma) {
  return `${prefix}-${await nextDocumentSequence(client)}`;
}
