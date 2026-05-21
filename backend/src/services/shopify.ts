const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN ?? '';
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN ?? '';
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN ?? '';

const shopifyEnabled = Boolean(DOMAIN && STOREFRONT_TOKEN && ADMIN_TOKEN);

async function storefrontQuery(query: string, variables?: object) {
  const res = await fetch(`https://${DOMAIN}/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify Storefront error: ${res.status}`);
  return res.json();
}

async function adminQuery(query: string, variables?: object) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify Admin error: ${res.status}`);
  return res.json();
}

export async function getProducts() {
  if (!shopifyEnabled) return [];
  const data = await storefrontQuery(`
    query {
      products(first: 50) {
        edges {
          node {
            id
            title
            description
            tags
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  priceV2 { amount currencyCode }
                }
              }
            }
            images(first: 1) {
              edges { node { url altText } }
            }
          }
        }
      }
    }
  `);
  return data.data?.products?.edges?.map((e: any) => e.node) ?? [];
}

export async function createOrder(params: {
  email: string;
  items: Array<{ variantId: string; quantity: number }>;
  shippingAddress: {
    firstName: string;
    lastName: string;
    address1: string;
    city: string;
    province: string;
    zip: string;
    country: string;
  };
  note?: string;
}) {
  if (!shopifyEnabled) throw new Error('Shop not yet available');
  const lineItems = params.items.map(item => ({
    variantId: item.variantId,
    quantity: item.quantity,
  }));

  // Use Admin API to create a draft order for drop-ship
  const data = await adminQuery(`
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id legacyResourceId name }
        userErrors { field message }
      }
    }
  `, {
    input: {
      email: params.email,
      lineItems,
      shippingAddress: params.shippingAddress,
      note: params.note ?? 'Axis & Bloom drop-ship order',
    },
  });

  const draftOrder = data.data?.draftOrderCreate?.draftOrder;
  if (!draftOrder) {
    const errors = data.data?.draftOrderCreate?.userErrors;
    throw new Error(`Shopify order creation failed: ${JSON.stringify(errors)}`);
  }

  return {
    shopifyOrderId: draftOrder.legacyResourceId,
    orderName: draftOrder.name,
  };
}
