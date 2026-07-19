import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PIPELINE_ID_PATTERN = /^[A-Za-z0-9-]+$/;
const FILE_NAME_PATTERN = /^[a-z0-9-]+\.(svg|png|jpe?g|webp)$/;

function contentTypeFor(fileName: string) {
  if (fileName.endsWith(".svg")) return "image/svg+xml";
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ pipelineId: string; fileName: string }> },
) {
  const { pipelineId, fileName } = await context.params;
  if (!PIPELINE_ID_PATTERN.test(pipelineId) || !FILE_NAME_PATTERN.test(fileName)) {
    return NextResponse.json({ error: "Invalid image path" }, { status: 400 });
  }

  const root = path.resolve(process.cwd(), "public", "generated", "stock-blog");
  const filePath = path.resolve(root, pipelineId, fileName);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    return NextResponse.json({ error: "Invalid image path" }, { status: 400 });
  }

  try {
    const file = await readFile(filePath);
    return new Response(new Uint8Array(file), {
      headers: {
        "Cache-Control": "public, max-age=300, immutable",
        "Content-Type": contentTypeFor(fileName),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Image read failed" }, { status: 500 });
  }
}
