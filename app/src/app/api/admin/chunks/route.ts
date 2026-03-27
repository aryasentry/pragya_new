import { NextResponse } from "next/server";
import { resolveAdminByEmail } from "@/lib/admin";
import { listChunksForJob } from "@/lib/ingestion";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email") ?? "";
    const jobId = searchParams.get("jobId") ?? "";

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    const admin = resolveAdminByEmail(email);
    const payload = await listChunksForJob({
      domain: admin.domain,
      jobId,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load chunk details." },
      { status: 500 },
    );
  }
}
