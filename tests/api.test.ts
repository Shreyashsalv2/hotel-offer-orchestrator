import request from 'supertest';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { AppDeps, createApp } from '../src/app';
import { setSupplierDown } from '../src/routes/suppliers.routes';
import { selectBestOffers } from '../src/services/dedupe';
import { SUPPLIER_DATA } from '../src/mocks/supplierData';
import { BestOffer } from '../src/types';

const delhi = selectBestOffers([
  ...SUPPLIER_DATA.supplierA.delhi.map((h) => ({ ...h, supplier: 'Supplier A' })),
  ...SUPPLIER_DATA.supplierB.delhi.map((h) => ({ ...h, supplier: 'Supplier B' })),
]);

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const store = new Map<string, BestOffer[]>();
  return {
    runHotelOffersWorkflow: jest.fn(async (city: string) => {
      const hotels = city === 'delhi' ? delhi : [];
      store.set(city, hotels);
      return { city, hotels, failedSuppliers: [] };
    }),
    findHotelsByPrice: jest.fn(async (city, min = -Infinity, max = Infinity) =>
      (store.get(city) ?? []).filter((h) => h.price >= min && h.price <= max),
    ),
    checkSupplier: jest.fn(async () => true),
    checkRedis: jest.fn(async () => true),
    checkTemporal: jest.fn(async () => true),
    checkWorker: jest.fn(async () => true),
    ...overrides,
  };
}

describe('GET /api/hotels', () => {
  it('returns the deduplicated list in the expected shape', async () => {
    const res = await request(createApp(makeDeps(), { httpLogging: false })).get('/api/hotels?city=Delhi');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(delhi);
    for (const h of res.body) expect(Object.keys(h).sort()).toEqual(['commissionPct', 'name', 'price', 'supplier']);
  });

  it('filters by price range through the Redis lookup', async () => {
    const deps = makeDeps();
    const res = await request(createApp(deps, { httpLogging: false })).get(
      '/api/hotels?city=delhi&minPrice=5000&maxPrice=6000',
    );
    expect(res.status).toBe(200);
    expect(deps.findHotelsByPrice).toHaveBeenCalledWith('delhi', 5000, 6000);
    expect(res.body.map((h: BestOffer) => h.name)).toEqual(['Holtin', 'Radison']);
  });

  it('supports only one bound', async () => {
    const res = await request(createApp(makeDeps(), { httpLogging: false })).get('/api/hotels?city=delhi&minPrice=10000');
    expect(res.body.every((h: BestOffer) => h.price >= 10000)).toBe(true);
  });

  it('returns [] for a city with no results', async () => {
    const res = await request(createApp(makeDeps(), { httpLogging: false })).get('/api/hotels?city=paris');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each([
    ['/api/hotels', 'missing city'],
    ['/api/hotels?city=', 'empty city'],
    ['/api/hotels?city=delhi&minPrice=abc', 'non-numeric price'],
    ['/api/hotels?city=delhi&minPrice=-5', 'negative price'],
    ['/api/hotels?city=delhi&minPrice=9000&maxPrice=1000', 'min > max'],
    ['/api/hotels?city=d3lhi', 'invalid city'],
  ])('rejects %s (%s) with 400', async (url) => {
    const res = await request(createApp(makeDeps(), { httpLogging: false })).get(url);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('exposes failed suppliers via a response header', async () => {
    const deps = makeDeps({
      runHotelOffersWorkflow: async (city) => ({ city, hotels: [], failedSuppliers: ['Supplier A'] }),
    });
    const res = await request(createApp(deps, { httpLogging: false })).get('/api/hotels?city=delhi');
    expect(res.headers['x-failed-suppliers']).toBe('Supplier A');
  });

  it('maps AllSuppliersUnavailable to 502', async () => {
    const deps = makeDeps({
      runHotelOffersWorkflow: async () => {
        throw new WorkflowFailedError(
          'failed',
          ApplicationFailure.nonRetryable('All suppliers are unavailable', 'AllSuppliersUnavailable'),
          'NON_RETRYABLE_FAILURE',
        );
      },
    });
    const res = await request(createApp(deps, { httpLogging: false })).get('/api/hotels?city=delhi');
    expect(res.status).toBe(502);
  });
});

describe('mock suppliers', () => {
  afterEach(() => {
    setSupplierDown('supplierA', false);
    setSupplierDown('supplierB', false);
  });

  it('serves static hotels by city', async () => {
    const app = createApp(makeDeps(), { httpLogging: false });
    const a = await request(app).get('/supplierA/hotels?city=delhi');
    const b = await request(app).get('/supplierB/hotels?city=delhi');
    expect(a.body[0]).toEqual({ hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 });
    const overlap = a.body.filter((x: BestOffer) => b.body.some((y: BestOffer) => y.name === x.name));
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('can be toggled down to return 503', async () => {
    const app = createApp(makeDeps(), { httpLogging: false });
    await request(app).post('/supplierA/toggle').send({ down: true }).expect(200);
    await request(app).get('/supplierA/hotels?city=delhi').expect(503);
    await request(app).post('/supplierA/toggle').send({ down: false }).expect(200);
    await request(app).get('/supplierA/hotels?city=delhi').expect(200);
  });

  it('rejects an invalid toggle body', async () => {
    await request(createApp(makeDeps(), { httpLogging: false })).post('/supplierA/toggle').send({ down: 'yes' }).expect(400);
  });
});

describe('GET /health', () => {
  it('reports ok when everything is up', async () => {
    const res = await request(createApp(makeDeps(), { httpLogging: false })).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.suppliers.supplierA.status).toBe('up');
    expect(res.body.suppliers.supplierB.status).toBe('up');
  });

  it('reports degraded when one supplier is down', async () => {
    const deps = makeDeps({
      checkSupplier: async (id) => {
        if (id === 'supplierB') throw new Error('HTTP 503');
        return true;
      },
    });
    const res = await request(createApp(deps, { httpLogging: false })).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.suppliers.supplierB).toMatchObject({ status: 'down', error: 'HTTP 503' });
  });

  it('reports down when both suppliers are down', async () => {
    const deps = makeDeps({ checkSupplier: async () => false });
    const res = await request(createApp(deps, { httpLogging: false })).get('/health');
    expect(res.body.status).toBe('down');
  });
});
