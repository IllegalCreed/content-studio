// @env node

import type {
  ContentStudioMcpServer,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
} from './server'
import { describe, expect, it } from 'vitest'
import { createContentStudioMcpHttpServer } from './http'

const protocolVersion = '2026-07-28'

async function listen(
  server: ReturnType<typeof createContentStudioMcpHttpServer>['server'],
  path = '/mcp',
): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.once('error', reject)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('Expected a TCP server address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}${path}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  }
}

function createFakeServer(
  onMessage: (message: McpJsonRpcRequest) => McpJsonRpcResponse | undefined,
): ContentStudioMcpServer {
  return {
    handleMessage: async message => onMessage(message as McpJsonRpcRequest),
  }
}

function headers(method: string, name?: string): HeadersInit {
  return {
    'Accept': 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': protocolVersion,
    'Mcp-Method': method,
    ...(name === undefined ? {} : { 'Mcp-Name': name }),
    'Origin': 'http://localhost:3000',
  }
}

function metadata(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': {
      name: 'test-client',
      version: '1.0.0',
    },
    'io.modelcontextprotocol/protocolVersion': protocolVersion,
  }
}

describe('content studio Streamable HTTP MCP adapter', () => {
  it('validates modern headers and forwards a stateless JSON-RPC request', async () => {
    const messages: McpJsonRpcRequest[] = []
    const running = await listen(createContentStudioMcpHttpServer({
      server: createFakeServer((message) => {
        messages.push(message)
        return {
          id: message.id ?? null,
          jsonrpc: '2.0',
          result: { ok: true },
        }
      }),
    }).server)

    try {
      const response = await fetch(running.baseUrl, {
        body: JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'server/discover',
          params: { _meta: metadata() },
        }),
        headers: headers('server/discover'),
        method: 'POST',
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
      await expect(response.json()).resolves.toMatchObject({
        result: { ok: true },
      })
      expect(messages[0]).toMatchObject({
        id: 1,
        method: 'server/discover',
        params: {},
      })
    }
    finally {
      await running.close()
    }
  })

  it('requires a matching tool name and returns 202 for notifications', async () => {
    const messages: McpJsonRpcRequest[] = []
    const running = await listen(createContentStudioMcpHttpServer({
      server: createFakeServer((message) => {
        messages.push(message)
        return message.id === undefined
          ? undefined
          : { id: message.id, jsonrpc: '2.0', result: { ok: true } }
      }),
    }).server)

    try {
      const body = {
        id: 2,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          _meta: metadata(),
          arguments: {},
          name: 'get_project_view',
        },
      }
      const response = await fetch(running.baseUrl, {
        body: JSON.stringify(body),
        headers: headers('tools/call', 'get_project_view'),
        method: 'POST',
      })
      expect(response.status).toBe(200)
      expect(messages[0]?.params).toEqual({
        arguments: {},
        name: 'get_project_view',
      })

      const notification = await fetch(running.baseUrl, {
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/progress',
          params: { _meta: metadata() },
        }),
        headers: headers('notifications/progress'),
        method: 'POST',
      })
      expect(notification.status).toBe(202)
      expect(await notification.text()).toBe('')
    }
    finally {
      await running.close()
    }
  })

  it('rejects unsafe origins, missing protocol metadata, mismatched headers, and GET', async () => {
    const running = await listen(createContentStudioMcpHttpServer({
      server: createFakeServer(message => ({
        id: message.id ?? null,
        jsonrpc: '2.0',
        result: {},
      })),
    }).server)

    try {
      const baseBody = {
        id: 3,
        jsonrpc: '2.0',
        method: 'server/discover',
        params: { _meta: metadata() },
      }
      const invalidOrigin = await fetch(running.baseUrl, {
        body: JSON.stringify(baseBody),
        headers: {
          ...headers('server/discover'),
          Origin: 'https://evil.example',
        },
        method: 'POST',
      })
      expect(invalidOrigin.status).toBe(403)

      const missingMetadata = await fetch(running.baseUrl, {
        body: JSON.stringify({ ...baseBody, params: {} }),
        headers: headers('server/discover'),
        method: 'POST',
      })
      expect(missingMetadata.status).toBe(400)
      await expect(missingMetadata.json()).resolves.toMatchObject({
        error: { code: -32020 },
      })

      const mismatch = await fetch(running.baseUrl, {
        body: JSON.stringify(baseBody),
        headers: headers('tools/list'),
        method: 'POST',
      })
      expect(mismatch.status).toBe(400)
      await expect(mismatch.json()).resolves.toMatchObject({
        error: { code: -32020 },
      })

      const getResponse = await fetch(running.baseUrl, { method: 'GET' })
      expect(getResponse.status).toBe(405)
      expect(getResponse.headers.get('allow')).toBe('POST, OPTIONS')
    }
    finally {
      await running.close()
    }
  })

  it('keeps the endpoint bounded and supports explicit origins and encoded names', async () => {
    expect(() => createContentStudioMcpHttpServer({
      path: 'mcp',
      server: createFakeServer(() => undefined),
    })).toThrow(/absolute URL path/i)
    expect(() => createContentStudioMcpHttpServer({
      maxBodyBytes: 0,
      server: createFakeServer(() => undefined),
    })).toThrow(/maxBodyBytes/i)

    const handle = createContentStudioMcpHttpServer({
      allowedOrigins: ['https://allowed.example'],
      maxBodyBytes: 1024,
      path: '/custom-mcp',
      server: createFakeServer(message => ({
        id: message.id ?? null,
        jsonrpc: '2.0',
        result: { ok: true },
      })),
    })
    await expect(handle.close()).resolves.toBeUndefined()
    const running = await listen(handle.server, '/custom-mcp')

    try {
      const origin = await fetch(running.baseUrl.replace('/custom-mcp', '/wrong'), {
        method: 'GET',
      })
      expect(origin.status).toBe(404)

      const optionsResponse = await fetch(running.baseUrl, {
        headers: { Origin: 'https://allowed.example' },
        method: 'OPTIONS',
      })
      expect(optionsResponse.status).toBe(204)
      expect(optionsResponse.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')

      const tooLarge = await fetch(running.baseUrl, {
        body: 'x'.repeat(2_000),
        headers: {
          ...headers('server/discover'),
          'Content-Type': 'application/json',
          Origin: 'https://allowed.example',
        },
        method: 'POST',
      })
      expect(tooLarge.status).toBe(413)

      const invalidContentType = await fetch(running.baseUrl, {
        body: '{}',
        headers: {
          Accept: 'application/json, text/event-stream',
          Origin: 'https://allowed.example',
        },
        method: 'POST',
      })
      expect(invalidContentType.status).toBe(415)

      const invalidAccept = await fetch(running.baseUrl, {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://allowed.example',
        },
        method: 'POST',
      })
      expect(invalidAccept.status).toBe(406)

      const invalidJson = await fetch(running.baseUrl, {
        body: '{',
        headers: {
          ...headers('server/discover'),
          Origin: 'https://allowed.example',
        },
        method: 'POST',
      })
      expect(invalidJson.status).toBe(400)

      const invalidEnvelope = await fetch(running.baseUrl, {
        body: JSON.stringify({ nope: true }),
        headers: {
          ...headers('server/discover'),
          Origin: 'https://allowed.example',
        },
        method: 'POST',
      })
      expect(invalidEnvelope.status).toBe(400)

      const unsupportedVersion = await fetch(running.baseUrl, {
        body: JSON.stringify({
          id: 4,
          jsonrpc: '2.0',
          method: 'server/discover',
          params: { _meta: metadata() },
        }),
        headers: {
          ...headers('server/discover'),
          'MCP-Protocol-Version': '2025-11-25',
          Origin: 'https://allowed.example',
        },
        method: 'POST',
      })
      expect(unsupportedVersion.status).toBe(400)

      const missingName = await fetch(running.baseUrl, {
        body: JSON.stringify({
          id: 5,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            _meta: metadata(),
            arguments: {},
            name: 'get_project_view',
          },
        }),
        headers: {
          ...headers('tools/call'),
          Origin: 'https://allowed.example',
        },
        method: 'POST',
      })
      expect(missingName.status).toBe(400)

      const invalidName = await fetch(running.baseUrl, {
        body: JSON.stringify({
          id: 6,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            _meta: metadata(),
            arguments: {},
            name: 'get_project_view',
          },
        }),
        headers: {
          ...headers('tools/call', '=?base64?bad!?='),
          Origin: 'https://allowed.example',
        },
        method: 'POST',
      })
      expect(invalidName.status).toBe(400)

      const encodedName = '=?base64?Z2V0X3Byb2plY3Rfdmlldw==?='
      const encodedResponse = await fetch(running.baseUrl, {
        body: JSON.stringify({
          id: 7,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            _meta: metadata(),
            arguments: {},
            name: 'get_project_view',
          },
        }),
        headers: {
          ...headers('tools/call', encodedName),
          Origin: 'https://allowed.example',
        },
        method: 'POST',
      })
      expect(encodedResponse.status).toBe(200)
    }
    finally {
      await running.close()
    }
  })
})
