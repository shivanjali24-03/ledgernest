import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

/** Regression: a parent re-rendering on every keystroke (new onClose each time) must not steal focus. */
function Harness() {
  const [text, setText] = useState('');
  return (
    <Modal open onClose={() => setText('')} title="Typing test">
      <input aria-label="Field" value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}

describe('Modal', () => {
  it('keeps focus in a field while the parent re-renders on each keystroke', async () => {
    render(<Harness />);
    await userEvent.type(await screen.findByLabelText('Field'), 'meera@nestdemo.in');
    expect(screen.getByLabelText('Field')).toHaveValue('meera@nestdemo.in');
  });

  it('closes on Escape using the latest handler', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Modal open onClose={() => {}} title="Esc test" />);
    rerender(<Modal open onClose={onClose} title="Esc test" />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
