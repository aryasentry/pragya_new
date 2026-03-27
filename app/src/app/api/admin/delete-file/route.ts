import { NextResponse } from "next/server";
import { resolveAdminByEmail } from "@/lib/admin";
import { deleteDomainFile } from "@/lib/ingestion";

type DeleteFileRequest = {
  email: string;
  documentName: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DeleteFileRequest;
    const admin = resolveAdminByEmail(body.email);

    if (!body.documentName) {
      return NextResponse.json({ error: "documentName is required." }, { status: 400 });
    }

    await deleteDomainFile({
      adminEmail: admin.email,
      domain: admin.domain,
      documentName: body.documentName,
    });

    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete operation failed." },
      { status: 500 },
    );
  }
}
