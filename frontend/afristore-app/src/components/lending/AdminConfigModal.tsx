"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useUpdateBounds, validateBounds } from "@/hooks/mutations/useUpdateBounds";

interface AdminConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  adminPublicKey: string | null;
}

export function AdminConfigModal({
  isOpen,
  onClose,
  adminPublicKey,
}: AdminConfigModalProps) {
  const { update, isUpdating, error } = useUpdateBounds(adminPublicKey);
  
  const [minBufferBps, setMinBufferBps] = useState("1000");
  const [maxBufferBps, setMaxBufferBps] = useState("3000");
  const [minLiqThresholdBps, setMinLiqThresholdBps] = useState("8000");
  const [maxLiqThresholdBps, setMaxLiqThresholdBps] = useState("9500");
  
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    
    const bounds = {
      minBufferBps: Number(minBufferBps),
      maxBufferBps: Number(maxBufferBps),
      minLiqThresholdBps: Number(minLiqThresholdBps),
      maxLiqThresholdBps: Number(maxLiqThresholdBps),
    };
    
    const validation = validateBounds(bounds);
    if (!validation.valid) {
      setLocalError(validation.error);
      return;
    }
    
    const success = await update(bounds);
    if (success) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-midnight-950/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 p-6">
          <h2 className="font-display text-xl font-bold text-gray-900">
            Admin Configuration
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {(error || localError) && (
              <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
                {localError || error}
              </div>
            )}
            
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Min Collateral Buffer (bps)
              </label>
              <input
                type="number"
                value={minBufferBps}
                onChange={(e) => setMinBufferBps(e.target.value)}
                className="w-full rounded-xl border-2 border-gray-100 p-3 text-gray-900 outline-none transition focus:border-brand-500"
                required
              />
            </div>
            
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Max Collateral Buffer (bps)
              </label>
              <input
                type="number"
                value={maxBufferBps}
                onChange={(e) => setMaxBufferBps(e.target.value)}
                className="w-full rounded-xl border-2 border-gray-100 p-3 text-gray-900 outline-none transition focus:border-brand-500"
                required
              />
            </div>
            
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Min Liquidation Threshold (bps)
              </label>
              <input
                type="number"
                value={minLiqThresholdBps}
                onChange={(e) => setMinLiqThresholdBps(e.target.value)}
                className="w-full rounded-xl border-2 border-gray-100 p-3 text-gray-900 outline-none transition focus:border-brand-500"
                required
              />
            </div>
            
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Max Liquidation Threshold (bps)
              </label>
              <input
                type="number"
                value={maxLiqThresholdBps}
                onChange={(e) => setMaxLiqThresholdBps(e.target.value)}
                className="w-full rounded-xl border-2 border-gray-100 p-3 text-gray-900 outline-none transition focus:border-brand-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isUpdating}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 font-bold text-white shadow-lg shadow-brand-500/20 hover:bg-brand-600 transition-all disabled:opacity-50"
            >
              {isUpdating ? (
                <>
                  <Loader2 className="animate-spin" size={18} /> Updating...
                </>
              ) : (
                "Save Configuration"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
