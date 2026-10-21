import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuctionForm } from "@/components/AuctionForm";
import { DEFAULT_TOKEN, type TokenConfig } from "@/config/tokens";

const mockCreate = jest.fn();
let mockTokens: TokenConfig[] = [];
let mockError: string | null = null;

jest.mock("@/hooks/useAuctions", () => ({
  useCreateAuction: () => ({
    create: mockCreate,
    isCreating: false,
    progress: "",
    error: mockError,
  }),
}));
jest.mock("@/hooks/useSupportedTokens", () => ({
  useSupportedTokens: () => ({ tokens: mockTokens }),
}));
jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    publicKey: "GCREATOR",
    isConnected: true,
    isWrongNetwork: false,
  }),
}));
jest.mock("@/components/ConnectWalletModal", () => ({
  ConnectWalletModal: () => null,
}));
jest.mock("@/components/ListingForm", () => ({
  ART_CATEGORIES: ["Painting", "Sculpture"],
}));

const artwork = new File(["artwork"], "artwork.png", { type: "image/png" });
const secondToken = {
  ...DEFAULT_TOKEN,
  address: "CUSDC",
  name: "USD Coin",
  symbol: "USDC",
};

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Artwork image"), {
    target: { files: [artwork] },
  });
  fireEvent.change(screen.getByLabelText(/Title/), {
    target: { value: "Savanna Mask" },
  });
  fireEvent.change(screen.getByLabelText(/Artist Name/), {
    target: { value: "Ada" },
  });
}

describe("AuctionForm", () => {
  beforeAll(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:artwork"),
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTokens = [DEFAULT_TOKEN, secondToken];
    mockError = null;
    mockCreate.mockResolvedValue(42);
  });

  it.each([0, -1])(
    "rejects reserve price %s with a visible error and no auction request",
    async (price) => {
      render(<AuctionForm />);
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/Reserve Price/), {
        target: { value: String(price) },
      });

      await userEvent.click(
        screen.getByRole("button", { name: "Create Auction" }),
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Reserve price must be greater than zero.",
      );
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  it.each([0, 0.5, 721, 720.5])(
    "rejects duration %s outside the whole-hour bounds",
    async (hours) => {
      render(<AuctionForm />);
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/Duration/), {
        target: { value: String(hours) },
      });

      await userEvent.click(
        screen.getByRole("button", { name: "Create Auction" }),
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Duration must be between 1 and 720 hours (30 days), in whole hours.",
      );
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  it.each([1, 720])(
    "accepts the inclusive duration boundary of %s hours",
    async (hours) => {
      const onSuccess = jest.fn();
      render(<AuctionForm onSuccess={onSuccess} />);
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/Reserve Price/), {
        target: { value: "0.0000001" },
      });
      fireEvent.change(screen.getByLabelText(/Duration/), {
        target: { value: String(hours) },
      });
      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: /Payment Token/ }),
        secondToken.address,
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Create Auction" }),
      );

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Savanna Mask",
          artistName: "Ada",
          imageFile: artwork,
          reservePriceXlm: 0.0000001,
          durationHours: hours,
          tokenAddress: secondToken.address,
        }),
      );
      expect(
        await screen.findByText("Auction #42 Created!"),
      ).toBeInTheDocument();
      expect(onSuccess).toHaveBeenCalledWith(42);
    },
  );

  it("shows only the supported currencies and updates the reserve-price label when selected", async () => {
    render(<AuctionForm />);
    const currencies = screen.getByRole("combobox", { name: /Payment Token/ });
    expect(
      Array.from(
        currencies.querySelectorAll("option"),
        (option) => option.value,
      ),
    ).toEqual([DEFAULT_TOKEN.address, secondToken.address]);
    await userEvent.selectOptions(currencies, secondToken.address);
    expect(screen.getByLabelText("Reserve Price (USDC) *")).toBeInTheDocument();
  });

  it("selects a supported token when the default currency is not whitelisted", () => {
    mockTokens = [secondToken];
    render(<AuctionForm />);
    expect(screen.getByRole("combobox", { name: /Payment Token/ })).toHaveValue(
      secondToken.address,
    );
  });

  it("prevents creation when no currencies are available", () => {
    mockTokens = [];
    render(<AuctionForm />);
    fillRequiredFields();
    expect(
      screen.getByRole("combobox", { name: /Payment Token/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create Auction" }),
    ).toBeDisabled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("lets the creator correct invalid values and submit successfully", async () => {
    render(<AuctionForm />);
    fillRequiredFields();
    const duration = screen.getByLabelText(/Duration/);
    fireEvent.change(duration, { target: { value: "721" } });
    await userEvent.click(
      screen.getByRole("button", { name: "Create Auction" }),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(duration, { target: { value: "24" } });
    await userEvent.click(
      screen.getByRole("button", { name: "Create Auction" }),
    );
    expect(await screen.findByText("Auction #42 Created!")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders transaction errors from the auction hook", () => {
    mockError = "Wallet rejected the transaction";
    render(<AuctionForm />);
    expect(screen.getByRole("alert")).toHaveTextContent(mockError);
  });
});
