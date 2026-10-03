// Wire zod schema → the JSON schema sent as output_config.format (structured outputs).
// The SDK helpers (zodOutputFormat / betaZodOutputFormat) fold `enum` and `const` into the description text, so the
// closed lists were never enforced by constrained decoding. This transform keeps them (the API supports enum, const,
// anyOf, allOf, $ref/$defs, the listed string formats, minItems 0/1, additionalProperties:false) and folds every other
// keyword into the description, like the SDK does. Responses are still validated client-side with the zod schema.
import { z } from "zod";

const STRING_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);
type Json = Record<string, unknown>;

function strict(input: Json): Json {
  const s: Json = { ...input };
  delete s.$schema;
  const out: Json = {};
  const take = (k: string): unknown => {
    const v = s[k];
    delete s[k];
    return v;
  };
  const defs = take("$defs");
  if (defs && typeof defs === "object") {
    out.$defs = Object.fromEntries(Object.entries(defs as Record<string, Json>).map(([k, v]) => [k, strict(v)]));
  }
  const ref = take("$ref");
  if (typeof ref === "string") {
    out.$ref = ref;
    return out;
  }
  const type = take("type");
  const anyOf = take("anyOf");
  const oneOf = take("oneOf");
  const allOf = take("allOf");
  if (Array.isArray(anyOf) || Array.isArray(oneOf)) out.anyOf = ((anyOf ?? oneOf) as Json[]).map(strict);
  else if (Array.isArray(allOf)) out.allOf = (allOf as Json[]).map(strict);
  if (type !== undefined) out.type = type;
  const description = take("description");
  if (typeof description === "string") out.description = description;
  const title = take("title");
  if (typeof title === "string") out.title = title;
  const en = take("enum");
  if (Array.isArray(en)) out.enum = en;
  if ("const" in s) out.const = take("const");
  if (type === "object") {
    const props = (take("properties") ?? {}) as Record<string, Json>;
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, strict(v)]));
    take("additionalProperties");
    out.additionalProperties = false;
    const required = take("required");
    if (Array.isArray(required)) out.required = required;
  } else if (type === "string") {
    const format = s.format;
    if (typeof format === "string" && STRING_FORMATS.has(format)) {
      out.format = format;
      delete s.format;
    }
  } else if (type === "array") {
    const items = take("items");
    if (items && typeof items === "object") out.items = strict(items as Json);
    const minItems = s.minItems;
    if (minItems === 0 || minItems === 1) {
      out.minItems = minItems;
      delete s.minItems;
    }
  }
  // every other keyword becomes a hint in the description (validated client-side by the zod schema)
  const rest = Object.entries(s).filter(([, v]) => v !== undefined);
  if (rest.length > 0) {
    const hint = `{${rest.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")}}`;
    out.description = typeof out.description === "string" ? `${out.description}\n\n${hint}` : hint;
  }
  return out;
}

const cache = new WeakMap<z.ZodType, Json>();

/** Strict JSON schema of a wire schema, with `enum`/`const` kept (memoised per schema object). */
export function wireJsonSchema(schema: z.ZodType): Json {
  let v = cache.get(schema);
  if (!v) {
    v = strict(z.toJSONSchema(schema, { reused: "inline", unrepresentable: "any" }) as Json);
    cache.set(schema, v);
  }
  return v;
}

/** output_config.format for a wire schema (no client-side `parse` hook: the client parses and validates itself). */
export function wireOutputFormat(schema: z.ZodType): { type: "json_schema"; schema: Json } {
  return { type: "json_schema", schema: wireJsonSchema(schema) };
}
