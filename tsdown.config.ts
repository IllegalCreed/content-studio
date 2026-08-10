import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/cli.ts',
    'src/host.ts',
    'src/installer-host.ts',
  ],
  format: [
    'esm',
  ],
  dts: true,
  exports: {
    bin: {
      'content-studio': './src/cli.ts',
      'content-studio-host': './src/host.ts',
    },
  },
  clean: true,
})
