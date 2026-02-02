import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabItem } from '../popup/components/TabItem';

const tab = {
  id: 1,
  url: 'https://example.com/page',
  title: 'Example',
  closedAt: Date.now() - 60000,
  faviconUrl: 'https://example.com/favicon.ico',
};

describe('TabItem', () => {
  it('clears restoring state when restore fails', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn().mockResolvedValue(false);

    render(<TabItem tab={tab} onRestore={onRestore} />);

    const restoreButton = screen.getByRole('button', { name: 'Restore tab' });
    expect(restoreButton).not.toBeDisabled();

    await act(async () => {
      await user.click(restoreButton);
    });

    await waitFor(() => {
      expect(restoreButton).not.toBeDisabled();
    });
  });
});
