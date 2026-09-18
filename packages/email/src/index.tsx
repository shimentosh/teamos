export type { Detail, EmailAction } from "./layout/components";
export type { EmailBrand } from "./layout/mother";
export type { Tone } from "./layout/theme";
export {
  type EmailResult,
  renderActivityEmail,
  renderSystemEmail,
  type SystemEmail,
  sendActivityEmail,
  sendMagicLinkEmail,
  sendNotificationEmail,
  sendOtpEmail,
  sendPasswordResetEmail,
  sendTrialReminderEmail,
  sendWorkspaceInvitationEmail,
} from "./send-email";
export { isSmtpConfigured } from "./smtp-config";
export type { ActivityEmailProps } from "./templates/notifications/activity";
export {
  deliverEmail,
  emailEnv,
  emailFrom,
  emailProvider,
  isEmailConfigured,
  type OutgoingEmail,
  setEmailSettings,
} from "./transport";
