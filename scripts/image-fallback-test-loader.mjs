import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/src');
export async function resolve(specifier, context, nextResolve) {
  // Unit tests execute server-side helpers outside Next's server bundler.
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {};', shortCircuit: true };
  const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2))
    : specifier.startsWith('.') && context.parentURL?.startsWith('file:')
      ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier) : null;
  if (base) for (const name of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(name) && /\.[cm]?[jt]sx?$/.test(name)) return { url: pathToFileURL(name).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
