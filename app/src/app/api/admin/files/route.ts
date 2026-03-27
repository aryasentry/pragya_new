import { NextResponse } from "next/server";
import { resolveAdminByEmail } from "@/lib/admin";
import { listDomainFiles } from "@/lib/ingestion";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email") ?? "";
    const admin = resolveAdminByEmail(email);

    const inventory = await listDomainFiles(admin.domain);

    return NextResponse.json({
      files: inventory.files,
      totalChildChunks: inventory.totalChildChunks,
      totalEmbeddedChildChunks: inventory.totalEmbeddedChildChunks,
      jobs: [],
      domain: admin.domain,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load files." },
      { status: 500 },
    );
  }
}
