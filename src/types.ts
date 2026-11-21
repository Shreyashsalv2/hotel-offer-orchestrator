export type SupplierId = 'supplierA' | 'supplierB';

export const SUPPLIER_LABELS: Record<SupplierId, string> = {
  supplierA: 'Supplier A',
  supplierB: 'Supplier B',
};

/** Raw hotel record as returned by a supplier API. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** Supplier hotel tagged with the supplier it came from. */
export interface TaggedHotel extends SupplierHotel {
  supplier: string;
}

/** Final, deduplicated offer returned to the client. */
export interface BestOffer {
  name: string;
  price: number;
  supplier: string;
  commissionPct: number;
}

export interface HotelOffersWorkflowResult {
  city: string;
  hotels: BestOffer[];
  /** Suppliers that failed after all retries (empty when everything worked). */
  failedSuppliers: string[];
}
