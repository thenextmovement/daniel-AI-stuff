-- Supplemental links must not block existing customer/order deletion workflows.
alter table public.shopify_order_customer_links
 drop constraint shopify_order_customer_links_shopify_order_id_fkey,
 drop constraint shopify_order_customer_links_customer_id_fkey,
 add constraint shopify_order_customer_links_shopify_order_id_fkey
 foreign key(shopify_order_id) references public.shopify_orders(shopify_order_id) on delete cascade,
 add constraint shopify_order_customer_links_customer_id_fkey
 foreign key(customer_id) references public.master_customers(id) on delete cascade;
