import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");

  return (
    <div className="auth-scene">
      <div className="auth-card">
        <Image
          src="/brand/plaque.png"
          alt="Madame Wedding Design"
          width={220}
          height={163}
          style={{ margin: "0 auto 26px", height: "auto" }}
          priority
        />
        <p
          className="serif"
          style={{ fontStyle: "italic", fontSize: 22, marginBottom: 6 }}
        >
          {t("motto")}
        </p>
        <p
          className="eyebrow"
          style={{ color: "var(--champagne)", marginBottom: 30 }}
        >
          {t("subtitle")}
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
