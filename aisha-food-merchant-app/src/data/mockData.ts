export type DeliveryModel = "platform_driver" | "self_delivery" | "both";
export type OrderStatus =
  | "new"
  | "accepted"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export type PaymentStatus = "pending" | "paid" | "failed";

export type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  available: boolean;
  description?: string;
  imageUrl?: string;
  currencyCode?: "XOF" | "DOP" | "GBP";
  unavailableReason?: string;
  raw?: Record<string, unknown>;
};

export type OrderLine = {
  id: string;
  name: string;
  quantity: number;
  price: number;
};

export type MerchantOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  items: OrderLine[];
  total: number;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  deliveryMode: DeliveryModel;
  address: string;
  deliveryNote: string;
  status: OrderStatus;
  createdAt: string;
  driverName?: string;
  driverPhone?: string;
  driverStatus?: string;
  driverEtaMinutes?: number | null;
  driverLastUpdatedAt?: string | null;
  driverLocation?: {
    latitude: number;
    longitude: number;
    lat?: number;
    lng?: number;
    updatedAt?: string | null;
  } | null;
  deliveryFee?: number;
  currencyCode?: "XOF" | "DOP" | "GBP";
  raw?: Record<string, unknown>;
};

export type MerchantProfile = {
  id?: string;
  restaurantName: string;
  ownerName: string;
  email: string;
  phone: string;
  whatsapp: string;
  address: string;
  area?: string;
  city: string;
  cuisineType: string;
  openingHours: string;
  deliveryModel: DeliveryModel;
  approved: boolean;
  currencyCode?: "XOF" | "DOP" | "GBP";
  supportWhatsApp?: string;
  portalStatus?: string;
  isManuallyPaused?: boolean;
};

export type MerchantApplicationDraft = {
  id: string;
  restaurantName: string;
  ownerName: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  cuisineType: string;
  openingHours: string;
  deliveryModel: DeliveryModel;
  password: string;
};

export const SUPPORT_WHATSAPP = "447490493787";

export const approvedMerchantCredentials = {
  email: "owner@oranjeeats.com",
  phone: "+22370000001",
  password: "oranje123",
};

export const mockMerchantProfile: MerchantProfile = {
  restaurantName: "OranjeEats Grill ACI",
  ownerName: "Moussa Traore",
  email: approvedMerchantCredentials.email,
  phone: approvedMerchantCredentials.phone,
  whatsapp: "+22370000002",
  address: "ACI 2000, Rue 234, Bamako",
  city: "Bamako",
  cuisineType: "Grillades & Fast Food",
  openingHours: "10:00 - 23:00",
  deliveryModel: "both",
  approved: true,
  currencyCode: "XOF",
  supportWhatsApp: SUPPORT_WHATSAPP,
  portalStatus: "online",
  isManuallyPaused: false,
};

export const mockOrders: MerchantOrder[] = [
  {
    id: "ord-001",
    orderNumber: "OE-1201",
    customerName: "Aminata Diallo",
    customerPhone: "+22371111111",
    items: [
      { id: "i-1", name: "Poulet braise", quantity: 2, price: 3500 },
      { id: "i-2", name: "Frites maison", quantity: 1, price: 1200 },
    ],
    total: 8200,
    paymentMethod: "Orange Money",
    paymentStatus: "paid",
    deliveryMode: "platform_driver",
    address: "Hamdallaye ACI 2000, Bamako",
    deliveryNote: "Near pharmacie Lafia",
    status: "new",
    createdAt: "2026-05-05T18:20:00.000Z",
    deliveryFee: 1000,
  },
  {
    id: "ord-002",
    orderNumber: "OE-1200",
    customerName: "Yacouba Keita",
    customerPhone: "+22372222222",
    items: [{ id: "i-3", name: "Cheeseburger", quantity: 2, price: 2800 }],
    total: 5600,
    paymentMethod: "Cash",
    paymentStatus: "pending",
    deliveryMode: "self_delivery",
    address: "Kalaban Coura, Bamako",
    deliveryNote: "Blue gate opposite school",
    status: "accepted",
    createdAt: "2026-05-05T17:10:00.000Z",
    driverName: "Restaurant courier",
    deliveryFee: 800,
  },
  {
    id: "ord-003",
    orderNumber: "OE-1199",
    customerName: "Fatoumata Coulibaly",
    customerPhone: "+22373333333",
    items: [
      { id: "i-4", name: "Brochette mixte", quantity: 1, price: 4200 },
      { id: "i-5", name: "Jus de gingembre", quantity: 2, price: 900 },
    ],
    total: 6000,
    paymentMethod: "Wave",
    paymentStatus: "paid",
    deliveryMode: "platform_driver",
    address: "Badalabougou Est, Bamako",
    deliveryNote: "Call on arrival",
    status: "preparing",
    createdAt: "2026-05-05T16:05:00.000Z",
    deliveryFee: 1200,
  },
  {
    id: "ord-004",
    orderNumber: "OE-1198",
    customerName: "Mariam Sidibe",
    customerPhone: "+22374444444",
    items: [{ id: "i-6", name: "Pizza pepperoni", quantity: 1, price: 6500 }],
    total: 6500,
    paymentMethod: "Card",
    paymentStatus: "paid",
    deliveryMode: "platform_driver",
    address: "ACI Golf, Bamako",
    deliveryNote: "Block C, floor 2",
    status: "ready",
    createdAt: "2026-05-05T15:00:00.000Z",
    driverName: "Boubacar Traore",
    deliveryFee: 1500,
  },
  {
    id: "ord-005",
    orderNumber: "OE-1197",
    customerName: "Ibrahim Cisse",
    customerPhone: "+22375555555",
    items: [{ id: "i-7", name: "Wrap poulet", quantity: 3, price: 2400 }],
    total: 7200,
    paymentMethod: "Cash",
    paymentStatus: "pending",
    deliveryMode: "platform_driver",
    address: "Sotuba, Bamako",
    deliveryNote: "Near orange kiosk",
    status: "out_for_delivery",
    createdAt: "2026-05-05T14:20:00.000Z",
    driverName: "Boubacar Traore",
    deliveryFee: 1500,
  },
  {
    id: "ord-006",
    orderNumber: "OE-1196",
    customerName: "Seydou Camara",
    customerPhone: "+22376666666",
    items: [{ id: "i-8", name: "Thieb express", quantity: 2, price: 3100 }],
    total: 6200,
    paymentMethod: "Orange Money",
    paymentStatus: "paid",
    deliveryMode: "both",
    address: "Magnambougou, Bamako",
    deliveryNote: "Apartment 7",
    status: "delivered",
    createdAt: "2026-05-04T19:00:00.000Z",
    deliveryFee: 1000,
  },
  {
    id: "ord-007",
    orderNumber: "OE-1195",
    customerName: "Adama Maiga",
    customerPhone: "+22377777777",
    items: [{ id: "i-9", name: "Tacos boeuf", quantity: 1, price: 3900 }],
    total: 3900,
    paymentMethod: "Cash",
    paymentStatus: "failed",
    deliveryMode: "platform_driver",
    address: "Niarela, Bamako",
    deliveryNote: "Customer cancelled after delay",
    status: "cancelled",
    createdAt: "2026-05-04T13:10:00.000Z",
    deliveryFee: 800,
  },
];

export const mockMenuItems: MenuItem[] = [
  {
    id: "menu-1",
    name: "Poulet braise",
    category: "Grillades",
    price: 3500,
    available: true,
    description: "Half grilled chicken with onion sauce and spicy mayo.",
    currencyCode: "XOF",
  },
  {
    id: "menu-2",
    name: "Cheeseburger",
    category: "Fast Food",
    price: 2800,
    available: true,
    description: "Beef burger, cheese, lettuce and house sauce.",
    currencyCode: "XOF",
  },
  {
    id: "menu-3",
    name: "Pizza pepperoni",
    category: "Pizzas",
    price: 6500,
    available: true,
    description: "Stone-baked pepperoni pizza with extra mozzarella.",
    currencyCode: "XOF",
  },
  {
    id: "menu-4",
    name: "Jus de gingembre",
    category: "Boissons",
    price: 900,
    available: false,
    description: "Fresh ginger juice served chilled.",
    currencyCode: "XOF",
    unavailableReason: "out_of_stock",
  },
  {
    id: "menu-5",
    name: "Frites maison",
    category: "Accompagnements",
    price: 1200,
    available: true,
    description: "Crisp house fries with light seasoning.",
    currencyCode: "XOF",
  },
];
