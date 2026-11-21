import { selectBestOffers } from '../src/services/dedupe';
import { TaggedHotel } from '../src/types';

const h = (name: string, price: number, supplier: string, commissionPct = 10): TaggedHotel => ({
  hotelId: `${supplier}-${name}`,
  name,
  price,
  supplier,
  commissionPct,
  city: 'delhi',
});

describe('selectBestOffers', () => {
  it('keeps the cheaper offer when a hotel appears in both suppliers', () => {
    const result = selectBestOffers([
      h('Holtin', 6000, 'Supplier A', 10),
      h('Holtin', 5340, 'Supplier B', 20),
      h('Radison', 5900, 'Supplier A', 13),
      h('Radison', 6150, 'Supplier B', 18),
    ]);
    expect(result).toEqual([
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
    ]);
  });

  it('keeps hotels offered by only one supplier', () => {
    const result = selectBestOffers([h('Ibis', 2900, 'Supplier B'), h('Lemon Tree', 3200, 'Supplier A')]);
    expect(result.map((r) => r.name)).toEqual(['Ibis', 'Lemon Tree']);
  });

  it('matches names case- and whitespace-insensitively', () => {
    const result = selectBestOffers([h('The Leela', 9800, 'Supplier A'), h('  the  LEELA ', 9000, 'Supplier B')]);
    expect(result).toHaveLength(1);
    expect(result[0].supplier).toBe('Supplier B');
  });

  it('breaks price ties with the higher commission', () => {
    const result = selectBestOffers([h('Trident', 8000, 'Supplier A', 10), h('Trident', 8000, 'Supplier B', 15)]);
    expect(result[0]).toMatchObject({ supplier: 'Supplier B', commissionPct: 15 });
  });

  it('returns an empty list for no input and sorts by price', () => {
    expect(selectBestOffers([])).toEqual([]);
    const sorted = selectBestOffers([h('C', 300, 'A'), h('A', 100, 'A'), h('B', 200, 'B')]);
    expect(sorted.map((s) => s.price)).toEqual([100, 200, 300]);
  });
});
