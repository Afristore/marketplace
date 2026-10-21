import { resolveIpfsUrl, cidToGatewayUrl } from "../lib/ipfs";
import { config } from "../lib/config";

describe("ipfs.ts — resolveIpfsUrl & cidToGatewayUrl", () => {
  const pinataGateway = config.pinataGateway || "https://gateway.pinata.cloud";

  it("1. Normalizes CIDv0 with ipfs:// protocol prefix", () => {
    const input = "ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
    expect(resolveIpfsUrl(input)).toBe(
      `${pinataGateway}/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco`
    );
  });

  it("2. Normalizes CIDv1 with ipfs:// protocol prefix", () => {
    const input =
      "ipfs://bafybeicg2ggsak2vxqpvqiqwusqgwyge2bgqzbq5q24qwhvdjcb5vxxwgu";
    expect(resolveIpfsUrl(input)).toBe(
      `${pinataGateway}/ipfs/bafybeicg2ggsak2vxqpvqiqwusqgwyge2bgqzbq5q24qwhvdjcb5vxxwgu`
    );
  });

  it("3. Resolves raw CIDv0 without protocol prefix", () => {
    const input = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
    expect(resolveIpfsUrl(input)).toBe(
      `${pinataGateway}/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco`
    );
  });

  it("4. Resolves raw CIDv1 without protocol prefix", () => {
    const input =
      "bafybeicg2ggsak2vxqpvqiqwusqgwyge2bgqzbq5q24qwhvdjcb5vxxwgu";
    expect(resolveIpfsUrl(input)).toBe(
      `${pinataGateway}/ipfs/bafybeicg2ggsak2vxqpvqiqwusqgwyge2bgqzbq5q24qwhvdjcb5vxxwgu`
    );
  });

  it("5. Preserves direct HTTPS URLs unchanged", () => {
    const input = "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119";
    expect(resolveIpfsUrl(input)).toBe(input);
  });

  it("6. Preserves direct HTTP URLs unchanged", () => {
    const input = "http://example.com/art/african-mask.png";
    expect(resolveIpfsUrl(input)).toBe(input);
  });

  it("7. Preserves local root-relative paths unchanged", () => {
    const input = "/placeholder-art.svg";
    expect(resolveIpfsUrl(input)).toBe(input);
  });

  it("8. Returns empty string for empty input, null, or undefined", () => {
    expect(resolveIpfsUrl("")).toBe("");
    expect(resolveIpfsUrl("   ")).toBe("");
    expect(resolveIpfsUrl(undefined)).toBe("");
    expect(resolveIpfsUrl(null)).toBe("");
  });

  it("9. Supports custom gateway URL formatting without trailing slash", () => {
    const input = "ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
    const customGateway = "https://cloudflare-ipfs.com";
    expect(resolveIpfsUrl(input, customGateway)).toBe(
      "https://cloudflare-ipfs.com/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"
    );
  });

  it("10. Normalizes custom gateway URL containing trailing slashes", () => {
    const input =
      "ipfs://bafybeicg2ggsak2vxqpvqiqwusqgwyge2bgqzbq5q24qwhvdjcb5vxxwgu";
    const customGateway = "https://dweb.link///";
    expect(resolveIpfsUrl(input, customGateway)).toBe(
      "https://dweb.link/ipfs/bafybeicg2ggsak2vxqpvqiqwusqgwyge2bgqzbq5q24qwhvdjcb5vxxwgu"
    );
  });

  it("11. Supports IPFS subpaths within CID directory", () => {
    const input =
      "ipfs://bafybeicg2ggsak2vxqpvqiqwusqgwyge2bgqzbq5q24qwhvdjcb5vxxwgu/metadata.json";
    expect(resolveIpfsUrl(input)).toBe(
      `${pinataGateway}/ipfs/bafybeicg2ggsak2vxqpvqiqwusqgwyge2bgqzbq5q24qwhvdjcb5vxxwgu/metadata.json`
    );
  });

  it("12. Resolves ipfs/ prefix format", () => {
    const input = "ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
    expect(resolveIpfsUrl(input)).toBe(
      `${pinataGateway}/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco`
    );
  });

  it("13. Ensures cidToGatewayUrl alias produces identical outputs", () => {
    const testCases = [
      "ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
      "https://pinata.cloud/image.png",
      "/placeholder-art.svg",
      "",
    ];

    for (const testCase of testCases) {
      expect(cidToGatewayUrl(testCase)).toBe(resolveIpfsUrl(testCase));
    }
  });
});
