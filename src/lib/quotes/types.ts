export type QuoteSection = "products" | "addons" | "shipping";

export type CustomFieldMap = Record<string, string | number | boolean | null | undefined>;

export type QuoteItemInput = {
  id?: string;
  section: QuoteSection;
  name: string;
  description?: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  optional: boolean;
  selected_default: boolean;
  quantity_editable: boolean;
  sort_order: number;
  metadata?: Record<string, unknown>;
};

export type QuoteItemRecord = QuoteItemInput & {
  id: string;
  quote_id?: string;
};

export type QuoteImageRecord = {
  id: string;
  quote_id?: string;
  source_url?: string | null;
  storage_url: string;
  label?: string | null;
  sort_order: number;
};

export type QuoteRecord = {
  id: string;
  request_id: string;
  customer_id?: string | null;
  trello_card_id?: string | null;
  status: string;
  customer_email?: string | null;
  customer_name?: string | null;
  company?: string | null;
  country?: string | null;
  currency: string;
  share_token: string;
  subtotal_net?: number | null;
  tax_amount?: number | null;
  total_gross?: number | null;
  created_at?: string | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  accepted_at?: string | null;
  declined_at?: string | null;
  expired_at?: string | null;
};

export type PublicQuote = QuoteRecord & {
  items: QuoteItemRecord[];
  images: QuoteImageRecord[];
};

export type QuoteSelectionInput = {
  item_id: string;
  selected: boolean;
  quantity: number;
};

export type AddressInput = {
  company?: string;
  first_name: string;
  last_name: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
};

export type AcceptQuotePayload = {
  selected_items: QuoteSelectionInput[];
  delivery_address: AddressInput;
  billing_address: AddressInput;
  signed_name: string;
  signature_created_client_at?: string;
  signature_style?: string;
  terms_accepted: boolean;
};

export type QuoteTotals = {
  subtotal_net: number;
  tax_amount: number;
  total_gross: number;
};

export type TrelloAttachment = {
  id: string;
  name?: string;
  fileName?: string;
  url?: string;
  mimeType?: string;
  previews?: Array<{
    url?: string;
    width?: number;
    height?: number;
    scaled?: boolean;
  }>;
};

export type TrelloAction = {
  id: string;
  type?: string;
  date?: string;
  data?: {
    text?: string;
    card?: {
      id?: string;
      name?: string;
      idList?: string;
    };
    list?: {
      id?: string;
      name?: string;
    };
    listBefore?: {
      id?: string;
      name?: string;
    };
    listAfter?: {
      id?: string;
      name?: string;
    };
    old?: Record<string, unknown>;
  };
};

export type TrelloCustomFieldType = "text" | "number" | "checkbox" | "date" | "list" | string;

export type TrelloCustomFieldOption = {
  id: string;
  text: string;
};

export type TrelloEditableCustomField = {
  id: string;
  name: string;
  type: TrelloCustomFieldType;
  value: string | boolean | null;
  displayValue: string | null;
  options: TrelloCustomFieldOption[];
};

export type TrelloCardData = {
  id: string;
  idBoard?: string;
  idList?: string;
  name?: string;
  desc?: string;
  createdAt?: string | null;
  labels?: Array<{
    id: string;
    name?: string | null;
    color?: string | null;
  }>;
  customFields: CustomFieldMap;
  attachments: TrelloAttachment[];
  actions?: TrelloAction[];
  editableFields?: TrelloEditableCustomField[];
};

export type CustomerRequestData = {
  request_id: string;
  customer_id?: string | null;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  phone?: string | null;
  country?: string | null;
  requested_size?: string | null;
  requested_color?: string | null;
  usage?: string | null;
  delivery_preference?: string | null;
};
