"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

interface RootErrorBoundaryState {
  hasError: boolean;
  message: string;
  eventId: string | null;
}

export class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  RootErrorBoundaryState
> {
  public state: RootErrorBoundaryState = {
    hasError: false,
    message: "",
    eventId: null,
  };

  public static getDerivedStateFromError(
    error: Error,
  ): Partial<RootErrorBoundaryState> {
    return {
      hasError: true,
      message: error.message || "An unexpected error occurred.",
    };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console for debugging
    console.error("RootErrorBoundary caught an error:", error, errorInfo);

    // Send to Sentry with additional context
    Sentry.withScope((scope: any) => {
      scope.setContext("errorBoundary", {
        componentStack: errorInfo.componentStack,
      });
      const eventId = Sentry.captureException(error);
      this.setState({ eventId });
    });
  }

  private reloadPage = () => {
    window.location.reload();
  };

  private reportFeedback = () => {
    if (this.state.eventId) {
      Sentry.showReportDialog({ eventId: this.state.eventId });
    }
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
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={this.reloadPage}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-600"
          >
            <RefreshCw size={14} />
            Reload app
          </button>
          {this.state.eventId && (
            <button
              type="button"
              onClick={this.reportFeedback}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              Report issue
            </button>
          )}
        </div>
      </div>
    );
  }
}
