# Testing Setup

This project uses **Vitest** and **React Testing Library** for testing.

## Running Tests

```bash
# Run tests in watch mode (interactive)
npm test

# Run tests once
npm run test:run

# Run tests with UI interface
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

## Test Structure

Tests are co-located with components for easy access:
- Component tests: `ComponentName.test.tsx` next to `ComponentName.tsx`
- Hook tests: `useHookName.test.ts` next to `useHookName.ts`
- Utility tests: `utility.test.ts` next to `utility.ts`

## Writing Tests

### Basic Component Test

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const user = userEvent.setup();
    render(<MyComponent />);
    
    const button = screen.getByRole('button', { name: /click me/i });
    await user.click(button);
    
    expect(screen.getByText('Clicked!')).toBeInTheDocument();
  });
});
```

### Testing Hooks

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMyHook } from './useMyHook';

describe('useMyHook', () => {
  it('returns expected values', () => {
    const { result } = renderHook(() => useMyHook());
    expect(result.current.value).toBe('expected');
  });
});
```

## Best Practices

1. **Test behavior, not implementation** - Focus on what the user sees and does
2. **Use semantic queries** - Prefer `getByRole`, `getByLabelText` over `getByTestId`
3. **Keep tests simple** - One assertion per test when possible
4. **Use descriptive test names** - Test names should describe the behavior being tested
5. **Mock external dependencies** - Use Vitest's `vi.mock()` for API calls, external services

## Available Matchers

All Jest-DOM matchers are available:
- `toBeInTheDocument()`
- `toHaveClass()`
- `toHaveTextContent()`
- `toBeVisible()`
- And many more...

See [@testing-library/jest-dom](https://github.com/testing-library/jest-dom) for full list.
