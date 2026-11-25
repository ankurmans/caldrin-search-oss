export type StoreProduct = {
  handle: string;
  title: string;
  // Plain text from the merchant's own description, HTML stripped.
  description: string;
  available: boolean;
  // Facts the store keeps outside the description: text metafields (often a
  // specs list) and variant options, as plain text. Empty when it has none.
  details: string;
  // The first few product photos, as the store serves them.
  images: { url: string; alt: string }[];
};

export type StoreCollectionRef = { handle: string; title: string };

export type StoreArticle = {
  handle: string;
  title: string;
  blogHandle: string;
};

export type StoreSnapshot = {
  // Lists the read stopped before the end of (page cap or a stuck cursor), so
  // a "missing" product or collection may only be a part that was not read.
  truncated?: ("products" | "collections" | "articles")[];
  shopName: string;
  products: StoreProduct[];
  collections: StoreCollectionRef[];
  articles: StoreArticle[];
};
