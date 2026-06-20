import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import {
  parseOptions,
  DEFAULT_ENTRY_POINTS,
  DEFAULT_ENTRY_TYPES,
  DEFAULT_MISTAKES,
  DEFAULT_PATTERNS,
} from "@/lib/annotations";

const optionList = z.array(z.string().trim().min(1).max(60)).max(40);
const schema = z.object({
  entryPointOptions: optionList,
  entryTypeOptions: optionList,
  mistakeOptions: optionList,
  patternOptions: optionList,
});

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: {
      entryPointOptions: true,
      entryTypeOptions: true,
      mistakeOptions: true,
      patternOptions: true,
    },
  });

  return NextResponse.json({
    entryPointOptions: parseOptions(row?.entryPointOptions, DEFAULT_ENTRY_POINTS),
    entryTypeOptions: parseOptions(row?.entryTypeOptions, DEFAULT_ENTRY_TYPES),
    mistakeOptions: parseOptions(row?.mistakeOptions, DEFAULT_MISTAKES),
    patternOptions: parseOptions(row?.patternOptions, DEFAULT_PATTERNS),
  });
}

export async function PUT(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Проверьте данные", parsed.error.flatten().fieldErrors);
  }

  // De-duplicate while preserving order.
  const uniq = (xs: string[]) => Array.from(new Set(xs.map((s) => s.trim())));
  const entryPointOptions = uniq(parsed.data.entryPointOptions);
  const entryTypeOptions = uniq(parsed.data.entryTypeOptions);
  const mistakeOptions = uniq(parsed.data.mistakeOptions);
  const patternOptions = uniq(parsed.data.patternOptions);

  try {
    await prisma.user.update({
      where: { id: user.userId },
      data: {
        entryPointOptions: JSON.stringify(entryPointOptions),
        entryTypeOptions: JSON.stringify(entryTypeOptions),
        mistakeOptions: JSON.stringify(mistakeOptions),
        patternOptions: JSON.stringify(patternOptions),
      },
    });
    return NextResponse.json({ entryPointOptions, entryTypeOptions, mistakeOptions, patternOptions });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
