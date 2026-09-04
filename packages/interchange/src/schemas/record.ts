import { z } from "zod";

/** Preserve ordinary own `__proto__` keys that Zod 3 otherwise drops.
 * Every key is reversibly encoded while its value is schema-validated. */
export function recordSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .record(
      z.string().transform((key) => `:${key}`),
      valueSchema,
    )
    .transform((record): Record<string, z.output<T>> =>
      Object.fromEntries(
        Object.entries(record).map(([key, value]) => [key.slice(1), value]),
      ),
    );
}
