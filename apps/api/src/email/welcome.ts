import { renderActivityEmail } from "@kaneo/email";
import { buildWelcomeEmail } from "../notification-preferences/email-content";
import { enqueueEmail } from "./outbox";

/** Queued once per new account; a no-op when email isn't set up. */
export async function sendWelcomeEmail(user: {
  id: string;
  email: string;
  name: string | null;
}) {
  if (!user.email) return;
  const email = buildWelcomeEmail();
  const { html, text } = await renderActivityEmail(email.props);
  await enqueueEmail({
    to: user.email,
    subject: email.subject,
    html,
    text,
    category: email.category,
    userId: user.id,
  });
}
