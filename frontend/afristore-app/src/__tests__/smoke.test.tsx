import React from "react";
import { render, screen } from "@testing-library/react";
import { Navbar } from "@/components/Navbar";

// Mock the wallet context
jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    publicKey: null,
    isConnected: false,
    isConnecting: false,
    disconnect: jest.fn(),
    isWrongNetwork: false,
    status: "disconnected",
    notifications: {
      notifications: [],
      unreadCount: 0,
      markAllAsRead: jest.fn(),
    },
  }),
}));

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useRouter: () => ({
    push: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

describe("Smoke Test: Navigation and Route Rendering", () => {
  it("renders the Launchpad link in the Navbar", () => {
    render(<Navbar />);
    const launchpadLinks = screen.getAllByText(/Launchpad/i);
    expect(launchpadLinks.length).toBeGreaterThan(0);
  });

  it("contains the correct href for Launchpad", () => {
    render(<Navbar />);
    const launchpadLink = screen.getAllByRole("link", {
      name: /Launchpad/i,
    })[0];
    expect(launchpadLink).toHaveAttribute("href", "/launchpad");
  });
});
