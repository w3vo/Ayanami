/**
 * WebTorrent v3 is ESM-only and ships without TypeScript declarations. The
 * download task narrows the module through a local structural interface, so the
 * ambient declaration only needs to satisfy the dynamic import.
 */
declare module 'webtorrent' {
  const WebTorrent: unknown
  export default WebTorrent
}
