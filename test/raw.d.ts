// Vitest runs on Vite, which can hand a test the text of a file. These two
// declarations give that feature its types; the project has no Node types.

declare module '*?raw' {
  const text: string;
  export default text;
}

interface ImportMeta {
  /** Vite's glob import. With `query: '?raw'`, `import: 'default'` and `eager: true` it gives each file's text by path. */
  glob<T = unknown>(pattern: string, options?: { query?: string; import?: string; eager?: boolean }): Record<string, T>;
}
