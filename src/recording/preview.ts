import type {
  ProjectPreviewAdapter,
  ProjectPreviewContext,
} from '../types'

export function createAttachedPreviewAdapter(
  baseUrlInput: string,
): ProjectPreviewAdapter {
  const baseUrl = validatePreviewBaseUrl(baseUrlInput)
  return {
    adapterId: 'attached-preview',
    open: async () => ({
      baseUrl,
      close: async () => {},
    }),
  }
}

export async function withProjectPreview<T>(
  adapter: ProjectPreviewAdapter,
  context: ProjectPreviewContext,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  if (adapter.adapterId.trim() === '')
    throw new Error('Project preview adapterId must not be empty')

  const handle = await adapter.open(context)
  try {
    return await run(validatePreviewBaseUrl(handle.baseUrl))
  }
  finally {
    await handle.close()
  }
}

function validatePreviewBaseUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  }
  catch {
    throw new Error('Project preview base URL must be valid HTTP(S)')
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username !== ''
    || url.password !== ''
  ) {
    throw new Error(
      'Project preview base URL must be HTTP(S) without credentials',
    )
  }
  return url.origin
}
