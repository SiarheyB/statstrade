# Project Test Coverage Plan
**Goal**: Achieve ≥ 90 % test coverage across the entire codebase.

---
 
## 1️⃣ Current Situation
- **Total source files**: ~187 (`*.ts`, `*.tsx`)
- **Existing test files**: 3 (`orderflow.test.ts`, `timezone.test.ts`, `riskManager.test.ts`)
- **Overall coverage** (Vitest): ~0.82 % (Statements) / 56.7 % Branches / 45.3 % Functions / 0.82 % Lines
- **Core gaps**:
  - 180+ library modules lack any tests.
  - 56 API routes have no validation or auth testing.
  - UI components are largely untested.

---
 
## 2️⃣ Prioritization Matrix
| Priority | Area | Rationale |
|----------|------|-----------|
| **P0** | `src/lib/*` (analytics, risk, mt, crypto, format) | Business‑critical calculations; bugs have direct financial impact. |
| **P1** | `src/app/api/**/route.ts` | Handles auth, validation, DB writes, external exchange calls. |
| **P2** | `src/components/*` | Renders data from the libs & API; tests UI interactions. |
| **P3** | Miscellaneous helpers & configs | Low‑risk but contributes to overall %.
 
---
 
## 3️⃣ Testing Strategy
 
### 3.1 Unit Tests
- **Target**: Pure functions in `src/lib/**/*.ts`.
- **Tools**: `vitest` + `expect` assertions.
- **Pattern**:
  ```ts
  import { myFunction } from '@/lib/some-util';
  it('handles valid input', () => {
    expect(myFunction('UTC+3')).toBe('UTC+3');
  });
  ```
 
### 3.2 Integration Tests
- **Target**: API routes + mocked auth + mocked Prisma.
- **Tools**: `vitest`, mocked `@/lib/api` (unauthorized, badRequest, serverError), `supertest`‑style request.
- **Pattern**:
  ```ts
  vi.mock('@/lib/api', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/@types/api')>();
    return {
      ...(await importOriginal()),
      getAuthUser: vi.fn().mockResolvedValue({ id: 'test-user' }),
      unauthorized: () => new NextResponse({ error: 'Unauthorized' }, { status: 401 }),
    };
  });
  ```
 
### 3.3 Component Tests
- **Target**: React components (`*.tsx`).
- **Tools**: `@testing-library/react`, `userEvent`.
- **Pattern**:
  ```tsx
  import { render, screen } from '@testing-library/react';
  import MyComponent from '@/components/MyButton';
  it('renders primary button', () => {
    render(<MyComponent variant="primary" />);
    expect(screen.getByRole('button', { name: /primary/i })).toBeInTheDocument();
  });
  ```
 
### 3.4 End‑to‑End (Playwright)
- **Target**: Critical user journeys (login → dashboard → order‑flow).
- **Tools**: `@playwright/test`.
- **Pattern**: 
  ```ts
  test('full trade flow', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name=email]', 'user@example.com');
    await page.click('[type=submit]');
    await page.goto('/dashboard/orderflow');
    await expect(page.locator('[data-test=order-map]')).toBeVisible();
  });
  ```
 
---
 
## 4️⃣ Production‑Ready Test Setup
 
1. **Add coverage config** (`vite.config.ts`):
   ```ts
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import { defineConfig } from 'vitest/config';
   export default defineConfig({
     plugins: [react()],
     test: {
       globals: true,
       environment: 'jsdom',
       coverage: {
         provider: 'v8',
         reporter: ['text', 'json', 'html'],
       },
     },
   });
   ```
 
2. **Enable `vitest/ui`** for visual coverage diffing.
 
3. **Create `src/__mocks__/api.ts`** with shared mock functions (auth, error handlers).
 
4. **Add a `test-matrix.ts`** in the repo root:
   - Lists every source file, LOC, public API count, priority.
   - Used by CI to verify new tests cover “high‑priority” files first.
 
---
 
## 4️⃣ Step‑by‑Step Execution Plan
 
| Week | Target Coverage | Action Items |
|------|----------------|--------------|
| **Week 1** | **≈ 15 %** | - Scaffold `coverage-plan.md` and `test-matrix.ts`. ⟨ВЫПОЛНЕННО⟩ <br>- Generate template `route.test.ts` and place it in every `src/app/api/**/route.ts`. <br>- Write basic unit test for `normalizeTimezone` (happy path, invalid, fallback). ⟨ВЫПОЛНЕННО⟩ |
| **Week 2** | **≈ 45 %** | - Write unit tests for all functions in `src/lib/analytics/*` (metrics, positions, monteCarlo, materialize, exitEfficiency, exitAnalysis). ⟨ВЫПОЛНЕНО⟩ <br>- Consolidate `src/lib` unit test suite: normalize test file locations (remove duplicate nested `src/lib/__tests__/src/lib/__tests__/` path), add `crypto.test.ts`, `metric-defs.test.ts`, `i18n/core.test.ts`, `ratelimit/scheduler/sync` tests. ⟨ВЫПОЛНЕННО⟩ <br>- Add integration tests for the 5 largest routes (`/api/admin/collector/*`, `/api/orderflow/*`, `/api/stats/*`, `/api/liqmap/*`, `/api/econcal/*`). ⟨ВЫПОЛНЕННО⟩ <br>  ▸ Shared route-mock helper `src/lib/__tests__/helpers/routeMocks.ts` (auth/admin/prisma). <br>  ▸ Covered handlers: `admin/collector` (GET), `admin/collector/config` (GET/PUT/DELETE), `admin/collector/purge` (POST/GET), `orderflow` (GET) + `orderflow/meta`, `stats` (GET), `liqmap` (GET) + `liqmap/symbols`, `econcal` (GET). 39 API tests, all green. |
| **Week 3** | **≈ 70 %** | - Add component unit tests for 15 key UI pieces (`RiskBanner`, `TradeChart`, `AdminNav`, etc.). ⟨ВЫПОЛНЕННО⟩ <br>  ▸ Centralized `vitest.setup.ts` (jest-dom/vitest matchers + auto-cleanup). <br>  ▸ Covered: `StatCard`, `TradeChart`, `AdminNav`, `RiskBanner` (×2), `ExitEfficiencyCard`, `MonteCarloCard`, `Term`, `Pagination`, `SearchSelect`, `DonateButton`, `SupportButton`, `DashboardNav`, `LocaleMenu`, `TimezoneMenu` — 15 files / 74 component tests. <br>- Implement Playwright scenarios for login → order‑flow and admin backup restore. ⟨ОТЛОЖЕНО: нужен живой сервер + БД, недоступно в офлайн-раннере; scaffold позже⟩ |
| **Week 4** | **≈ 85 %** | - Fill remaining gaps in `src/lib/*` that still show 0 % coverage. <br>- Add missing edge‑case tests for validation (`badRequest`, `unauthorized`). |
| **Week 5‑5.5** | **≥ 90 %** | - Final sweep of `coverage-report.html` to bring every uncovered line to covered. <br>- Run `npx vitest run --coverage --reporter=summary` and verify all four percentages ≥ 90 %. <br>- Commit and push the final test suite. |
 
**Daily**: Run `npx vitest run --coverage --reporter=summary` → store the percentages in `coverage-progress.md`. Aim for **+5 % per day** on the dominant metric (Statements).
 
---
 
## 5️⃣ Tools Checklist
 
| Tool | Installation |
|--------|--------------|
| `vitest` | `npm i -D vitest` |
| `@vitest/ui` | `npm i -D @vitest/ui` |
| `@testing-library/react` + `user-event` | `npm i -D @testing-library/react @testing-library/user-event` |
| `playwright` | `npm i -D @playwright/test` |
| `tsx` (if not present) | `npm i -D tsx` |
| `vite-tsconfig-paths` | `npm i -D vite-tsconfig-paths` |
| `mock-service-worker` (optional) | `npm i -D workbox-window` |
 
---
 
## 6️⃣ Success Criteria
 
- **≥ 90 %** coverage on **Statements**, **Branches**, **Functions**, **Lines** (reported by Vitest).
- All **API routes** have at least **3** test cases (happy path, validation error, fallback).
- Core **lib** modules have **100 %** coverage on exported functions.
- Documentation (`coverage-plan.md` and `coverage-progress.md`) stays up‑to‑date.
- CI pipeline fails if coverage drops below 90 %.
 
---
 
### 📁 Deliverable
 
This file (`coverage-plan.md`) now lives in the repository root and serves as the master plan for achieving **90 % test coverage**. Execute the steps sequentially, update the progress tracker daily, and keep the plan attached to issue #2 in your project board.