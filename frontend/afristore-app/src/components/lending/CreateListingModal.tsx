// ─────────────────────────────────────────────────────────────
// components/lending/CreateListingModal.tsx
// ─────────────────────────────────────────────────────────────
// Multi-step form for lenders creating a lending listing:
//   Step 1 — Set price and duration
//   Step 2 — Define the interest schedule array (bps / month)
//   Step 3 — Set buffer and liquidation-threshold bounds
// All inputs are validated with Zod schemas; submission goes
// through `useCreateListing`.
// ─────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Loader2,
  Percent,
  ShieldCheck,
  X,
} from "lucide-react";
import { z } from "zod";
import clsx from "clsx";
import { useCreateListing } from "@/hooks/useMarketplace";

// ── Zod schemas ──────────────────────────────────────────────

export const step1Schema = z.object({
  /** Declared price in USD (7-decimal fixed-point as string). */
  declaredPriceUsd: z
    .string()
    .min(1, "Price is required")
    .regex(/^\d+(\.\d+)?$/, "Price must be a positive number")
    .refine((v) => Number(v) > 0, "Price must be greater than zero"),
  /** Maximum loan duration in days. */
  maxDurationDays: z
    .string()
    .min(1, "Duration is required")
    .regex(/^\d+$/, "Duration must be a whole number of days")
    .refine((v) => Number(v) >= 1 && Number(v) <= 365, "Duration must be 1–365 days"),
});

export const step2Schema = z.object({
  /** Comma-separated monthly interest rates in bps (e.g. "300,350,400"). */
  interestScheduleBps: z
    .string()
    .min(1, "Interest schedule is required")
    .refine(
      (v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .every((s) => /^\d+$/.test(s) && Number(s) > 0 && Number(s) <= 10000),
      "Each rate must be a whole number of bps between 1 and 10000",
    )
    .refine(
      (v) => v.split(",").length >= 1 && v.split(",").length <= 36,
      "Schedule must contain between 1 and 36 monthly rates",
    ),
});

export const step3Schema = z
  .object({
    /** Minimum collateral buffer in bps (e.g. 12000 = 120%). */
    minCollateralBufferBps: z
      .string()
      .min(1, "Collateral buffer is required")
      .regex(/^\d+$/, "Buffer must be a whole number of bps"),
    /** Liquidation threshold in bps (e.g. 11000 = 110%). */
    liquidationThresholdBps: z
      .string()
      .min(1, "Liquidation threshold is required")
      .regex(/^\d+$/, "Threshold must be a whole number of bps"),
  })
  .refine(
    (v) =>
      Number(v.minCollateralBufferBps) >= 10000 &&
      Number(v.minCollateralBufferBps) <= 30000,
    "Collateral buffer must be between 10000 (100%) and 30000 (300%) bps",
  )
  .refine(
    (v) =>
      Number(v.liquidationThresholdBps) >= 5000 &&
      Number(v.liquidationThresholdBps) <= 20000,
    "Liquidation threshold must be between 5000 (50%) and 20000 (200%) bps",
  )
  .refine(
    (v) =>
      Number(v.liquidationThresholdBps) * 10000 <
      Number(v.minCollateralBufferBps) * 10000,
    "Liquidation threshold must be lower than the collateral buffer",
  );

export const createListingFormSchema = step1Schema
  .merge(step2Schema)
  .and(step3Schema);

export type CreateListingFormValues = {
  declaredPriceUsd: string;
  maxDurationDays: string;
  interestScheduleBps: string;
  minCollateralBufferBps: string;
  liquidationThresholdBps: string;
};

export interface CreateListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Connected lender public key. */
  lenderPublicKey: string | null;
  /** NFT collection contract address to list. */
  collectionAddress: string;
  /** Token id of the NFT to list. */
  nftTokenId: number;
  /** Optional payment token address (defaults to platform token). */
  tokenAddress?: string;
  /** Called after the listing is successfully created on-chain. */
  onSuccess?: (listingId: number) => void;
}

const STEPS = [
  { id: 1, label: "Price & Duration", icon: CalendarClock },
  { id: 2, label: "Interest Schedule", icon: Percent },
  { id: 3, label: "Risk Bounds", icon: ShieldCheck },
] as const;

const INITIAL_VALUES: CreateListingFormValues = {
  declaredPriceUsd: "",
  maxDurationDays: "",
  interestScheduleBps: "",
  minCollateralBufferBps: "",
  liquidationThresholdBps: "",
};

const STEP_SCHEMAS = [
  step1Schema,
  step2Schema,
  step3Schema,
] as const;

export function CreateListingModal({
  isOpen,
  onClose,
  lenderPublicKey,
  collectionAddress,
  nftTokenId,
  tokenAddress,
  onSuccess,
}: CreateListingModalProps) {
  const { create, isCreating, progress, error: hookError } =
    useCreateListing(lenderPublicKey);
  const [step, setStep] = useState(1);
  const [values, setValues] = useState<CreateListingFormValues>(INITIAL_VALUES);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Reset state whenever the modal is opened.
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setValues(INITIAL_VALUES);
      setFieldErrors({});
    }
  }, [isOpen]);

  // Close on Escape for accessibility.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const setField = useCallback((name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const validateStep = useCallback(
    (currentStep: number): boolean => {
      const schema = STEP_SCHEMAS[currentStep - 1];
      const result = schema.safeParse(values);
      if (result.success) {
        setFieldErrors({});
        return true;
      }
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return false;
    },
    [values],
  );

  const handleNext = () => {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, 3));
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 1));

  const handleSubmit = async () => {
    if (!validateStep(3)) return;
    // Final whole-form validation across every step.
    const allValid =
      step1Schema.safeParse(values).success &&
      step2Schema.safeParse(values).success &&
      step3Schema.safeParse(values).success;
    if (!allValid) {
      setStep(1);
      return;
    }

    const listingId = await create({
      collectionAddress,
      nftTokenId,
      price: Number(values.declaredPriceUsd),
      tokenAddress,
    });
    if (listingId !== null) {
      onSuccess?.(listingId);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      data-testid="create-listing-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Create lending listing"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-midnight-900 border border-white/10 p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Create Lending Listing</h2>
            <p className="text-xs text-white/50">
              Step {step} of 3 — {STEPS[step - 1].label}
            </p>
          </div>
          <button
            type="button"
            data-testid="create-listing-close"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <StepIndicator step={step} />

        <div className="mt-5 space-y-4">
          {step === 1 && (
            <Step1Fields values={values} errors={fieldErrors} onChange={setField} />
          )}
          {step === 2 && (
            <Step2Fields values={values} errors={fieldErrors} onChange={setField} />
          )}
          {step === 3 && (
            <Step3Fields values={values} errors={fieldErrors} onChange={setField} />
          )}
        </div>

        {(hookError || progress) && (
          <p
            data-testid={hookError ? "create-listing-error" : undefined}
            className={clsx(
              "mt-4 text-xs",
              hookError ? "text-red-300" : "text-white/50",
            )}
          >
            {hookError || progress}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          {step > 1 && (
            <button
              type="button"
              onClick={handleBack}
              disabled={isCreating}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/70 ring-1 ring-white/10 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <ArrowLeft size={15} /> Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              data-testid="create-listing-next"
              onClick={handleNext}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-mint-500 px-4 py-2.5 text-sm font-bold text-midnight-900 transition-opacity hover:opacity-90"
            >
              Next <ArrowRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              data-testid="create-listing-submit"
              onClick={handleSubmit}
              disabled={isCreating || !lenderPublicKey}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-mint-500 px-4 py-2.5 text-sm font-bold text-midnight-900 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating && <Loader2 size={15} className="animate-spin" />}
              {isCreating ? "Creating…" : "Create Listing"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {STEPS.map(({ id, label, icon: Icon }) => (
        <div key={id} className="flex flex-1 flex-col items-center gap-1.5">
          <div
            className={clsx(
              "flex h-9 w-9 items-center justify-center rounded-xl ring-1 transition-colors",
              id <= step
                ? "bg-mint-500/15 text-mint-400 ring-mint-500/30"
                : "bg-white/5 text-white/30 ring-white/10",
            )}
          >
            <Icon size={16} />
          </div>
          <span
            className={clsx(
              "text-[10px] font-semibold uppercase tracking-wide",
              id === step ? "text-white" : "text-white/30",
            )}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

const inputClasses =
  "w-full rounded-xl bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 ring-1 ring-white/10 outline-none transition-shadow focus:ring-mint-500/50";

function Field({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={`create-listing-${name}`}
        className="mb-1.5 block text-xs font-semibold text-white/70"
      >
        {label}
      </label>
      {children}
      {error && (
        <p
          data-testid={`error-${name}`}
          className="mt-1.5 text-xs text-red-300"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

interface StepFieldsProps {
  values: CreateListingFormValues;
  errors: Record<string, string>;
  onChange: (name: string, value: string) => void;
}

function Step1Fields({ values, errors, onChange }: StepFieldsProps) {
  return (
    <>
      <Field label="Declared Price (USD)" name="declaredPriceUsd" error={errors.declaredPriceUsd}>
        <input
          id="create-listing-declaredPriceUsd"
          type="text"
          inputMode="decimal"
          placeholder="e.g. 250.00"
          className={inputClasses}
          value={values.declaredPriceUsd}
          onChange={(e) => onChange("declaredPriceUsd", e.target.value)}
        />
      </Field>
      <Field
        label="Max Loan Duration (days)"
        name="maxDurationDays"
        error={errors.maxDurationDays}
      >
        <input
          id="create-listing-maxDurationDays"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 90"
          className={inputClasses}
          value={values.maxDurationDays}
          onChange={(e) => onChange("maxDurationDays", e.target.value)}
        />
      </Field>
    </>
  );
}

function Step2Fields({ values, errors, onChange }: StepFieldsProps) {
  return (
    <Field
      label="Monthly Interest Schedule (bps, comma-separated)"
      name="interestScheduleBps"
      error={errors.interestScheduleBps}
    >
      <input
        id="create-listing-interestScheduleBps"
        type="text"
        placeholder="e.g. 300, 350, 400"
        className={inputClasses}
        value={values.interestScheduleBps}
        onChange={(e) => onChange("interestScheduleBps", e.target.value)}
      />
      <p className="mt-1.5 text-[11px] text-white/40">
        Enter the monthly interest rate in basis points for each month
        (10000 bps = 100%). The last rate repeats for remaining months.
      </p>
    </Field>
  );
}

function Step3Fields({ values, errors, onChange }: StepFieldsProps) {
  return (
    <>
      <Field
        label="Min Collateral Buffer (bps)"
        name="minCollateralBufferBps"
        error={errors.minCollateralBufferBps}
      >
        <input
          id="create-listing-minCollateralBufferBps"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 12000 (= 120%)"
          className={inputClasses}
          value={values.minCollateralBufferBps}
          onChange={(e) => onChange("minCollateralBufferBps", e.target.value)}
        />
      </Field>
      <Field
        label="Liquidation Threshold (bps)"
        name="liquidationThresholdBps"
        error={errors.liquidationThresholdBps}
      >
        <input
          id="create-listing-liquidationThresholdBps"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 11000 (= 110%)"
          className={inputClasses}
          value={values.liquidationThresholdBps}
          onChange={(e) => onChange("liquidationThresholdBps", e.target.value)}
        />
      </Field>
    </>
  );
}

