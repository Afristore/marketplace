"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useWalletContext } from "@/context/WalletContext";
import {
  getCollectionMetadata,
  getCollectionRecordByAddress,
  mint1155New,
  mint721,
  parseLazy1155VoucherJson,
  parseLazy721VoucherJson,
  redeemLazy1155,
  redeemLazy721,
  CollectionRecord,
  CollectionMetadata,
} from "@/lib/launchpad";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { getReadableErrorMessage } from "@/lib/errors";

type TxPhase =
  | "idle"
  | "validating"
  | "signing"
  | "submitting"
  | "success"
  | "error";

export default function CollectionMintPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = use(params);
  const { publicKey } = useWalletContext();
  const [record, setRecord] = useState<CollectionRecord | null | undefined>(
    undefined
  );
  const [metadata, setMetadata] = useState<CollectionMetadata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadPhase, setLoadPhase] = useState(true);

  // Normal mint fields
  const [recipient, setRecipient] = useState("");
  const [metadataCid, setMetadataCid] = useState("");
  const [amount1155, setAmount1155] = useState("1");

  // Lazy redeem fields
  const [lazyTokenId, setLazyTokenId] = useState("1");
  const [lazyPrice, setLazyPrice] = useState("0");
  const [lazyCurrency, setLazyCurrency] = useState("CB64D3G7SM2RTH6JSGG34DDTFTQ5CFDKVDZJZF3HQV6WEIVGUPAQCE7Y");
  const [lazyUri, setLazyUri] = useState("");
  const [lazyUriHash, setLazyUriHash] = useState("0000000000000000000000000000000000000000000000000000000000000000");
  const [lazyValidUntil, setLazyValidUntil] = useState("0");
  const [lazyBuyerQuota, setLazyBuyerQuota] = useState("1");

  const [signatureHex, setSignatureHex] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("1");

  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [txMessage, setTxMessage] = useState<string | null>(null);
  const [resultDetail, setResultDetail] = useState<string | null>(null);

  const isLazy = useMemo(
    () =>
      record
        ? record.kind === "LazyMint721" || record.kind === "LazyMint1155"
        : null,
    [record]
  );

  const loadCollection = useCallback(async () => {
    setLoadPhase(true);
    setLoadError(null);
    try {
      const [r, m] = await Promise.all([
        getCollectionRecordByAddress(address),
        getCollectionMetadata(address),
      ]);
      setRecord(r);
      setMetadata(m);
      if (publicKey) {
        setRecipient((prev) => (prev ? prev : publicKey));
      }
      if (!r) {
        setLoadError("This contract is not registered in the launchpad index.");
      }
    } catch (e) {
      setLoadError(getReadableErrorMessage(e, "Failed to load collection"));
    } finally {
      setLoadPhase(false);
    }
  }, [address, publicKey]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      await loadCollection();
      if (cancel) return;
    })();
    return () => {
      cancel = true;
    };
  }, [loadCollection]);

  const resetFlow = useCallback(() => {
    setTxPhase("idle");
    setTxMessage(null);
    setResultDetail(null);
  }, []);

  const runMintNormal721 = useCallback(async () => {
    if (!publicKey) {
      setTxMessage("Connect your wallet first.");
      setTxPhase("error");
      return;
    }
    if (metadata && publicKey !== metadata.creator) {
      setTxMessage("Only the collection creator can mint on this contract.");
      setTxPhase("error");
      return;
    }
    const to = recipient.trim();
    if (!to.startsWith("G") || to.length < 50) {
      setTxMessage("Enter a valid Stellar destination address for the recipient.");
      setTxPhase("error");
      return;
    }
    const uri = metadataCid.trim();
    if (!uri) {
      setTxMessage("Metadata URI (IPFS CID or full URL) is required.");
      setTxPhase("error");
      return;
    }
    setTxPhase("signing");
    setTxMessage(null);
    try {
      const id = await mint721(publicKey, address, to, uri);
      setResultDetail(`Minted token id ${id}.`);
      setTxPhase("success");
    } catch (e) {
      setTxMessage(
        e instanceof Error ? e.message : "Transaction failed. Try again."
      );
      setTxPhase("error");
    }
  }, [publicKey, metadata, recipient, metadataCid, address]);

  const runMintNormal1155 = useCallback(async () => {
    if (!publicKey) {
      setTxMessage("Connect your wallet first.");
      setTxPhase("error");
      return;
    }
    if (metadata && publicKey !== metadata.creator) {
      setTxMessage("Only the collection creator can mint on this contract.");
      setTxPhase("error");
      return;
    }
    const to = recipient.trim();
    if (!to.startsWith("G") || to.length < 50) {
      setTxMessage("Enter a valid recipient address.");
      setTxPhase("error");
      return;
    }
    const uri = metadataCid.trim();
    if (!uri) {
      setTxMessage("Metadata URI is required.");
      setTxPhase("error");
      return;
    }
    let amt: bigint;
    try {
      amt = BigInt(amount1155.trim() || "0");
      if (amt <= 0n) throw new Error("bad");
    } catch {
      setTxMessage("Amount must be a positive integer.");
      setTxPhase("error");
      return;
    }
    setTxPhase("signing");
    setTxMessage(null);
    try {
      const tid = await mint1155New(publicKey, address, to, amt, uri);
      setResultDetail(`Created token id ${tid} (and minted ${amt} unit(s)).`);
      setTxPhase("success");
    } catch (e) {
      setTxMessage(
        e instanceof Error ? e.message : "Transaction failed. Try again."
      );
      setTxPhase("error");
    }
  }, [publicKey, metadata, recipient, metadataCid, amount1155, address]);

  const runRedeem721 = useCallback(async () => {
    if (!publicKey) {
      setTxMessage("Connect your wallet first.");
      setTxPhase("error");
      return;
    }
    setTxPhase("validating");
    setTxMessage(null);
    const voucher = {
      token_id: lazyTokenId,
      price: lazyPrice,
      currency: lazyCurrency,
      uri: lazyUri,
      uri_hash: lazyUriHash,
      valid_until: lazyValidUntil,
    };
    if (!/^[0-9a-fA-F]{128}$/.test(signatureHex.trim())) {
      setTxMessage("Signature must be 128 hex characters (64 bytes).");
      setTxPhase("error");
      return;
    }
    setTxPhase("signing");
    try {
      const tokenId = await redeemLazy721(
        publicKey,
        address,
        voucher,
        signatureHex.trim()
      );
      setResultDetail(`Redeemed. Minted token id ${tokenId}.`);
      setTxPhase("success");
    } catch (e) {
      setTxMessage(
        e instanceof Error ? e.message : "Transaction failed. Try again."
      );
      setTxPhase("error");
    }
  }, [publicKey, lazyTokenId, lazyPrice, lazyCurrency, lazyUri, lazyUriHash, lazyValidUntil, signatureHex, address]);

  const runRedeem1155 = useCallback(async () => {
    if (!publicKey) {
      setTxMessage("Connect your wallet first.");
      setTxPhase("error");
      return;
    }
    setTxPhase("validating");
    setTxMessage(null);
    const voucher = {
      token_id: lazyTokenId,
      buyer_quota: lazyBuyerQuota,
      price_per_unit: lazyPrice,
      currency: lazyCurrency,
      uri: lazyUri,
      uri_hash: lazyUriHash,
      valid_until: lazyValidUntil,
    };
    if (!/^[0-9a-fA-F]{128}$/.test(signatureHex.trim())) {
      setTxMessage("Signature must be 128 hex characters (64 bytes).");
      setTxPhase("error");
      return;
    }
    let amt: bigint;
    try {
      amt = BigInt(redeemAmount.trim() || "0");
      if (amt <= 0n) throw new Error("bad");
    } catch {
      setTxMessage("Amount must be a positive integer.");
      setTxPhase("error");
      return;
    }
    setTxPhase("signing");
    try {
      await redeemLazy1155(
        publicKey,
        address,
        voucher,
        amt,
        signatureHex.trim()
      );
      setResultDetail(`Redeemed ${amt} unit(s) successfully.`);
      setTxPhase("success");
    } catch (e) {
      setTxMessage(
        e instanceof Error ? e.message : "Transaction failed. Try again."
      );
      setTxPhase("error");
    }
  }, [publicKey, lazyTokenId, lazyBuyerQuota, lazyPrice, lazyCurrency, lazyUri, lazyUriHash, lazyValidUntil, signatureHex, redeemAmount, address]);

  const isBusy = txPhase === "signing" || txPhase === "validating";

  const derived721VoucherJson = useMemo(() => JSON.stringify({
    token_id: lazyTokenId,
    price: lazyPrice,
    currency: lazyCurrency,
    uri: lazyUri,
    uri_hash: lazyUriHash,
    valid_until: lazyValidUntil
  }, null, 2), [lazyTokenId, lazyPrice, lazyCurrency, lazyUri, lazyUriHash, lazyValidUntil]);

  const derived1155VoucherJson = useMemo(() => JSON.stringify({
    token_id: lazyTokenId,
    buyer_quota: lazyBuyerQuota,
    price_per_unit: lazyPrice,
    currency: lazyCurrency,
    uri: lazyUri,
    uri_hash: lazyUriHash,
    valid_until: lazyValidUntil
  }, null, 2), [lazyTokenId, lazyBuyerQuota, lazyPrice, lazyCurrency, lazyUri, lazyUriHash, lazyValidUntil]);

  const isSignatureValid = signatureHex.trim() === "" || /^[0-9a-fA-F]{128}$/.test(signatureHex.trim());

  return (
    <main className="min-h-screen bg-brand-50/20">
      <Navbar />
      <div className="pt-24 pb-12">
        <div className="max-w-2xl mx-auto px-4">
          <Link
            href={`/launchpad/collections/${address}`}
            className="inline-flex items-center gap-2 text-gray-500 hover:text-brand-500 font-bold transition-colors mb-8 group"
          >
            <ArrowLeft size={20} />
            Back to collection
          </Link>

          {loadPhase ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="animate-spin text-brand-500" size={40} />
              <p className="text-gray-500 font-inter">Loading collection…</p>
            </div>
          ) : loadError ? (
            <div
              className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center"
              role="alert"
            >
              <p className="text-red-700 font-bold font-display mb-2">Cannot mint</p>
              <p className="text-red-600/90 text-sm font-inter">{loadError}</p>
              <button
                type="button"
                onClick={loadCollection}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-red-100 px-4 py-2 text-sm font-bold text-red-800 border border-red-200 hover:bg-red-200"
              >
                <RefreshCw size={14} />
                Retry
              </button>
            </div>
          ) : !metadata || record === null ? null : (
            <div className="space-y-6">
              <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest font-inter mb-1">
                  Collection
                </p>
                <h1 className="text-3xl font-display font-bold text-gray-900 mb-2">
                  {metadata.name}
                </h1>
                <p className="font-mono text-xs text-gray-500 break-all">
                  {address}
                </p>
                {record && (
                  <p className="mt-3 text-sm font-inter text-gray-600">
                    Type: <span className="font-bold">{record.kind}</span>
                    {isLazy
                      ? " — redeem a signed voucher as the buyer, or create vouchers off-chain as the creator."
                      : " — you must be the creator to mint new items."}
                  </p>
                )}
              </div>

              {txPhase === "success" && (
                <div
                  className="rounded-2xl border border-mint-500/30 bg-mint-50/50 p-6 flex gap-4"
                  role="status"
                >
                  <CheckCircle2 className="text-mint-500 shrink-0" size={28} />
                  <div>
                    <p className="font-bold text-gray-900 font-display">
                      Submitted successfully
                    </p>
                    {resultDetail && (
                      <p className="text-sm text-gray-700 font-inter mt-1">
                        {resultDetail}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={resetFlow}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-mint-500/15 px-4 py-2 text-sm font-bold text-mint-800 border border-mint-500/30"
                    >
                      <RefreshCw size={16} /> Start another
                    </button>
                  </div>
                </div>
              )}

              {(txPhase === "error" && txMessage) && (
                <div
                  className="rounded-2xl border border-red-200 bg-red-50 p-5 flex gap-3"
                  role="alert"
                >
                  <AlertCircle className="text-red-500 shrink-0" size={24} />
                  <div>
                    <p className="font-bold text-red-800 text-sm">Action failed</p>
                    <p className="text-sm text-red-700/90 font-inter mt-1">
                      {txMessage}
                    </p>
                    <button
                      type="button"
                      onClick={resetFlow}
                      className="mt-3 text-sm font-bold text-red-800 underline"
                    >
                      Dismiss and try again
                    </button>
                  </div>
                </div>
              )}

              {record && !isLazy && record.kind === "Normal721" && (
                <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm space-y-4">
                  <h2 className="text-xl font-display font-bold text-gray-900">
                    Mint (721)
                  </h2>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                    Recipient
                  </label>
                  <input
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 font-mono text-sm"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="G... destination"
                    disabled={isBusy}
                  />
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                    Metadata URI
                  </label>
                  <input
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm"
                    value={metadataCid}
                    onChange={(e) => setMetadataCid(e.target.value)}
                    placeholder="ipfs://... or https://..."
                    disabled={isBusy}
                  />
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={runMintNormal721}
                    className="w-full rounded-2xl bg-brand-500 py-4 text-white font-bold hover:bg-brand-600 disabled:opacity-50 shadow-lg shadow-brand-500/20"
                  >
                    {isBusy ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="animate-spin" size={20} />
                        {txPhase === "validating" ? "Checking…" : "Sign in Freighter…"}
                      </span>
                    ) : (
                      "Mint NFT"
                    )}
                  </button>
                </div>
              )}

              {record && !isLazy && record.kind === "Normal1155" && (
                <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm space-y-4">
                  <h2 className="text-xl font-display font-bold text-gray-900">
                    Mint (1155)
                  </h2>
                  <p className="text-sm text-gray-600 font-inter">
                    Mints a new token type via <code>mint_new</code> (creator only).
                  </p>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                    Recipient
                  </label>
                  <input
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 font-mono text-sm"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    disabled={isBusy}
                  />
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                    Amount
                  </label>
                  <input
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm"
                    value={amount1155}
                    onChange={(e) => setAmount1155(e.target.value)}
                    inputMode="numeric"
                    disabled={isBusy}
                  />
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                    Metadata URI
                  </label>
                  <input
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm"
                    value={metadataCid}
                    onChange={(e) => setMetadataCid(e.target.value)}
                    disabled={isBusy}
                  />
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={runMintNormal1155}
                    className="w-full rounded-2xl bg-brand-500 py-4 text-white font-bold hover:bg-brand-600 disabled:opacity-50"
                  >
                    {isBusy ? "Sign in Freighter…" : "Mint"}
                  </button>
                </div>
              )}

              {record && isLazy && record.kind === "LazyMint721" && (
                <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm space-y-4">
                  <h2 className="text-xl font-display font-bold text-gray-900">
                    Guided Voucher Builder (Lazy 721)
                  </h2>
                  <p className="text-sm text-gray-600 font-inter">
                    Fill in the voucher fields provided by the creator. The structured JSON will be generated for you. You pay gas (and the voucher price) as the connected wallet.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Token ID</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm" value={lazyTokenId} onChange={(e) => setLazyTokenId(e.target.value)} disabled={isBusy} placeholder="1" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Price</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm" value={lazyPrice} onChange={(e) => setLazyPrice(e.target.value)} disabled={isBusy} placeholder="0" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Currency Address</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 font-mono text-xs" value={lazyCurrency} onChange={(e) => setLazyCurrency(e.target.value)} disabled={isBusy} placeholder="C..." />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">URI</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm" value={lazyUri} onChange={(e) => setLazyUri(e.target.value)} disabled={isBusy} placeholder="ipfs://..." />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">URI Hash (64 hex chars)</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 font-mono text-xs" value={lazyUriHash} onChange={(e) => setLazyUriHash(e.target.value)} disabled={isBusy} placeholder="000..." />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Valid Until (Timestamp)</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm" value={lazyValidUntil} onChange={(e) => setLazyValidUntil(e.target.value)} disabled={isBusy} placeholder="0" />
                    </div>
                  </div>

                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mt-4">
                    Generated JSON Preview (Read-Only)
                  </label>
                  <p className="text-xs text-gray-400 mb-2">Creators: Copy this JSON to sign offline. Buyers: Verify it matches the creator&apos;s details.</p>
                  <textarea
                    className="w-full min-h-[180px] rounded-2xl border border-gray-200 bg-gray-50 p-4 font-mono text-xs text-gray-600 focus:outline-none"
                    value={derived721VoucherJson}
                    readOnly
                  />

                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mt-4">
                    Signature (128 hex)
                  </label>
                  <input
                    className={`w-full rounded-2xl border ${!isSignatureValid ? 'border-red-400 bg-red-50' : 'border-gray-200'} px-4 py-3 font-mono text-xs`}
                    value={signatureHex}
                    onChange={(e) => setSignatureHex(e.target.value)}
                    disabled={isBusy}
                    placeholder="128 hex chars"
                  />
                  {!isSignatureValid && <p className="text-xs text-red-500">Signature must be exactly 128 hex characters.</p>}

                  <button
                    type="button"
                    disabled={isBusy || !isSignatureValid || signatureHex.trim() === ""}
                    onClick={runRedeem721}
                    className="w-full rounded-2xl bg-brand-500 py-4 text-white font-bold hover:bg-brand-600 disabled:opacity-50 mt-2"
                  >
                    {isBusy ? "Sign in Freighter…" : "Redeem & mint"}
                  </button>
                </div>
              )}

              {record && isLazy && record.kind === "LazyMint1155" && (
                <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm space-y-4">
                  <h2 className="text-xl font-display font-bold text-gray-900">
                    Guided Voucher Builder (Lazy 1155)
                  </h2>
                  <p className="text-sm text-gray-600 font-inter">
                    Fill in the voucher fields provided by the creator. Edition caps must be registered
                    on-chain by the creator before redemption.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Token ID</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm" value={lazyTokenId} onChange={(e) => setLazyTokenId(e.target.value)} disabled={isBusy} placeholder="1" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Buyer Quota</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm" value={lazyBuyerQuota} onChange={(e) => setLazyBuyerQuota(e.target.value)} disabled={isBusy} placeholder="1" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Price Per Unit</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm" value={lazyPrice} onChange={(e) => setLazyPrice(e.target.value)} disabled={isBusy} placeholder="0" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Currency Address</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 font-mono text-xs" value={lazyCurrency} onChange={(e) => setLazyCurrency(e.target.value)} disabled={isBusy} placeholder="C..." />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">URI</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm" value={lazyUri} onChange={(e) => setLazyUri(e.target.value)} disabled={isBusy} placeholder="ipfs://..." />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">URI Hash (64 hex chars)</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 font-mono text-xs" value={lazyUriHash} onChange={(e) => setLazyUriHash(e.target.value)} disabled={isBusy} placeholder="000..." />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Valid Until (Timestamp)</label>
                      <input className="w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm" value={lazyValidUntil} onChange={(e) => setLazyValidUntil(e.target.value)} disabled={isBusy} placeholder="0" />
                    </div>
                  </div>

                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mt-4">
                    Generated JSON Preview (Read-Only)
                  </label>
                  <p className="text-xs text-gray-400 mb-2">Creators: Copy this JSON to sign offline. Buyers: Verify it matches the creator&apos;s details.</p>
                  <textarea
                    className="w-full min-h-[200px] rounded-2xl border border-gray-200 bg-gray-50 p-4 font-mono text-xs text-gray-600 focus:outline-none"
                    value={derived1155VoucherJson}
                    readOnly
                  />

                  <div className="grid grid-cols-1 gap-4 mt-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">
                        Units to mint
                      </label>
                      <input
                        className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm"
                        value={redeemAmount}
                        onChange={(e) => setRedeemAmount(e.target.value)}
                        inputMode="numeric"
                        disabled={isBusy}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">
                        Signature (128 hex)
                      </label>
                      <input
                        className={`w-full rounded-2xl border ${!isSignatureValid ? 'border-red-400 bg-red-50' : 'border-gray-200'} px-4 py-3 font-mono text-xs`}
                        value={signatureHex}
                        onChange={(e) => setSignatureHex(e.target.value)}
                        disabled={isBusy}
                        placeholder="128 hex chars"
                      />
                      {!isSignatureValid && <p className="text-xs text-red-500 mt-1">Signature must be exactly 128 hex characters.</p>}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isBusy || !isSignatureValid || signatureHex.trim() === ""}
                    onClick={runRedeem1155}
                    className="w-full rounded-2xl bg-brand-500 py-4 text-white font-bold hover:bg-brand-600 disabled:opacity-50 mt-2"
                  >
                    {isBusy ? "Sign in Freighter…" : "Redeem"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
