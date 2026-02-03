import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar } from '../popup/components/SearchBar';

describe('SearchBar', () => {
  it('renders input with placeholder', () => {
    render(<SearchBar value="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search archived tabs...')).toBeInTheDocument();
  });

  it('displays the provided value', () => {
    render(<SearchBar value="test query" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('test query')).toBeInTheDocument();
  });

  it('calls onChange after debounce delay', async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();

    render(<SearchBar value="" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Search archived tabs...');

    await user.type(input, 'hello');

    // onChange should not have been called yet (debounced)
    expect(onChange).not.toHaveBeenCalled();

    // Advance past debounce timeout (150ms)
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Should be called once with final value
    expect(onChange).toHaveBeenCalledWith('hello');

    vi.useRealTimers();
  });

  it('shows clear button when input has value and clears on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<SearchBar value="query" onChange={onChange} />);

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    expect(clearButton).toBeInTheDocument();

    await user.click(clearButton);

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('does not show clear button when input is empty', () => {
    render(<SearchBar value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('disables input when disabled prop is true', () => {
    render(<SearchBar value="" onChange={vi.fn()} disabled />);
    expect(screen.getByPlaceholderText('Search archived tabs...')).toBeDisabled();
  });

  it('updates internal value when value prop changes', () => {
    const { rerender } = render(<SearchBar value="old" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('old')).toBeInTheDocument();

    rerender(<SearchBar value="new" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('new')).toBeInTheDocument();
  });

  it('clear calls onChange with empty string immediately', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<SearchBar value="existing" onChange={onChange} />);

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    await user.click(clearButton);

    expect(onChange).toHaveBeenCalledWith('');
  });
});
