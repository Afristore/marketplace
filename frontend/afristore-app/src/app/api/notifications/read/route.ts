import { NextResponse } from "next/server";

// Marks all notifications as read for a wallet.
//
// Read-state is tracked client-side in localStorage (see NotificationsContext),
// since the indexer exposes no "mark read" endpoint. This handler validates the
// request and acknowledges it so the client has a real endpoint to call.
export async function PATCH(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");

    if (!address) {
      return NextResponse.json(
        { success: false, error: "Missing address parameter" },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, updated_count: 0 });
  } catch (error) {
    // Any unexpected failure (malformed request URL, serialization issues)
    // must still resolve to a JSON response so the client never sees an
    // unhandled rejection or an HTML error page.
    console.error("[api/notifications/read] Failed to mark notifications as read:", error);
    return NextResponse.json(
      { success: false, error: "Failed to mark notifications as read" },
      { status: 500 },
    );
  }
}
