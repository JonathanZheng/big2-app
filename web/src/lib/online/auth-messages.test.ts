import { describe, expect, it } from "vitest";
import { authErrorMessage, checkSignUp } from "./auth-messages";

describe("authErrorMessage", () => {
  it("names a wrong email or password and the way out", () => {
    expect(authErrorMessage({ code: "invalid_credentials" })).toBe(
      "WRONG EMAIL OR PASSWORD. CHECK BOTH, OR EMAIL YOURSELF A SIGN-IN CODE.",
    );
  });

  it("sends someone with an existing account to sign in", () => {
    const taken = "THAT EMAIL ALREADY HAS AN ACCOUNT. SIGN IN INSTEAD, OR EMAIL YOURSELF A CODE.";
    expect(authErrorMessage({ code: "user_already_exists" })).toBe(taken);
    expect(authErrorMessage({ code: "email_exists" })).toBe(taken);
  });

  it("explains a weak password and too many tries", () => {
    expect(authErrorMessage({ code: "weak_password" })).toBe("USE A PASSWORD OF AT LEAST 8 CHARACTERS.");
    expect(authErrorMessage({ code: "over_request_rate_limit" })).toBe("TOO MANY TRIES. WAIT A MINUTE, THEN TRY AGAIN.");
  });

  it("falls back to the server's own message, in capitals", () => {
    expect(authErrorMessage({ message: "Something odd" })).toBe("SOMETHING ODD");
    expect(authErrorMessage({})).toBe("SOMETHING WENT WRONG. TRY AGAIN.");
  });
});

describe("checkSignUp", () => {
  it("accepts a name, an email and a long enough password", () => {
    expect(checkSignUp({ name: " Jo ", email: "jo@example.com", password: "12345678" })).toBeNull();
  });

  it("needs a display name of 1 to 20 letters", () => {
    expect(checkSignUp({ name: "  ", email: "jo@example.com", password: "12345678" })).toBe("CHOOSE A DISPLAY NAME.");
    expect(checkSignUp({ name: "x".repeat(21), email: "jo@example.com", password: "12345678" })).toBe(
      "KEEP YOUR DISPLAY NAME TO 20 LETTERS.",
    );
  });

  it("needs a password of at least 8 characters", () => {
    expect(checkSignUp({ name: "Jo", email: "jo@example.com", password: "1234567" })).toBe(
      "USE A PASSWORD OF AT LEAST 8 CHARACTERS.",
    );
  });
});
