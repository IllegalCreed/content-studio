// @env node

import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type {
  ContentStudioMcpServer,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
} from './server'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

const DEFAULT_MCP_PATH = '/mcp'
const DEFAULT_MAX_BODY_BYTES = 256 * 1024
const PROTOCOL_VERSION = '2026-07-28'
const HEADER_MISMATCH_CODE = -32020

export interface ContentStudioMcpHttpServerOptions {
  allowedOrigins?: readonly string[]
  maxBodyBytes?: number
  path?: string
  server: ContentStudioMcpServer
}

export interface ContentStudioMcpHttpServerHandle {
  close: () => Promise<void>
  server: Server
}

/**
 * Wraps the stateless MCP server in the 2026-07-28 POST transport.
 *
 * This adapter deliberately has no session store and does not add an
 * authentication or publishing authority boundary. Callers that expose it
 * beyond localhost must provide an explicit origin allowlist and an external
 * authentication layer.
 */
export function createContentStudioMcpHttpServer(
  options: ContentStudioMcpHttpServerOptions,
): ContentStudioMcpHttpServerHandle {
  const path = options.path ?? DEFAULT_MCP_PATH
  if (!path.startsWith('/') || path.includes('?') || path.includes('#'))
    throw new Error('MCP HTTP path must be an absolute URL path')
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1)
    throw new Error('MCP HTTP maxBodyBytes must be a positive integer')

  const server = createServer((request, response) => {
    void handleRequest(
      request,
      response,
      options.server,
      path,
      options.allowedOrigins,
      maxBodyBytes,
    )
  })

  return {
    close: () => closeServer(server),
    server,
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  server: ContentStudioMcpServer,
  path: string,
  allowedOrigins: readonly string[] | undefined,
  maxBodyBytes: number,
): Promise<void> {
  const origin = headerValue(request, 'origin')
  if (origin !== undefined && !isAllowedOrigin(origin, allowedOrigins)) {
    response.writeHead(403)
    response.end()
    return
  }
  setCorsHeaders(response, origin)

  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (requestUrl.pathname !== path) {
    sendJson(response, 404, protocolError(null, -32601, 'MCP endpoint not found'))
    return
  }

  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
    )
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST, OPTIONS')
    response.writeHead(405)
    response.end()
    return
  }

  const contentType = headerValue(request, 'content-type')
  if (contentType === undefined || contentType.split(';', 1)[0]!.trim().toLowerCase() !== 'application/json') {
    sendJson(response, 415, protocolError(null, -32600, 'MCP requests must use application/json'))
    return
  }
  const accept = headerValue(request, 'accept')
  if (!acceptsStreamableHttp(accept)) {
    sendJson(response, 406, protocolError(null, -32600, 'MCP requests must accept application/json and text/event-stream'))
    return
  }

  let bodyText: string
  try {
    bodyText = await readBody(request, maxBodyBytes)
  }
  catch (error: unknown) {
    const status = error instanceof HttpInputError ? error.status : 400
    sendJson(response, status, protocolError(null, -32700, error instanceof Error ? error.message : 'Invalid MCP request body'))
    return
  }

  let body: unknown
  try {
    body = JSON.parse(bodyText) as unknown
  }
  catch {
    sendJson(response, 400, protocolError(null, -32700, 'Invalid JSON'))
    return
  }

  const requestId = requestIdOf(body)
  const validationError = validateRequestEnvelope(body, request)
  if (validationError !== undefined) {
    sendJson(response, 400, protocolError(requestId, HEADER_MISMATCH_CODE, validationError))
    return
  }

  const requestWithMetadata = body as McpJsonRpcRequest
  const result = await server.handleMessage(requestWithMetadata)
  if (requestWithMetadata.id === undefined || result === undefined) {
    response.writeHead(202)
    response.end()
    return
  }

  const status = result.error?.code === -32601 ? 404 : 200
  sendJson(response, status, result)
}

function validateRequestEnvelope(
  input: unknown,
  request: IncomingMessage,
): string | undefined {
  if (!isRecord(input) || input.jsonrpc !== '2.0' || typeof input.method !== 'string')
    return 'MCP request must be a JSON-RPC 2.0 request or notification'

  const protocolHeader = headerValue(request, 'mcp-protocol-version')
  if (protocolHeader !== PROTOCOL_VERSION)
    return `MCP-Protocol-Version must be ${PROTOCOL_VERSION}`

  const protocolInBody = protocolVersionOf(input.params)
  if (protocolInBody !== protocolHeader)
    return 'MCP-Protocol-Version does not match request metadata'

  const methodHeader = headerValue(request, 'mcp-method')
  if (methodHeader !== input.method)
    return 'Mcp-Method does not match the JSON-RPC method'

  const expectedName = requestName(input.method, input.params)
  if (requiresName(input.method)) {
    const nameHeader = headerValue(request, 'mcp-name')
    if (nameHeader === undefined)
      return 'Mcp-Name is required for this method'
    let decodedName: string
    try {
      decodedName = decodeHeaderValue(nameHeader)
    }
    catch {
      return 'Mcp-Name contains an invalid encoded value'
    }
    if (expectedName === undefined || decodedName !== expectedName)
      return 'Mcp-Name does not match the request parameter'
  }
  return undefined
}

function protocolVersionOf(params: unknown): string | undefined {
  if (!isRecord(params) || !isRecord(params._meta))
    return undefined
  const version = params._meta['io.modelcontextprotocol/protocolVersion']
  return typeof version === 'string' ? version : undefined
}

function requestName(method: string, params: unknown): string | undefined {
  if (!isRecord(params))
    return undefined
  if (method === 'tools/call' || method === 'prompts/get')
    return typeof params.name === 'string' ? params.name : undefined
  if (method === 'resources/read')
    return typeof params.uri === 'string' ? params.uri : undefined
  return undefined
}

function requiresName(method: string): boolean {
  return method === 'tools/call'
    || method === 'prompts/get'
    || method === 'resources/read'
}

function requestIdOf(input: unknown): string | number | null {
  if (!isRecord(input))
    return null
  const id = input.id
  return id === null || typeof id === 'string' || typeof id === 'number'
    ? id
    : null
}

function decodeHeaderValue(value: string): string {
  if (!value.startsWith('=?base64?') || !value.endsWith('?=')) {
    for (const character of value) {
      const code = character.codePointAt(0)!
      if (code !== 9 && (code < 32 || code > 126))
        throw new Error('Header value is not visible ASCII')
    }
    return value
  }
  const encoded = value.slice('=?base64?'.length, -2)
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded))
    throw new Error('Header value is not valid base64')
  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  if (Buffer.from(decoded, 'utf8').toString('base64') !== encoded)
    throw new Error('Header value is not valid base64')
  return decoded
}

function acceptsStreamableHttp(value: string | undefined): boolean {
  if (value === undefined)
    return false
  const accepted = new Set(
    value.split(',').map(item => item.split(';', 1)[0]!.trim().toLowerCase()),
  )
  return accepted.has('application/json') && accepted.has('text/event-stream')
}

function headerValue(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name.toLowerCase()]
  return typeof value === 'string' ? value : undefined
}

function isAllowedOrigin(
  origin: string,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  if (allowedOrigins !== undefined)
    return allowedOrigins.includes(origin)
  try {
    const url = new URL(origin)
    return url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  }
  catch {
    return false
  }
}

function setCorsHeaders(
  response: ServerResponse,
  origin: string | undefined,
): void {
  if (origin === undefined)
    return
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
}

function isRecord(input: unknown): input is Record<string, any> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function protocolError(
  id: string | number | null,
  code: number,
  message: string,
): McpJsonRpcResponse {
  return {
    error: { code, message },
    id,
    jsonrpc: '2.0',
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: McpJsonRpcResponse,
): void {
  const body = JSON.stringify(payload)
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.writeHead(status)
  response.end(body)
}

function readBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer | string) => {
      if (tooLarge)
        return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.byteLength
      if (total > maxBytes) {
        tooLarge = true
        return
      }
      chunks.push(buffer)
    })
    request.once('end', () => {
      if (tooLarge) {
        reject(new HttpInputError(413, `MCP request body exceeds ${maxBytes} bytes`))
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    request.once('error', error => reject(error))
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(error => error === undefined ? resolve() : reject(error))
  })
}

class HttpInputError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpInputError'
  }
}
