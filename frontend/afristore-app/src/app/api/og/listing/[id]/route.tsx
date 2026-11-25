import { ImageResponse } from "next/og";
import { stroopsToXlm } from "@/lib/contract";
import { cidToGatewayUrl } from "@/lib/ipfs";
import { resolveArtwork, parseArtworkId } from "@/lib/resolveArtwork";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (parseArtworkId(id) === null) {
    return new Response("Invalid listing ID", { status: 400 });
  }

  try {
    // Same resolution as the listing page: real indexer/on-chain data only.
    const resolved = await resolveArtwork(id);
    if (!resolved) {
      throw new Error("Listing not found");
    }
    const { listing, auction, metadata } = resolved;

    const artist = listing?.artist || auction?.creator;
    const price = listing
      ? stroopsToXlm(listing.price)
      : auction
        ? stroopsToXlm(auction.highest_bid || auction.reserve_price)
        : "0";
    const status = listing?.status || auction?.status;
    const imageUrl = metadata?.image ? cidToGatewayUrl(metadata.image) : null;

    const title = metadata?.title || `Artwork #${id}`;
    const description =
      metadata?.description || "Unique African digital artwork";
    const category = metadata?.category || "Digital Art";

    return new ImageResponse(
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #1E1E24 0%, #2D1B69 100%)",
          color: "white",
          fontFamily: "Inter, system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Background Pattern */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23E27D60' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            opacity: 0.1,
          }}
        />

        {/* Main Content */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            position: "relative",
            zIndex: 1,
          }}
        >
          {/* Left Side - Image */}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "40px",
              position: "relative",
            }}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={title}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  borderRadius: "20px",
                  boxShadow: "0 20px 40px rgba(0, 0, 0, 0.3)",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background:
                    "linear-gradient(135deg, #E27D60 0%, #85DCBA 100%)",
                  borderRadius: "20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "72px",
                  boxShadow: "0 20px 40px rgba(0, 0, 0, 0.3)",
                }}
              >
                🎨
              </div>
            )}

            {/* Status Badge */}
            <div
              style={{
                position: "absolute",
                top: "60px",
                left: "60px",
                background:
                  status === "Active"
                    ? "#10B981"
                    : status === "Sold" || status === "Finalized"
                      ? "#E27D60"
                      : "#EF4444",
                color: "white",
                padding: "8px 16px",
                borderRadius: "20px",
                fontSize: "14px",
                fontWeight: "bold",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              {status}
            </div>
          </div>

          {/* Right Side - Details */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "60px 60px 60px 20px",
            }}
          >
            {/* Title */}
            <h1
              style={{
                fontSize: "48px",
                fontWeight: 800,
                margin: 0,
                marginBottom: "16px",
                lineHeight: 1.2,
                background: "linear-gradient(135deg, #E27D60 0%, #85DCBA 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {title}
            </h1>

            {/* Artist */}
            <p
              style={{
                fontSize: "20px",
                margin: 0,
                marginBottom: "12px",
                color: "rgba(255, 255, 255, 0.8)",
                fontFamily: "monospace",
              }}
            >
              by {artist?.slice(0, 6)}…{artist?.slice(-4)}
            </p>

            {/* Category */}
            <p
              style={{
                fontSize: "16px",
                margin: 0,
                marginBottom: "24px",
                color: "rgba(255, 255, 255, 0.6)",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              {category}
            </p>

            {/* Price */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
                marginBottom: "24px",
              }}
            >
              <span
                style={{
                  fontSize: "36px",
                  fontWeight: 700,
                  color: "#FFD700",
                }}
              >
                {price}
              </span>
              <span
                style={{
                  fontSize: "18px",
                  color: "rgba(255, 255, 255, 0.8)",
                  fontWeight: 500,
                }}
              >
                XLM
              </span>
            </div>

            {/* Type Badge */}
            <div
              style={{
                display: "inline-block",
                background: "rgba(255, 255, 255, 0.1)",
                color: "white",
                padding: "8px 16px",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: "bold",
                marginBottom: "24px",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
              }}
            >
              {listing ? "🏪 Fixed Price" : "🎵 Timed Auction"}
            </div>

            {/* Footer */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "16px",
                color: "rgba(255, 255, 255, 0.5)",
                marginTop: "auto",
              }}
            >
              <span>🎨</span>
              <span>Afristore</span>
              <span>•</span>
              <span>African Art on Stellar</span>
            </div>
          </div>
        </div>
      </div>,
    );
  } catch (error) {
    console.error("Failed to generate listing OG image:", error);

    // Fallback image
    return new ImageResponse(
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #1E1E24 0%, #2D1B69 100%)",
          color: "white",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <h1
          style={{
            fontSize: "48px",
            fontWeight: 800,
            margin: 0,
            textAlign: "center",
          }}
        >
          Artwork #{id}
        </h1>
        <p
          style={{
            fontSize: "20px",
            margin: "16px 0 0",
            color: "rgba(255, 255, 255, 0.7)",
          }}
        >
          Afristore - African Art on Stellar
        </p>
      </div>,
    );
  }
}
