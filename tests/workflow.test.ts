import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { hotelOffersWorkflow } from '../src/temporal/workflows';
import { BestOffer, SupplierId, TaggedHotel } from '../src/types';
import { SUPPLIER_DATA } from '../src/mocks/supplierData';

const label = (id: SupplierId) => (id === 'supplierA' ? 'Supplier A' : 'Supplier B');

describe('hotelOffersWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  async function run(down: SupplierId[], city = 'delhi') {
    const saved: { city: string; hotels: BestOffer[] }[] = [];
    const calls: Record<string, number> = {};
    const taskQueue = `test-${Math.random().toString(36).slice(2)}`;

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../src/temporal/workflows'),
      activities: {
        async fetchSupplierHotels(id: SupplierId, c: string): Promise<TaggedHotel[]> {
          calls[id] = (calls[id] ?? 0) + 1;
          if (down.includes(id)) throw ApplicationFailure.retryable(`${id} down`, 'SupplierUnavailable');
          return (SUPPLIER_DATA[id][c] ?? []).map((x) => ({ ...x, supplier: label(id) }));
        },
        async saveHotelsToRedis(c: string, hotels: BestOffer[]) {
          saved.push({ city: c, hotels });
        },
      },
    });

    const result = await worker.runUntil(
      env.client.workflow.execute(hotelOffersWorkflow, {
        taskQueue,
        workflowId: `wf-${taskQueue}`,
        args: [city],
      }),
    );
    return { result, saved, calls };
  }

  it('dedupes across both suppliers and saves to Redis', async () => {
    const { result, saved } = await run([]);
    expect(result.failedSuppliers).toEqual([]);
    const holtin = result.hotels.find((h) => h.name === 'Holtin');
    expect(holtin).toEqual({ name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 });
    const radison = result.hotels.find((h) => h.name === 'Radison');
    expect(radison).toMatchObject({ price: 5900, supplier: 'Supplier A' });
    // 6 + 6 hotels with 4 overlapping names -> 8 unique
    expect(result.hotels).toHaveLength(8);
    expect(saved).toEqual([{ city: 'delhi', hotels: result.hotels }]);
  });

  it('returns results from the healthy supplier when one is down (after retries)', async () => {
    const { result, calls } = await run(['supplierA']);
    expect(result.failedSuppliers).toEqual(['Supplier A']);
    expect(result.hotels.every((h) => h.supplier === 'Supplier B')).toBe(true);
    expect(calls.supplierA).toBe(3); // retried up to maximumAttempts
  });

  it('fails with AllSuppliersUnavailable when both are down', async () => {
    const err = await run(['supplierA', 'supplierB']).catch((e) => e);
    expect(err).toBeInstanceOf(WorkflowFailedError);
    expect((err as WorkflowFailedError).cause).toMatchObject({ type: 'AllSuppliersUnavailable' });
  });

  it('returns an empty list for a city with no hotels', async () => {
    const { result, saved } = await run([], 'paris');
    expect(result.hotels).toEqual([]);
    expect(saved[0]).toEqual({ city: 'paris', hotels: [] });
  });
});
