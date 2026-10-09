/*
 * The few Node calls the page tests make (reading the files in public/), and
 * nothing more. The repository does not depend on the Node typings; vitest runs
 * these tests in Node, where the modules exist.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function relative(from: string, to: string): string;
  export function extname(path: string): string;
}

declare const __dirname: string;
