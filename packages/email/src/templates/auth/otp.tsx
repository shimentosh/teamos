import { Section, Text } from "@react-email/components";
import React from "react";
import { resolveEmailLocale } from "../resolve-locale";
import { EmailShell, styles } from "../shell";

void React;

export type OtpEmailProps = {
  otp: string;
  locale?: string | null;
};

const messages = {
  en: {
    preview: "Your Company OS verification code",
    title: "Your verification code",
    subtitle: "Enter this one-time code to finish signing in.",
    code: "is your Company OS verification code.",
    expiry: "This code expires in 15 minutes.",
    ignore: "If you didn't request this, you can ignore this email.",
    footer: "Company OS security email",
  },
  de: {
    preview: "Dein Company OS Bestaetigungscode",
    title: "Dein Bestaetigungscode",
    subtitle: "Gib diesen Einmalcode ein, um die Anmeldung abzuschliessen.",
    code: "ist dein Company OS Bestaetigungscode.",
    expiry: "Dieser Code laeuft in 15 Minuten ab.",
    ignore:
      "Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.",
    footer: "Company OS Sicherheits-E-Mail",
  },
  vi: {
    preview: "Mã xác minh Company OS của bạn",
    title: "Mã xác minh của bạn",
    subtitle: "Nhập mã dùng một lần này để hoàn tất đăng nhập.",
    code: "là mã xác minh Company OS của bạn.",
    expiry: "Mã này sẽ hết hạn sau 15 phút.",
    ignore: "Nếu bạn không yêu cầu điều này, bạn có thể bỏ qua email này.",
    footer: "Email bảo mật Company OS",
  },
  ja: {
    preview: "Company OS の確認コード",
    title: "確認コード",
    subtitle:
      "サインインを完了するには、このワンタイムコードを入力してください。",
    code: "はあなたの Company OS 確認コードです。",
    expiry: "このコードの有効期限は15分です。",
    ignore: "心当たりがない場合は、このメールを無視してかまいません。",
    footer: "Company OS セキュリティメール",
  },
} as const;

const OtpEmail = ({ otp, locale }: OtpEmailProps) => {
  const copy = messages[resolveEmailLocale(locale)];

  return (
    <EmailShell
      preview={copy.preview}
      title={copy.title}
      subtitle={copy.subtitle}
    >
      <Section>
        <Text style={styles.paragraph}>
          {otp} {copy.code}
        </Text>
        <Text style={styles.code}>{otp}</Text>
        <Text style={styles.paragraph}>{copy.expiry}</Text>
        <Text style={styles.muted}>{copy.ignore}</Text>
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

OtpEmail.PreviewProps = {
  otp: "123456",
  locale: "en-US",
} as OtpEmailProps;

export default OtpEmail;
