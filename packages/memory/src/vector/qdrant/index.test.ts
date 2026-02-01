import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { QdrantVectorBackend, QdrantVectorBackendConfig } from './index';
import { VectorItem } from '../backend';

const server = setupServer();

const config: QdrantVectorBackendConfig = {
  backend: 'qdrant',
  url: 'http://localhost:6333',
  collection: 'test-collection',
};

describe('QdrantVectorBackend', () => {
  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('should be created', () => {
    const backend = new QdrantVectorBackend(config);
    expect(backend).toBeInstanceOf(QdrantVectorBackend);
  });

  it('should upsert vectors without content', async () => {
    let requestBody: any;
    server.use(
      http.put(`${config.url}/collections/${config.collection}/points`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    const backend = new QdrantVectorBackend(config);
    await backend.init({});

    const items: VectorItem[] = [
      {
        id: '1',
        vector: new Float32Array([0.1, 0.2]),
        metadata: { type: 'test', stale: false, updatedAt: 123 },
      },
    ];

    await backend.upsert({}, 'repo-1', items);

    expect(requestBody.points).toHaveLength(1);
    expect(requestBody.points[0].id).toBe('1');
    expect(requestBody.points[0].vector[0]).toBeCloseTo(0.1);
    expect(requestBody.points[0].vector[1]).toBeCloseTo(0.2);
    expect(requestBody.points[0].payload).toEqual({
      repoId: 'repo-1',
      type: 'test',
      stale: false,
      updatedAt: 123,
    });
    // Most importantly, check that no other properties are in the payload
    expect(Object.keys(requestBody.points[0].payload)).toEqual([
      'repoId',
      'type',
      'stale',
      'updatedAt',
    ]);
  });

  it('should not send content or title in the payload (privacy)', async () => {
    // From spec M16-09
    let requestBody: any;
    server.use(
      http.put(`${config.url}/collections/${config.collection}/points`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    const backend = new QdrantVectorBackend(config);
    await backend.init({});

    const items: VectorItem[] = [
      {
        id: '1',
        vector: new Float32Array([0.1, 0.2]),
        metadata: {
          type: 'test',
          stale: false,
          updatedAt: 123,
          // These should be stripped
          content: 'sensitive content',
          title: 'sensitive title',
        },
      },
    ];

    await backend.upsert({}, 'repo-1', items);

    const payload = requestBody.points[0].payload;
    expect(payload).toBeDefined();
    expect(payload.content).toBeUndefined();
    expect(payload.title).toBeUndefined();
    expect(payload.repoId).toBe('repo-1');
  });

  it('should query with repoId filter', async () => {
    let requestBody: any;
    server.use(
      http.post(
        `${config.url}/collections/${config.collection}/points/search`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({
            result: [
              { id: '1', score: 0.9, payload: {}, vector: [] },
              { id: '2', score: 0.8, payload: {}, vector: [] },
            ],
          });
        },
      ),
    );

    const backend = new QdrantVectorBackend(config);
    await backend.init({});

    const results = await backend.query({}, 'repo-1', new Float32Array([0.1, 0.2]), 2);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('1');
    expect(requestBody.filter.must[0].key).toBe('repoId');
    expect(requestBody.filter.must[0].match.value).toBe('repo-1');
  });

  it('should delete by ids', async () => {
    let requestBody: any;
    server.use(
      http.post(
        `${config.url}/collections/${config.collection}/points/delete`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({ status: 'ok' });
        },
      ),
    );

    const backend = new QdrantVectorBackend(config);
    await backend.init({});

    await backend.deleteByIds({}, 'repo-1', ['1', '2']);

    expect(requestBody.points).toEqual(['1', '2']);
  });

  it('should wipe a repo by filter', async () => {
    let requestBody: any;
    server.use(
      http.post(
        `${config.url}/collections/${config.collection}/points/delete`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({ status: 'ok' });
        },
      ),
    );

    const backend = new QdrantVectorBackend(config);
    await backend.init({});

    await backend.wipeRepo({}, 'repo-1');

    expect(requestBody.filter.must[0].key).toBe('repoId');
    expect(requestBody.filter.must[0].match.value).toBe('repo-1');
  });
});
