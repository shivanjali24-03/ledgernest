import { fireEvent, screen, waitFor } from '@testing-library/react';

/**
 * Presses an action by its name: a button on the page, or an item under "More actions" (opening that menu
 * first). One step per call, so it can be retried inside waitFor while a page settles.
 */
export function press(name: string | RegExp) {
  const button = screen.queryAllByRole('button', { name }).at(-1);
  if (button) return fireEvent.click(button);
  const item = screen.queryAllByRole('menuitem', { name }).at(-1);
  if (item) return fireEvent.click(item);
  fireEvent.click(screen.getAllByRole('button', { name: 'More actions' }).at(-1)!);
}

/**
 * Opens a dialog from a page header action and returns it once it has stayed open. Plain clicks, retried:
 * headers re-render while their page's data loads, and a click can land while that happens.
 */
export async function openDialog(button: string, title: string | RegExp, timeout = 6000): Promise<HTMLElement> {
  const deadline = Date.now() + timeout;
  for (;;) {
    await waitFor(
      () => {
        if (!screen.queryByText(title)) press(button);
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
