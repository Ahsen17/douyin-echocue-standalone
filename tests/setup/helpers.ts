import { expect } from 'vitest';

export function expectValid<T>(
  schema: { parse: (input: unknown) => T },
  value: unknown,
  label?: string
): void {
  expect(() => schema.parse(value), label).not.toThrow();
}

export function expectInvalid<T>(
  schema: { parse: (input: unknown) => T },
  value: unknown,
  label?: string
): void {
  expect(() => schema.parse(value), label).toThrow();
}
