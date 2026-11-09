/** Sign-in and sign-up messages in the app's own words. */

const MESSAGES: Record<string, string> = {
  invalid_credentials: "WRONG EMAIL OR PASSWORD. CHECK BOTH, OR EMAIL YOURSELF A SIGN-IN CODE.",
  user_already_exists: "THAT EMAIL ALREADY HAS AN ACCOUNT. SIGN IN INSTEAD, OR EMAIL YOURSELF A CODE.",
  email_exists: "THAT EMAIL ALREADY HAS AN ACCOUNT. SIGN IN INSTEAD, OR EMAIL YOURSELF A CODE.",
  weak_password: "USE A PASSWORD OF AT LEAST 8 CHARACTERS.",
  over_request_rate_limit: "TOO MANY TRIES. WAIT A MINUTE, THEN TRY AGAIN.",
  over_email_send_rate_limit: "TOO MANY EMAILS SENT. WAIT A FEW MINUTES, THEN TRY AGAIN.",
  email_not_confirmed: "THIS ACCOUNT IS WAITING FOR ITS EMAIL TO BE CONFIRMED. EMAIL YOURSELF A SIGN-IN CODE INSTEAD.",
};

export function authErrorMessage(error: { code?: string; message?: string }): string {
  return (error.code && MESSAGES[error.code]) || error.message?.toUpperCase() || "SOMETHING WENT WRONG. TRY AGAIN.";
}

/** The first problem with a new account's details, or null when they are fine. */
export function checkSignUp({ name, password }: { name: string; email: string; password: string }): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "CHOOSE A DISPLAY NAME.";
  if (trimmed.length > 20) return "KEEP YOUR DISPLAY NAME TO 20 LETTERS.";
  if (password.length < 8) return MESSAGES.weak_password;
  return null;
}
