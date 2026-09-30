# Error Handling & i18n Implementation Guide

## Issues Fixed
- #970: wallet-network.spec.ts error handling
- #1002: CreateListingModal.tsx error handling
- #1003: AdminConfigModal.tsx error handling
- #1004: LenderDashboardTable.tsx i18n support

## Error Handling Pattern (Issues #970, #1002, #1003)

### Component-Level Error Handling

```typescript
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

const handleAsyncOperation = async () => {
  try {
    setIsLoading(true);
    setError(null);
    
    // Validate inputs
    if (!isValid) {
      throw new Error('Validation failed');
    }
    
    // Perform async operation
    const result = await apiCall();
    
    // Success feedback
    toast.success('Operation successful');
    onSuccess(result);
  } catch (error: any) {
    console.error('Operation failed:', error);
    
    const errorMessage = error?.message || 'Operation failed';
    setError(errorMessage);
    toast.error(errorMessage);
  } finally {
    setIsLoading(false);
  }
};
```

### E2E Test Error Handling

```typescript
test('async operation', async ({ page }) => {
  try {
    await page.goto('/');
    await page.click('[data-testid="button"]');
    expect(await page.textContent('[data-testid="result"]')).toBe('Success');
  } catch (error) {
    console.error('Test failed:', error);
    throw error; // Re-throw to fail test
  }
});
```

### Error UI Components

```typescript
// Loading State
{isLoading && <Spinner text="Loading..." />}

// Error Display
{error && (
  <Alert variant="error">
    <AlertIcon />
    {error}
    <Button onClick={() => setError(null)}>Dismiss</Button>
  </Alert>
)}

// Button Loading State
<Button disabled={isLoading}>
  {isLoading ? 'Loading...' : 'Submit'}
</Button>
```

## i18n Implementation (Issue #1004)

### Setup react-i18next

```typescript
import { useTranslation } from 'react-i18next';

const MyComponent = () => {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t('lending.table.borrower')}</h1>
      <button>{t('lending.actions.approve')}</button>
    </div>
  );
};
```

### Translation Key Structure

```
lending.json
├── table (table headers)
├── actions (button labels)
├── status (status labels)
├── empty (empty states)
├── errors (error messages)
├── success (success messages)
└── tooltips (tooltip text)
```

### Currency & Date Formatting

```typescript
// Currency
{new Intl.NumberFormat(i18n.language, { 
  style: 'currency', 
  currency: 'USD' 
}).format(amount)}

// Date
{new Intl.DateTimeFormat(i18n.language).format(new Date(date))}
```

### Adding New Languages

1. Create locale file: `public/locales/{lang}/lending.json`
2. Copy English structure
3. Translate all values
4. Update i18n config to include new language

## Testing

### Error Handling Tests

```typescript
// Test error state
test('shows error on failure', async () => {
  mockApi.mockRejectedValue(new Error('API Error'));
  
  render(<MyComponent />);
  fireEvent.click(screen.getByText('Submit'));
  
  expect(await screen.findByText('API Error')).toBeInTheDocument();
});

// Test loading state
test('shows loading state', async () => {
  render(<MyComponent />);
  fireEvent.click(screen.getByText('Submit'));
  
  expect(screen.getByText('Loading...')).toBeInTheDocument();
});
```

### i18n Tests

```typescript
test('renders translated text', () => {
  const { t } = useTranslation();
  render(<MyComponent />);
  
  expect(screen.getByText(t('lending.actions.approve'))).toBeInTheDocument();
});
```

## CI Requirements

All changes must pass:
- ESLint checks
- TypeScript type checks
- Unit tests
- E2E tests
- Build without errors

## Files Modified

1. **frontend/afristore-app/e2e/wallet-network.spec.ts**
   - Added try/catch to all async test operations
   - Added error assertion tests

2. **frontend/afristore-app/src/components/lending/CreateListingModal.tsx**
   - Added error state management
   - Wrapped async operations in try/catch
   - Added Toast notifications
   - Added loading states

3. **frontend/afristore-app/src/components/lending/AdminConfigModal.tsx**
   - Added error state management
   - Wrapped async operations in try/catch
   - Added Toast notifications
   - Added validation before save

4. **frontend/afristore-app/src/components/lending/LenderDashboardTable.tsx**
   - Replaced hardcoded strings with t() calls
   - Added useTranslation hook
   - Created locale JSON file

5. **frontend/afristore-app/public/locales/en/lending.json** (new)
   - Complete translation keys for lending module
