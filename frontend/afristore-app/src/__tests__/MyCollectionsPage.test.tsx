import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyCollectionsPage from "@/app/launchpad/my-collections/page";
import { useCreatorCollections } from "@/hooks/useLaunchpad";

const mockUseCreatorCollections = jest.fn();
let mockIsConnected = true;
const mockRefresh = jest.fn();
const creator = "GCREATOR";
const collections = [
  {
    address: "CMASKS000000000000000000000000000000000000000000000000001",
    kind: "Normal721",
  },
  {
    address: "CBRONZE00000000000000000000000000000000000000000000000002",
    kind: "LazyMint1155",
  },
];

jest.mock("@/hooks/useLaunchpad", () => ({
  useCreatorCollections: (...args: Parameters<typeof useCreatorCollections>) =>
    mockUseCreatorCollections(...args),
}));
jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    isConnected: mockIsConnected,
    publicKey: mockIsConnected ? creator : null,
  }),
}));
jest.mock("@/components/Navbar", () => ({
  Navbar: () => <nav aria-label="Main navigation" />,
}));

describe("MyCollectionsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsConnected = true;
    mockUseCreatorCollections.mockReturnValue({
      collections: [],
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });
  });

  it("prompts a disconnected creator to connect without showing the collection grid or deployment CTA", () => {
    mockIsConnected = false;
    render(<MyCollectionsPage />);
    expect(
      screen.getByRole("heading", { name: "My Collections" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please connect your wallet to continue"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create Your First Collection" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "View Details" }),
    ).not.toBeInTheDocument();
    expect(mockUseCreatorCollections).toHaveBeenCalledWith(null);
  });

  it("shows a first-collection deployment CTA for a connected creator with no collections", () => {
    render(<MyCollectionsPage />);
    expect(mockUseCreatorCollections).toHaveBeenCalledWith(creator);
    expect(
      screen.getByRole("heading", { name: "No Collections Yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Create Your First Collection" }),
    ).toHaveAttribute("href", "/launchpad/create");
    expect(screen.getByRole("link", { name: "Create New" })).toHaveAttribute(
      "href",
      "/launchpad/create",
    );
  });

  it("renders every collection card with its type, active status and details destination", () => {
    mockUseCreatorCollections.mockReturnValue({
      collections,
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<MyCollectionsPage />);
    const details = screen.getAllByRole("link", { name: "View Details" });
    expect(details).toHaveLength(2);
    collections.forEach((collection, index) => {
      expect(details[index]).toHaveAttribute(
        "href",
        `/launchpad/collections/${collection.address}`,
      );
      const card = within(details[index].parentElement!.parentElement!);
      expect(card.getByRole("heading")).toHaveAttribute(
        "title",
        collection.address,
      );
      expect(
        card.getAllByText(collection.kind, { exact: true }).length,
      ).toBeGreaterThan(0);
      expect(card.getByText("Active")).toBeInTheDocument();
    });
    expect(screen.queryByText("No Collections Yet")).not.toBeInTheDocument();
  });

  it("filters collection addresses case-insensitively and distinguishes no matches from no collections", async () => {
    mockUseCreatorCollections.mockReturnValue({
      collections,
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<MyCollectionsPage />);
    const search = screen.getByPlaceholderText("Search by collection address…");
    await userEvent.type(search, "cmasks");
    expect(screen.getAllByRole("link", { name: "View Details" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("link", { name: "View Details" })).toHaveAttribute(
      "href",
      `/launchpad/collections/${collections[0].address}`,
    );
    await userEvent.clear(search);
    await userEvent.type(search, "missing");
    expect(screen.getByText("No Matching Collections")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create Your First Collection" }),
    ).not.toBeInTheDocument();
  });

  it("filters by collection kind and restores all cards", async () => {
    mockUseCreatorCollections.mockReturnValue({
      collections,
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<MyCollectionsPage />);
    const kind = screen.getByRole("combobox", {
      name: "Filter by collection type",
    });
    await userEvent.selectOptions(kind, "LazyMint1155");
    expect(screen.getAllByRole("link", { name: "View Details" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("link", { name: "View Details" })).toHaveAttribute(
      "href",
      `/launchpad/collections/${collections[1].address}`,
    );
    await userEvent.selectOptions(kind, "All");
    expect(screen.getAllByRole("link", { name: "View Details" })).toHaveLength(
      2,
    );
  });

  it("shows loading instead of a premature creator empty state", () => {
    mockUseCreatorCollections.mockReturnValue({
      collections: [],
      isLoading: true,
      error: null,
      refresh: mockRefresh,
    });
    render(<MyCollectionsPage />);
    expect(
      screen.getByText("Loading your collections from the ledger…"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No Collections Yet")).not.toBeInTheDocument();
  });

  it("shows a failed collection request and retries it", async () => {
    mockUseCreatorCollections.mockReturnValue({
      collections: [],
      isLoading: false,
      error: "Ledger unavailable",
      refresh: mockRefresh,
    });
    render(<MyCollectionsPage />);
    expect(screen.getByText("Ledger unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No Collections Yet")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
