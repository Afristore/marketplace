import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import HomePage from "../app/page";

// Mock intersection observer
class MockIntersectionObserver {
  observe = jest.fn();
  disconnect = jest.fn();
  unobserve = jest.fn();
}

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock useWalletContext
const mockConnect = jest.fn();
let mockIsConnected = false;
let mockIsConnecting = false;

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    isConnected: mockIsConnected,
    isConnecting: mockIsConnecting,
    connect: mockConnect,
  }),
}));

// Mock next/image
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: any) => {
    const { fill, priority, unoptimized, ...imgProps } = props;
    return <img {...imgProps} />;
  },
}));

// Mock components
jest.mock("@/components/FeaturedListings", () => ({
  FeaturedListings: () => <div data-testid="featured-listings"></div>,
}));

describe("HomePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls connect when disconnected CTA is clicked", () => {
    mockIsConnected = false;
    mockIsConnecting = false;

    render(<HomePage />);

    const ctas = screen.getAllByRole("button", {
      name: /get started|connect wallet & start/i,
    });
    expect(ctas.length).toBeGreaterThan(0);

    fireEvent.click(ctas[0]);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("routes to /explore when connected CTA is clicked", () => {
    mockIsConnected = true;
    mockIsConnecting = false;

    render(<HomePage />);

    const ctas = screen.getAllByRole("button", {
      name: /explore marketplace|go to marketplace/i,
    });
    expect(ctas.length).toBeGreaterThan(0);

    fireEvent.click(ctas[0]);
    expect(mockPush).toHaveBeenCalledWith("/explore");
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
