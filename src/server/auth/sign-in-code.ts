export const SIGN_IN_CODE_TTL_SECONDS = 60 * 10;

// The emailed code is a second way to finish the same sign-in as the link, for
// when the mail is opened on another device or a scanner has already used the
// link. It is stored the way Better Auth's email-OTP plugin reads it
// (identifier "sign-in-otp-<email>", value "<code>:<failed attempts>"), which
// allows three wrong guesses before the code is dead.
export async function createSignInCode(
  ctx: {
    context: {
      internalAdapter: {
        deleteVerificationByIdentifier(identifier: string): Promise<unknown>;
        createVerificationValue(value: {
          identifier: string;
          value: string;
          expiresAt: Date;
        }): Promise<unknown>;
      };
    };
  },
  email: string,
): Promise<string> {
  const digits = crypto.getRandomValues(new Uint32Array(6));
  const code = Array.from(digits, (n) => n % 10).join("");
  const identifier = `sign-in-otp-${email.toLowerCase()}`;
  await ctx.context.internalAdapter.deleteVerificationByIdentifier(identifier);
  await ctx.context.internalAdapter.createVerificationValue({
    identifier,
    value: `${code}:0`,
    expiresAt: new Date(Date.now() + SIGN_IN_CODE_TTL_SECONDS * 1000),
  });
  return code;
}
