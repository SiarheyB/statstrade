// src/__mocks__/api.ts
// Shared mock for auth helpers used in route tests

export const getAuthUser = vi.fn().mockResolvedValue({ id: 'test-user' });
export const unauthorized = () => ({
  status: 401,
  json: () => Promise.resolve({ error: 'Unauthorized' }),
});
export const badRequest = (message: string) => ({
  status: 400,
  json: () => Promise.resolve({ error: message }),
});
export const serverError = (message: string) => ({
  status: 500,
  json: () => Promise.resolve({ error: message }),
});

// Optional: mock the module shape if some code imports named exports
export default {
  getAuthUser,
  unauthorized,
  badRequest,
  serverError,
};