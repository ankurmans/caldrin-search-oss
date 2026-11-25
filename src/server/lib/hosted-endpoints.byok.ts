const unavailable = () => new Response(null, { status: 404 });

// Hosted-only endpoints answer 404 in this installation.
export const isAdminRequest = (_request: Request) => false;
export const handleAdminRequest = (_request: Request) => unavailable();
export const handleOperatorRequest = (_request: Request) => unavailable();
export const handleHostedAppChallenge = unavailable;

export async function handlePolarWebhook(_input: {
  rawBody: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}): Promise<{ status: number }> {
  return { status: 404 };
}
