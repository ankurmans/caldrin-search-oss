# DataForSEO API Key Setup

Caldrin Search uses [DataForSEO](https://dataforseo.com/) to fetch SEO data. It is a pay-as-you-go third-party service unaffiliated with Caldrin Search. You need your own account and key.

## Get your API key

1. Go to the DataForSEO API Access page (create an account if you need one).
2. Copy the API credential labeled "Base64". It is the base64 encoding of your DataForSEO email and API password in the format `email:password`.

## Where to set it

Open **Settings** in the app and save the key for your workspace. The key is encrypted at rest and is never shown again. This edition runs research and AI calls only on keys saved for the current workspace; it never reads a deployment-wide provider key.
