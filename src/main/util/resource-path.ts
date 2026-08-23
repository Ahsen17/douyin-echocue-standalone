import { app } from 'electron'
import { join } from 'path'

// Bundled resources (sidecar binaries, migration SQL, icons) are read from the
// repo root during development and from process.resourcesPath in the packaged
// app. electron-builder's extraResources `to` paths mirror the repo-relative
// path (electron-builder.yml), so one relative string resolves in both modes.
// `app` may be absent under a mocked `electron` in unit tests; that falls back
// to the dev path unless a caller pins `packaged` explicitly.
export function resolveResourcePath(relative: string, packaged?: boolean): string {
  const isPackaged = packaged ?? app?.isPackaged ?? false
  return isPackaged ? join(process.resourcesPath, relative) : join(process.cwd(), relative)
}
