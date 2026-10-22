# Marketplace Frontend Fixes - Issues #970, #1002, #1003, #1004, #1009, #1038

## Issue #970: Missing Error Handling in wallet-network.spec.ts ✅
**Priority**: High | **Difficulty**: Medium
**Problem**: Async operations lack try/catch, can cause unhandled promise rejections
**Fix**: Wrapped async logic in try/catch with proper error assertions
**Location**: frontend/afristore-app/e2e/wallet-network.spec.ts

## Issue #1002: Missing Error Handling in CreateListingModal.tsx ✅
**Priority**: High | **Difficulty**: Medium
**Problem**: Async operations lack error handlers, can crash React app
**Fix**: Added try/catch with Toast notifications and error states
**Location**: frontend/afristore-app/src/components/lending/CreateListingModal.tsx

## Issue #1003: Missing Error Handling in AdminConfigModal.tsx ✅
**Priority**: High | **Difficulty**: Medium
**Problem**: Async operations lack error handlers, can crash React app
**Fix**: Added try/catch with Toast notifications and error states
**Location**: frontend/afristore-app/src/components/lending/AdminConfigModal.tsx

## Issue #1004: Hardcoded strings in LenderDashboardTable.tsx ✅
**Priority**: Medium | **Difficulty**: Low
**Problem**: Hardcoded English strings prevent localization
**Fix**: Replaced with react-i18next translation keys, updated locale JSONs
**Location**: frontend/afristore-app/src/components/lending/LenderDashboardTable.tsx

All fixes: CI-ready, production-ready, user-friendly error UX.

## Issue #1009: Missing Error Handling in lendingHooks.test.tsx ✅
**Priority**: High | **Difficulty**: Medium
**Problem**: Async operations in the lending mutation hooks lacked try/catch and could leave floating promises, crashing the React app on a rejected contract call; the lending UI had no error states for the top-up and repay flows.
**Fix**: Wrapped every async interaction in try/catch, added success/error toast notifications and inline error states, introduced a non-throwing `useSafeToast` accessor, and added an unhandled-rejection guard to the test suite.
**Location**: frontend/afristore-app/src/__tests__/lendingHooks.test.tsx, src/hooks/useSafeToast.ts, src/hooks/useTransientErrorToast.ts, src/hooks/mutations/*, src/components/lending/TopUpCollateralModal.tsx, src/components/lending/RepayLoanModal.tsx

## Issue #1038: Missing Error Handling in useAdmin.test.tsx ✅
**Priority**: High | **Difficulty**: Medium
**Problem**: The admin hook tests performed async contract calls without try/catch or `.catch()` handlers, so a rejected call could escape as an unhandled promise rejection and crash the React tree instead of failing the test; the failures were also only asserted as "not none", so a swallowed error passed.
**Fix**: Awaited every async interaction inside a try/catch, asserted the hooks' `error` state (including the non-`Error` fallback message), added the missing failure paths for revoke, reinstate, token whitelist load, token removal and the admin lookup, and added an unhandled-rejection guard that fails the suite if any promise is ever left unhandled.
**Location**: frontend/afristore-app/src/__tests__/useAdmin.test.tsx
