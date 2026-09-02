export type Fulfilment = 'pickup' | 'delivery'
export type PaymentTerms = 'pay_on_delivery'
export type OrderState = 'placed' | 'preparing' | 'ready' | 'completed' | 'cancelled'

export interface Identity {
  userId: string
  projectId: string
  tools: string[]
  roles: string[]
  requestId: string
}

export interface BasketItemInput { menuItemId: string; quantity: number }
export interface QuotedItem { menuItemId: string; name: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }
export interface Quote {
  id: string; userId: string; projectId: string; outletId: string; fulfilment: Fulfilment; currency: 'PHP'
  paymentTerms: PaymentTerms; items: QuotedItem[]; totalMinor: number; quoteHash: string; expiresAt: Date
}
export interface Approval {
  id: string; quoteId: string; userId: string; projectId: string; quoteHash: string; outletId: string
  fulfilment: Fulfilment; paymentTerms: PaymentTerms; totalMinor: number; currency: 'PHP'; operation: 'place_order'; expiresAt: Date; consumedAt: Date | null
}
export interface Order {
  id: string; quoteId: string; userId: string; projectId: string; outletId: string; state: OrderState
  fulfilment: Fulfilment; paymentTerms: PaymentTerms; currency: 'PHP'; items: QuotedItem[]; totalMinor: number; createdAt: Date; updatedAt: Date
}
