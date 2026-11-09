import { fireEvent, screen, waitFor } from '@testing-library/react';

/**
 * Opens a dialog from a page header button and returns it once it has stayed open. Plain clicks, retried:
 * headers re-render while their page's data loads, and a click can land while that happens.
 */
export async function openDialog(button: string, title: string | RegExp, timeout = 6000): Promise<HTMLElement> {
  const deadline = Date.now() + timeout;
  for (;;) {
    await waitFor(
      () => {
        if (!screen.queryByText(title)) fireEvent.click(screen.getByRole('button', { name: button }));
        expect(screen.getByText(title)).toBeInTheDocument();
      },
      { timeout: Math.max(500, deadline - Date.now()) },
    );
    // Still open a moment later: it took
    await new Promise((r) => setTimeout(r, 200));
    const heading = screen.queryByText(title);
    if (heading) return heading.closest('[role="dialog"]') as HTMLElement;
    if (Date.now() > deadline) throw new Error(`The “${button}” dialog kept closing`);
  }
}
