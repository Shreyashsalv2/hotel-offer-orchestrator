import { SupplierHotel, SupplierId } from '../types';

/**
 * Static supplier inventories. Several hotel names exist in both suppliers
 * (with different prices) so deduplication and best-price selection can be
 * observed. Cities not listed here return an empty array.
 */
export const SUPPLIER_DATA: Record<SupplierId, Record<string, SupplierHotel[]>> = {
  supplierA: {
    delhi: [
      { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
      { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
      { hotelId: 'a3', name: 'Taj Palace', price: 12500, city: 'delhi', commissionPct: 8 },
      { hotelId: 'a4', name: 'The Leela', price: 9800, city: 'delhi', commissionPct: 12 },
      { hotelId: 'a5', name: 'Hyatt Regency', price: 7400, city: 'delhi', commissionPct: 11 },
      { hotelId: 'a6', name: 'Lemon Tree', price: 3200, city: 'delhi', commissionPct: 15 },
    ],
    mumbai: [
      { hotelId: 'a7', name: 'Trident', price: 8800, city: 'mumbai', commissionPct: 10 },
      { hotelId: 'a8', name: 'Sea Princess', price: 6100, city: 'mumbai', commissionPct: 14 },
      { hotelId: 'a9', name: 'Holtin', price: 7000, city: 'mumbai', commissionPct: 9 },
    ],
  },
  supplierB: {
    delhi: [
      { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
      { hotelId: 'b2', name: 'Radison', price: 6150, city: 'delhi', commissionPct: 18 },
      { hotelId: 'b3', name: 'Taj Palace', price: 11900, city: 'delhi', commissionPct: 9 },
      { hotelId: 'b4', name: 'The Leela', price: 10200, city: 'delhi', commissionPct: 10 },
      { hotelId: 'b5', name: 'ITC Maurya', price: 13400, city: 'delhi', commissionPct: 7 },
      { hotelId: 'b6', name: 'Ibis', price: 2900, city: 'delhi', commissionPct: 16 },
    ],
    mumbai: [
      { hotelId: 'b7', name: 'Trident', price: 8450, city: 'mumbai', commissionPct: 12 },
      { hotelId: 'b8', name: 'Holtin', price: 7300, city: 'mumbai', commissionPct: 15 },
      { hotelId: 'b9', name: 'Fariyas', price: 5600, city: 'mumbai', commissionPct: 13 },
    ],
  },
};
