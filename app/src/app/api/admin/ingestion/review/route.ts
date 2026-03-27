import { NextResponse } from "next/server";
import { approveJob, rejectJob } from "@/lib/ingestion";
import { resolveAdminByEmail } from "@/lib/admin";

type ReviewRequest = {
  email: string;
  jobId: string;
  decision: "approve" | "reject";
  reason?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReviewRequest;
    const admin = resolveAdminByEmail(body.email);

    if (!body.jobId || !body.decision) {
      return NextResponse.json({ error: "jobId and decision are required." }, { status: 400 });
    }

    if (body.decision === "approve") {
      const result = await approveJob({
        adminEmail: admin.email,
        domain: admin.domain,
        jobId: body.jobId,
      });

      return NextResponse.json({
        status: "approved",
        ...result,
      });
    }

    await rejectJob({
      adminEmail: admin.email,
      domain: admin.domain,
      jobId: body.jobId,
      reason: body.reason,
    });

    return NextResponse.json({ status: "rejected" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Review action failed." },
      { status: 500 },
    );
  }
}
