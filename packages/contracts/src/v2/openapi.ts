import { z } from 'zod';
import { getSelfResponse, PUBLIC_API_ISSUER, producedWebhookEventTypes, publicErrorSchema } from './api.ts';
import { v2Routes } from './operations.ts';

type JsonObject = Record<string, unknown>;
export interface OpenApiOperation {
  operationId: string;
  'x-logical-operation-id': string;
  'x-required-scopes': readonly string[];
  'x-rate-class': 'read' | 'write';
  parameters: JsonObject[];
  responses: Record<string, JsonObject>;
  security: JsonObject[];
  requestBody?: JsonObject;
}
export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, JsonObject>; securitySchemes: Record<string, JsonObject> };
  'x-produced-webhook-events': readonly string[];
}

export const selfResponseExamples = {
  workspace: {
    summary: 'Active Agentic CRM workspace token',
    value: {
      active: true,
      scope: 'object_configuration:read record_permission:read',
      client_id: '00000000-0000-4000-8000-000000000001',
      token_type: 'Bearer',
      exp: null,
      iat: 1792454400,
      sub: '00000000-0000-4000-8000-000000000002',
      aud: '00000000-0000-4000-8000-000000000001',
      iss: PUBLIC_API_ISSUER,
      token_level: 'workspace',
      workspace_id: '00000000-0000-4000-8000-000000000002',
      workspace_name: 'Example workspace',
      workspace_slug: 'example-workspace',
      workspace_logo_url: null,
    },
  },
  inactive: { summary: 'Unknown or revoked token', value: { active: false } },
};

/** Standard OpenAPI 3.1; schemas describe HTTP payloads, while Zod remains the runtime validation source. */
export function buildOpenApiDocument(): OpenApiDocument {
  const components: OpenApiDocument['components'] = {
    schemas: {},
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'A workspace or user API token. Required resource scopes are listed in x-required-scopes.',
      },
      basicAuth: { type: 'http', scheme: 'basic', description: 'API token as username, with an empty password.' },
    },
  };
  function schemaJson(schema: z.ZodType, io: 'input' | 'output'): JsonObject {
    const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { target: 'draft-2020-12', io });
    return json;
  }
  function schemaRef(name: string, schema: z.ZodType, io: 'input' | 'output'): JsonObject {
    const existing = components.schemas[name];
    const json = schemaJson(schema, io);
    if (existing && JSON.stringify(existing) !== JSON.stringify(json)) throw new Error(`Conflicting schema ${name}`);
    components.schemas[name] = json;
    return { $ref: `#/components/schemas/${name}` };
  }
  const error = schemaRef('PublicError', publicErrorSchema, 'output');
  const paths: OpenApiDocument['paths'] = {};
  for (const route of v2Routes) {
    const parameters: JsonObject[] = [];
    for (const [name, schema] of Object.entries(route.pathParams.shape)) {
      parameters.push({ name, in: 'path', required: true, schema: schemaJson(schema as z.ZodType, 'input') });
    }
    if (route.query) {
      for (const [name, schema] of Object.entries(route.query.shape)) {
        const field = schema as z.ZodType;
        parameters.push({ name, in: 'query', required: !field.isOptional(), schema: schemaJson(field, 'input') });
      }
    }
    const success: JsonObject = {
      description:
        route.responseStatus === 204
          ? 'Deleted; no response body.'
          : route.responseStatus === 302
            ? 'Redirect to a temporary download URL.'
            : 'Success',
    };
    if (route.responseStatus === 302)
      success.headers = {
        Location: {
          required: true,
          description: 'Temporary URL for downloading the file.',
          schema: { type: 'string', format: 'uri' },
        },
      };
    else if (route.responseSchema) {
      success.content = {
        'application/json': {
          schema: schemaRef(`${route.logicalOperationId}Response`, route.responseSchema, 'output'),
          ...(route.logicalOperationId === 'getSelf' ? { examples: selfResponseExamples } : {}),
        },
      };
    }
    const responses: OpenApiOperation['responses'] = { [route.responseStatus]: success };
    // Authentication, validation, authorization, lookup and service failures share one implemented envelope.
    // Operation-specific error codes remain in the handlers rather than a copied external error catalogue.
    for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 500]) {
      responses[status] = {
        description: `Request failed (${status}).`,
        content: { 'application/json': { schema: error } },
      };
    }
    responses[429] = {
      ...responses[429],
      headers: {
        'Retry-After': { description: 'HTTP date after which the request may be retried.', schema: { type: 'string' } },
      },
    };
    responses[401] = { ...responses[401], headers: { 'WWW-Authenticate': { schema: { type: 'string' } } } };
    const operation: OpenApiOperation = {
      operationId: route.operationId,
      'x-logical-operation-id': route.logicalOperationId,
      'x-required-scopes': route.scopes,
      'x-rate-class': route.rateClass,
      parameters,
      responses,
      security: [{ bearerAuth: [] }, { basicAuth: [] }],
      ...(route.body
        ? {
            requestBody: {
              required: route.bodyRequired ?? true,
              content: {
                [route.contentType ?? 'application/json']: {
                  schema: schemaRef(`${route.logicalOperationId}Body`, route.body, 'input'),
                },
              },
            },
          }
        : {}),
    };
    const methods = paths[route.path] ?? {};
    const method = route.method.toLowerCase();
    if (methods[method]) throw new Error(`Duplicate operation ${route.method} ${route.path}`);
    methods[method] = operation;
    paths[route.path] = methods;
  }
  for (const example of Object.values(selfResponseExamples)) getSelfResponse.parse(example.value);
  return {
    openapi: '3.1.0',
    info: {
      title: 'Agentic CRM API',
      version: '2',
      description:
        'The public REST interface implemented by Agentic CRM. API generation uses the in-repository schemas and route manifest.',
    },
    paths,
    components,
    'x-produced-webhook-events': producedWebhookEventTypes,
  };
}

export function renderOpenApiDocument(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}
