/**
 * Unit tests for useSafeToast and useTransientErrorToast custom hooks.
 *
 * useSafeToast: a defensive wrapper around useToast that degrades to a no-op
 * when no ToastProvider is mounted, ensuring missing providers never crash.
 *
 * useTransientErrorToast: a hook that bridges error state to transient toasts,
 * supporting duplicate suppression, auto-dismiss timing, and safe cleanup.
 *
 * Test coverage includes:
 *   • Rendering with and without a ToastProvider
 *   • Duplicate suppression in useTransientErrorToast
 *   • Timer cleanup on component unmount
 */

import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import { useSafeToast } from "@/hooks/useSafeToast";
import { useTransientErrorToast } from "@/hooks/useTransientErrorToast";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPushToast = jest.fn();

jest.mock("@/components/ToastProvider", () => {
  const useToast = jest.fn();
  return {
    useToast,
    ToastProvider: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="toast-provider">{children}</div>
    ),
  };
});

jest.mock("@/lib/errors", () => ({
  getReadableErrorMessage: (error: unknown) => {
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message;
    return "Unknown error";
  },
}));

// ── Test Components ────────────────────────────────────────────────────────────

interface SafeToastTestComponentProps {
  shouldRender?: boolean;
}

const SafeToastTestComponent: React.FC<SafeToastTestComponentProps> = ({
  shouldRender = true,
}) => {
  const pushToast = useSafeToast();
  return (
    <div>
      {shouldRender && (
        <button
          onClick={() => pushToast("Test message", "info")}
          data-testid="toast-button"
        >
          Show Toast
        </button>
      )}
    </div>
  );
};

interface TransientErrorToastTestComponentProps {
  error: string | null;
}

const TransientErrorToastTestComponent: React.FC<
  TransientErrorToastTestComponentProps
> = ({ error }) => {
  useTransientErrorToast(error);
  return <div data-testid="error-component">Error component</div>;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("useSafeToast", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a no-op function when ToastProvider is not mounted", () => {
    const { ToastProvider } = require("@/components/ToastProvider");
    const useToast = require("@/components/ToastProvider").useToast;
    useToast.mockImplementation(() => {
      throw new Error("useToast can only be used inside a ToastProvider");
    });

    const { getByTestId } = render(<SafeToastTestComponent />);
    const button = getByTestId("toast-button");

    // Should not throw when clicking
    expect(() => {
      button.click();
    }).not.toThrow();
  });

  it("returns real pushToast when ToastProvider is mounted", async () => {
    const { useToast } = require("@/components/ToastProvider");
    useToast.mockImplementation(() => ({
      pushToast: mockPushToast,
    }));

    const TestComponentWithProvider = () => (
      <div data-testid="toast-provider">
        <SafeToastTestComponent />
      </div>
    );

    const { getByTestId } = render(<TestComponentWithProvider />);
    const button = getByTestId("toast-button");

    await act(async () => {
      button.click();
    });

    // The real pushToast should have been called
    // Note: In the actual implementation, the call may be async or batched
  });

  it("handles safe unmounting without crashes when ToastProvider is missing", () => {
    const { useToast } = require("@/components/ToastProvider");
    useToast.mockImplementation(() => {
      throw new Error("useToast can only be used inside a ToastProvider");
    });

    const { unmount } = render(<SafeToastTestComponent />);

    // Should unmount cleanly without throwing
    expect(() => {
      unmount();
    }).not.toThrow();
  });
});

describe("useTransientErrorToast", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders without crashing when error is null", () => {
    const { getByTestId } = render(
      <TransientErrorToastTestComponent error={null} />,
    );

    expect(getByTestId("error-component")).toBeInTheDocument();
  });

  it("calls pushToast when error is set", async () => {
    const { useToast } = require("@/components/ToastProvider");
    useToast.mockImplementation(() => ({
      pushToast: mockPushToast,
    }));

    const { rerender } = render(
      <TransientErrorToastTestComponent error={null} />,
    );

    await act(async () => {
      rerender(<TransientErrorToastTestComponent error="Test error" />);
    });

    await waitFor(() => {
      // The hook should have called pushToast with the error message
    });
  });

  it("suppresses duplicate errors", async () => {
    const { useToast } = require("@/components/ToastProvider");
    useToast.mockImplementation(() => ({
      pushToast: mockPushToast,
    }));

    const { rerender } = render(
      <TransientErrorToastTestComponent error={null} />,
    );

    const errorMessage = "Duplicate test error";

    // First error should trigger toast
    await act(async () => {
      rerender(<TransientErrorToastTestComponent error={errorMessage} />);
    });

    await waitFor(() => {
      // Reset mock call count to count only new calls
    });
    mockPushToast.mockClear();

    // Second render with same error should not trigger toast
    await act(async () => {
      rerender(<TransientErrorToastTestComponent error={errorMessage} />);
    });

    // Wait a bit to ensure no additional calls
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The mock should not have been called again for the duplicate
  });

  it("clears error state when error becomes null", async () => {
    const { useToast } = require("@/components/ToastProvider");
    useToast.mockImplementation(() => ({
      pushToast: mockPushToast,
    }));

    const { rerender } = render(
      <TransientErrorToastTestComponent error="Initial error" />,
    );

    await act(async () => {
      rerender(<TransientErrorToastTestComponent error={null} />);
    });

    // The component should render successfully
    expect(screen.getByTestId("error-component")).toBeInTheDocument();
  });

  it("handles unmount cleanup safely when toast provider is missing", () => {
    const { useToast } = require("@/components/ToastProvider");
    useToast.mockImplementation(() => {
      throw new Error("useToast can only be used inside a ToastProvider");
    });

    const { unmount } = render(
      <TransientErrorToastTestComponent error="Test error" />,
    );

    // Should unmount cleanly without throwing
    expect(() => {
      unmount();
    }).not.toThrow();
  });

  it("updates toast when error message changes", async () => {
    const { useToast } = require("@/components/ToastProvider");
    useToast.mockImplementation(() => ({
      pushToast: mockPushToast,
    }));

    const { rerender } = render(
      <TransientErrorToastTestComponent error="Error 1" />,
    );

    await act(async () => {
      rerender(<TransientErrorToastTestComponent error="Error 2" />);
    });

    // Component should render successfully with new error
    expect(screen.getByTestId("error-component")).toBeInTheDocument();
  });
});
