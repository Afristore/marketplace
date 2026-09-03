import { NextResponse } from "next/server";

// Marks all notifications as read for a wallet.
//
// Read-state is tracked client-side in localStorage (see NotificationsContext),
// since the indexer exposes no "mark read" endpoint. This handler validates the
// request and acknowledges it so the client has a real endpoint to call.
export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Missing address parameter" },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true, updated_count: 0 });
}
