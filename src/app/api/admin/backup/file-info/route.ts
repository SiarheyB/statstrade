import { NextResponse } from "next/server";
import { join } from "path";
import fs from "fs/promises";

const PROJECT_ROOT = process.cwd();
const TMP_DIR = join(PROJECT_ROOT, "backup", "tmp");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { filePath } = body;

    if (!filePath) {
      return NextResponse.json({ error: "Missing filePath" }, { status: 400 });
    }

    // Security check: ensure the file is within backup/tmp
    const resolvedPath = join(TMP_DIR, filePath.replace(TMP_DIR, ""));
    const normalized = resolvedPath.replace(/^.*backup\/tmp\//, "");
    const fullPath = join(TMP_DIR, normalized);

    try {
      const stat = await fs.stat(fullPath);
      return NextResponse.json({ size: stat.size });
    } catch {
      return NextResponse.json({ size: 0 });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to get file info: ${err.message}` },
      { status: 500 }
    );
  }
}