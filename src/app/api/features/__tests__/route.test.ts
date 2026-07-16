import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  asUser,
  asGuest,
  mockGetAuthUser,
} from '@/lib/__tests__/helpers/routeMocks';
import { GET } from '@/app/api/features/route';
import * as featureConfig from '@/lib/featureConfig';

const base = 'https://example.com/api/features';

describe('GET /api/features', () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    featureConfig.getFeatureConfig.mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    asGuest();
    const res = await GET(new Request(`${base}?key=playbooks`));
    expect(res.status).toBe(401);
  });

  it('returns 400 when feature key is missing or invalid', async () => {
    asUser();
    const res = await GET(new Request(`${base}?key=unknown`));
    expect(res.status).toBe(400);
  });

  it('returns feature config for valid key', async () => {
    asUser();
    featureConfig.getFeatureConfig.mockResolvedValue({ enabled: true });
    const res = await GET(new Request(base + '?key=playbooks'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('playbooks');
    expect(body.value).toEqual({ enabled: true });
  });

  it('returns 500 when getFeatureConfig throws', async () => {
    asUser();
    featureConfig.getFeatureConfig.mockRejectedValueOnce(new Error('DB error'));
    const res = await GET(new Request(`${base}?key=playbooks`));
    expect(res.status).toBe(500);
  });
});