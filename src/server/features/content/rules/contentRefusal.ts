// An expected, user-facing refusal (policy gate, failed validation). The
// server function turns it into a typed result because the app's error
// middleware only forwards bare error codes to the browser.
export class ContentRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentRefusal";
  }
}
