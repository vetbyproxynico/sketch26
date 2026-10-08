import { configDefaults, defineConfig } from 'vitest/config';

// Local agent worktrees under .claude/ hold other checkouts of this repository;
// their tests are not this project's tests.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
