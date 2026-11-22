'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { pinCodeSchema } from '@curenear/shared';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PincodeDto } from '@/lib/types';

export interface PinCodeMultiSelectProps {
  id?: string;
  label?: string;
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  error?: string;
  disabled?: boolean;
  help?: string;
}

/**
 * Territory PIN picker backed by the imported master directory: type to search
 * the directory, click (or press Enter) to add. A six-digit code the directory
 * does not know can still be added — the directory is a convenience, not a gate
 * — so onboarding keeps working before the CSV is imported.
 */
export function PinCodeMultiSelect({
  id,
  label = 'Territory PIN codes',
  value,
  onChange,
  max = 50,
  error,
  disabled,
  help,
}: PinCodeMultiSelectProps) {
  const generatedId = useId();
  const inputId = id ?? `pin-multi-${generatedId}`;
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<PincodeDto[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searched, setSearched] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setOptions([]);
      setSearched(false);
      return;
    }

    let cancelled = false;
    // Drop the previous query's rows so nothing stale shows under a new search.
    setOptions([]);
    setSearched(false);
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<PincodeDto[]>(
          `/api/v1/master/pincodes/search?q=${encodeURIComponent(needle)}`,
        );
        if (cancelled) return;
        setOptions(result.data);
        setSearched(true);
      } catch {
        if (!cancelled) setOptions([]);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const typed = query.trim();
  const typedIsPin = pinCodeSchema.safeParse(typed).success;
  // Selected codes are filtered at render so picking one does not refetch.
  const suggestions = options.filter((option) => !value.includes(option.pinCode));
  const typedAlreadyKnown = suggestions.some((option) => option.pinCode === typed);
  const canAddTyped = typedIsPin && !value.includes(typed) && !typedAlreadyKnown;
  const atMax = value.length >= max;

  function add(pinCode: string): void {
    if (atMax || value.includes(pinCode)) return;
    onChange([...value, pinCode]);
    setQuery('');
    setOptions([]);
    setActiveIndex(-1);
    setSearched(false);
  }

  function remove(pinCode: string): void {
    onChange(value.filter((entry) => entry !== pinCode));
  }

  return (
    <div>
      <Label htmlFor={inputId}>{label}</Label>

      {value.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1" aria-label="Selected PIN codes">
          {value.map((pinCode) => (
            <li key={pinCode}>
              <Badge tone="info" className="gap-1 font-mono">
                {pinCode}
                <button
                  type="button"
                  aria-label={`Remove PIN ${pinCode}`}
                  className="text-sky-900/70 hover:text-sky-900"
                  disabled={disabled}
                  onClick={() => remove(pinCode)}
                >
                  ×
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative">
        <Input
          id={inputId}
          placeholder={
            atMax ? `Limit of ${max} PIN codes reached` : 'Search PIN or office, e.g. 7000'
          }
          value={query}
          disabled={disabled || atMax}
          aria-invalid={Boolean(error)}
          aria-autocomplete="list"
          aria-expanded={open}
          role="combobox"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => {
            if (options.length > 0) setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
            } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              // Never submit the surrounding form from the picker.
              event.preventDefault();
              // Highlighted row first, then an exact typed match, then a code
              // the directory does not know.
              const option =
                suggestions[activeIndex] ?? suggestions.find((entry) => entry.pinCode === typed);
              if (option) {
                add(option.pinCode);
              } else if (canAddTyped) {
                add(typed);
              }
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />

        {open && query.trim().length >= 2 ? (
          <ul
            role="listbox"
            aria-label="PIN code matches"
            className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-card shadow-lg"
          >
            {suggestions.map((option, index) => (
              <li key={option.pinCode} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    add(option.pinCode);
                  }}
                  className={
                    index === activeIndex
                      ? 'flex w-full items-center justify-between gap-3 bg-accent px-3 py-2 text-left text-sm'
                      : 'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/60'
                  }
                >
                  <span className="font-mono">{option.pinCode}</span>
                  <span className="truncate text-muted-foreground">
                    {[option.officeName, option.districtName, option.stateName]
                      .filter((part): part is string => Boolean(part))
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}

            {searched && suggestions.length === 0 && !canAddTyped ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                No PIN codes match. Import the directory under Admin → Master data.
              </li>
            ) : null}

            {canAddTyped ? (
              <li role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    add(typed);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/60"
                >
                  <span className="font-mono">{typed}</span>
                  <span className="text-xs text-amber-700">Add anyway — not in the directory</span>
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="field-help">
          {help ??
            `Optional, up to ${max}. Picked from the PIN code directory and stored on the profile as reference only — staff still see just the providers they onboard.`}
        </p>
      )}
    </div>
  );
}
