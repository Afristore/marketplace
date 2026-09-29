// ─────────────────────────────────────────────────────────────
// context/LendingContext.tsx — Global lending UI state (#730)
// ─────────────────────────────────────────────────────────────

"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  ReactNode,
  useMemo,
} from "react";

// ── Types ──────────────────────────────────────────────────────

export interface SelectedNFT {
  contractId: string;
  tokenId: string;
  name?: string;
  imageUrl?: string;
}

export interface LendingUIState {
  /** NFT currently selected for listing / offering */
  selectedNFT: SelectedNFT | null;
  /** Which modal is open, if any */
  activeModal: "list" | "borrow" | "repay" | "details" | null;
  /** Whether the listing sidebar panel is expanded */
  isSidebarOpen: boolean;
  /** Active filter values for the borrow page */
  filters: {
    collection: string | null;
    tokenType: string | null;
  };
}

type LendingAction =
  | { type: "SELECT_NFT"; payload: SelectedNFT | null }
  | { type: "OPEN_MODAL"; payload: LendingUIState["activeModal"] }
  | { type: "CLOSE_MODAL" }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "SET_FILTER"; payload: Partial<LendingUIState["filters"]> }
  | { type: "RESET_FILTERS" };

// ── Reducer ────────────────────────────────────────────────────

const initialState: LendingUIState = {
  selectedNFT: null,
  activeModal: null,
  isSidebarOpen: false,
  filters: {
    collection: null,
    tokenType: null,
  },
};

function lendingReducer(
  state: LendingUIState,
  action: LendingAction,
): LendingUIState {
  switch (action.type) {
    case "SELECT_NFT":
      return { ...state, selectedNFT: action.payload };
    case "OPEN_MODAL":
      return { ...state, activeModal: action.payload };
    case "CLOSE_MODAL":
      return { ...state, activeModal: null };
    case "TOGGLE_SIDEBAR":
      return { ...state, isSidebarOpen: !state.isSidebarOpen };
    case "SET_FILTER":
      return {
        ...state,
        filters: { ...state.filters, ...action.payload },
      };
    case "RESET_FILTERS":
      return { ...state, filters: initialState.filters };
    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────────

interface LendingContextValue extends LendingUIState {
  selectNFT: (nft: SelectedNFT | null) => void;
  openModal: (modal: LendingUIState["activeModal"]) => void;
  closeModal: () => void;
  toggleSidebar: () => void;
  setFilter: (patch: Partial<LendingUIState["filters"]>) => void;
  resetFilters: () => void;
}

const LendingContext = createContext<LendingContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────

export function LendingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(lendingReducer, initialState);

  const selectNFT = useCallback(
    (nft: SelectedNFT | null) => dispatch({ type: "SELECT_NFT", payload: nft }),
    [],
  );
  const openModal = useCallback(
    (modal: LendingUIState["activeModal"]) =>
      dispatch({ type: "OPEN_MODAL", payload: modal }),
    [],
  );
  const closeModal = useCallback(() => dispatch({ type: "CLOSE_MODAL" }), []);
  const toggleSidebar = useCallback(
    () => dispatch({ type: "TOGGLE_SIDEBAR" }),
    [],
  );
  const setFilter = useCallback(
    (patch: Partial<LendingUIState["filters"]>) =>
      dispatch({ type: "SET_FILTER", payload: patch }),
    [],
  );
  const resetFilters = useCallback(
    () => dispatch({ type: "RESET_FILTERS" }),
    [],
  );

  const value = useMemo(
    () => ({
      ...state,
      selectNFT,
      openModal,
      closeModal,
      toggleSidebar,
      setFilter,
      resetFilters,
    }),
    [state, selectNFT, openModal, closeModal, toggleSidebar, setFilter, resetFilters],
  );

  return (
    <LendingContext.Provider value={value}>{children}</LendingContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────

export function useLendingContext(): LendingContextValue {
  const ctx = useContext(LendingContext);
  if (!ctx) {
    throw new Error("useLendingContext must be used inside <LendingProvider>");
  }
  return ctx;
}
