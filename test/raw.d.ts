/** Vitest can import a file's text with the `?raw` suffix. The tests use it to read the source of the stand-in server. */
declare module '*?raw' {
  const text: string;
  export default text;
}
