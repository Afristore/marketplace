import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
  try {
    const settings = await request.json();
    return NextResponse.json({ ok: true, settings });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid settings payload" },
      { status: 400 },
    );
  }
}
