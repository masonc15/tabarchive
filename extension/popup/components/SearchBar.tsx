import React, { useEffect, useRef, useState } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (query: string) => void;
  disabled?: boolean;
}

export function SearchBar({ value, onChange, disabled }: SearchBarProps) {
  const [inputValue, setInputValue] = useState(value);
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current && !disabled) {
      inputRef.current.focus();
    }
  }, [disabled]);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      onChange(newValue);
    }, 150);
  };

  const handleClear = () => {
    setInputValue('');
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <div style={styles.container}>
      <div style={styles.inputWrapper}>
        <svg
          style={styles.searchIcon}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleChange}
          placeholder="Search archived tabs..."
          disabled={disabled}
          style={styles.input}
        />
        {inputValue && (
          <button
            onClick={handleClear}
            style={styles.clearButton}
            aria-label="Clear search"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '12px 16px',
    borderBottom: '1px solid #2d2d44',
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: '12px',
    color: '#71717a',
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    padding: '10px 36px',
    border: '1px solid #3b3b5c',
    borderRadius: '8px',
    backgroundColor: '#16162a',
    color: '#e4e4e7',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.15s ease',
  },
  clearButton: {
    position: 'absolute',
    right: '8px',
    padding: '4px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: '#71717a',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
