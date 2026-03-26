import { OpenAPIV3 } from "openapi-types";

export function normalizeSchema(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  seen: WeakSet<object> = new WeakSet(),
): Record<string, unknown> {
  if ("$ref" in schema) {
    return { type: "object" };
  }

  if (seen.has(schema)) {
    return { type: "object" };
  }
  seen.add(schema);

  try {
    const result: Record<string, unknown> = {};

    if (schema.type) {
      result.type = schema.type === "integer" ? "number" : schema.type;
    }
    if (schema.description) {
      result.description = schema.description;
    }
    if (schema.enum) {
      result.enum = schema.enum;
    }
    if (schema.default !== undefined) {
      result.default = schema.default;
    }
    if (schema.nullable && typeof result.type === "string") {
      result.type = [result.type, "null"];
    }
    if (schema.required) {
      result.required = schema.required;
    }

    if (schema.properties) {
      result.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [
          key,
          normalizeSchema(
            value as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
            seen,
          ),
        ]),
      );
    }

    if (
      schema.type === "array" &&
      "items" in schema &&
      schema.items &&
      typeof schema.items === "object"
    ) {
      result.items = normalizeSchema(
        schema.items as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
        seen,
      );
    }

    if (schema.oneOf) {
      result.oneOf = schema.oneOf.map((value) =>
        normalizeSchema(
          value as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
          seen,
        ),
      );
    }
    if (schema.anyOf) {
      result.anyOf = schema.anyOf.map((value) =>
        normalizeSchema(
          value as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
          seen,
        ),
      );
    }
    if (schema.allOf) {
      result.allOf = schema.allOf.map((value) =>
        normalizeSchema(
          value as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
          seen,
        ),
      );
    }

    return result;
  } finally {
    seen.delete(schema);
  }
}
