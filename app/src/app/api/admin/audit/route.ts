import { NextResponse } from "next/server";
import { resolveAdminByEmail } from "@/lib/admin";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email") ?? "";
    const admin = resolveAdminByEmail(email);
    return NextResponse.json({ domain: admin.domain, logs: [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load audit logs." },
      { status: 500 },
    );
  }
}
