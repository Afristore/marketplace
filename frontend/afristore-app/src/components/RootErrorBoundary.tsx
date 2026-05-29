"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface RootErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  RootErrorBoundaryState
> {
  public state: RootErrorBoundaryState = {
    hasError: false,
    message: "",
  };

  public static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || "An unexpected error occurred.",
    };
  }

  public componentDidCatch(error: Error) {
    // Keep a breadcrumb for debugging while preventing a white screen for users.
    // eslint-disable-next-line no-console
    console.error("RootErrorBoundary caught an error:", error);
  }

  private reloadPage = () => {
    window.location.reload();
  };

  public render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
        <div className="mb-4 rounded-full bg-red-100 p-4 text-red-500">
          <AlertTriangle size={28} />
        </div>
        <h1 className="text-2xl font-display font-bold text-gray-900">
          Something went wrong
        </h1>
        <p className="mt-2 max-w-md text-sm text-gray-600">
          {this.state.message || "The app hit an unexpected error."}
        </p>
        <button
          type="button"
          onClick={this.reloadPage}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-600"
        >
          <RefreshCw size={14} />
          Reload app
        </button>
      </div>
    );
  }
}
