import type { Metadata } from "next";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Mail,
  MessageCircle,
  Phone,
  Play,
  ShieldCheck,
} from "lucide-react";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type PreviewPageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type PreviewData = {
  customerName: string;
  videoUrl: string;
  thumbnailUrl: string;
  offerUrl: string;
  changeRequestUrl: string;
};

export const metadata: Metadata = {
  title: "Ihre NEONTRIP Vorschau",
  description: "Ihre animierte Vorschau zum NEONTRIP Angebot.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

function getParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value || "";
}

function safeHttpsUrl(value: string) {
  if (!value) return "";

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function buildPreviewData(
  searchParams: Record<string, string | string[] | undefined>,
): PreviewData {
  return {
    customerName: getParam(searchParams, "name") || "Ihre Vorschau",
    videoUrl: safeHttpsUrl(getParam(searchParams, "video")),
    thumbnailUrl: safeHttpsUrl(getParam(searchParams, "thumb")),
    offerUrl: safeHttpsUrl(getParam(searchParams, "offer")),
    changeRequestUrl:
      "mailto:support@neontrip.de?subject=Änderungswunsch%20zur%20NEONTRIP%20Vorschau",
  };
}

function CriticalStyles() {
  const css = `
    @font-face { font-family: "Inter"; font-style: normal; font-weight: 100 900; font-display: swap; src: url("/assets/fonts/inter-latin.woff2") format("woff2"); }
    .${styles.page}, .${styles.page} * { box-sizing: border-box; }
    .${styles.page} { min-height: 100vh; margin: 0; background: #f5f5f5; color: #0a0a0a; font-family: "Inter", Arial, Helvetica, sans-serif; }
    .${styles.header} { position: fixed; z-index: 50; top: 0; left: 0; right: 0; height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 0 32px; background: #0a0a0a; box-shadow: 0 12px 40px rgba(0,0,0,.18); }
    .${styles.logoLink} { display: flex; align-items: center; flex: 0 0 auto; }
    .${styles.logo} { display: block; width: auto; height: 40px; max-width: 180px; object-fit: contain; }
    .${styles.nav} { display: flex; align-items: center; gap: 4px; padding: 5px; border-radius: 999px; background: rgba(255,255,255,.07); }
    .${styles.nav} a { display: inline-flex; align-items: center; min-height: 36px; padding: 0 15px; border-radius: 999px; color: rgba(255,255,255,.68); font-size: 13px; font-weight: 700; text-decoration: none; }
    .${styles.headerActions} { display: flex; align-items: center; gap: 12px; }
    .${styles.phoneLink} { display: inline-flex; align-items: center; gap: 8px; color: rgba(255,255,255,.62); font-size: 13px; font-weight: 700; text-decoration: none; }
    .${styles.headerCta}, .${styles.primaryCta}, .${styles.secondaryCta}, .${styles.lightCta}, .${styles.darkCta} { display: inline-flex; align-items: center; justify-content: center; gap: 9px; min-height: 46px; border-radius: 999px; font-size: 14px; font-weight: 800; line-height: 1; text-decoration: none; }
    .${styles.headerCta}, .${styles.primaryCta}, .${styles.lightCta} { color: #fff; background: #fa31a2; box-shadow: 0 10px 30px rgba(250,49,162,.26); }
    .${styles.headerCta} { min-height: 42px; padding: 0 20px; }
    .${styles.hero} { width: min(1440px, calc(100% - 40px)); margin: 0 auto; padding: 112px 0 72px; display: grid; grid-template-columns: minmax(0,.78fr) minmax(560px,1.22fr); gap: 28px; align-items: stretch; }
    .${styles.heroCopy} { min-height: 620px; display: flex; flex-direction: column; justify-content: flex-end; padding: 46px; border-radius: 28px; color: #fff; background: radial-gradient(circle at 18% 16%, rgba(250,49,162,.16), transparent 28%), linear-gradient(135deg,#060606 0%,#121012 48%,#040313 100%); box-shadow: 0 28px 90px rgba(0,0,0,.18); }
    .${styles.eyebrow} { margin: 0 0 22px; color: rgba(255,255,255,.5); font-size: 12px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
    .${styles.heroCopy} h1 { max-width: 720px; margin: 0; font-size: clamp(48px,5vw,84px); font-weight: 750; line-height: .94; letter-spacing: -.06em; }
    .${styles.lead} { max-width: 640px; margin: 28px 0 0; color: rgba(255,255,255,.68); font-size: 19px; font-weight: 600; line-height: 1.55; }
    .${styles.heroActions} { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 34px; }
    .${styles.primaryCta}, .${styles.secondaryCta}, .${styles.lightCta}, .${styles.darkCta} { padding: 0 24px; }
    .${styles.secondaryCta}, .${styles.darkCta} { color: #fff; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.08); }
    .${styles.trustRow} { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 32px; }
    .${styles.trustRow} span { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 13px; border: 1px solid rgba(255,255,255,.11); border-radius: 999px; color: rgba(255,255,255,.64); font-size: 12px; font-weight: 800; }
    .${styles.videoShell} { min-height: 620px; display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(0,0,0,.08); border-radius: 28px; background: #0a0a0a; box-shadow: 0 28px 90px rgba(0,0,0,.18); }
    .${styles.videoTopbar} { height: 52px; display: flex; align-items: center; gap: 8px; padding: 0 18px; border-bottom: 1px solid rgba(255,255,255,.08); }
    .${styles.videoTopbar} span { width: 10px; height: 10px; border-radius: 999px; background: rgba(255,255,255,.22); }
    .${styles.videoFrame} { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: radial-gradient(circle at 50% 20%, rgba(255,255,255,.12), transparent 30%), #050505; }
    .${styles.video} { display: block; width: 100%; height: auto; max-height: 520px; aspect-ratio: 16 / 9; border-radius: 22px; object-fit: cover; background: #000; box-shadow: 0 24px 90px rgba(0,0,0,.36); }
    .${styles.videoCaption} { height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 22px; border-top: 1px solid rgba(255,255,255,.08); color: rgba(255,255,255,.54); font-size: 13px; font-weight: 800; }
    .${styles.videoFallback} { width: 100%; aspect-ratio: 16 / 9; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; border: 1px solid rgba(255,255,255,.1); border-radius: 22px; color: rgba(255,255,255,.62); background: linear-gradient(135deg,#070707,#151515); text-align: center; }
    .${styles.playButton} { width: 78px; height: 78px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #fff; background: rgba(255,255,255,.1); }
    .${styles.details} { width: min(1320px, calc(100% - 32px)); margin: 0 auto; padding: 18px 0 72px; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 16px; }
    .${styles.detailCard} { padding: 30px; border: 1px solid rgba(0,0,0,.08); border-radius: 24px; background: #fff; box-shadow: 0 18px 60px rgba(0,0,0,.06); }
    .${styles.detailCard} h2 { margin: 34px 0 0; font-size: 24px; font-weight: 900; line-height: 1.05; letter-spacing: -.035em; }
    .${styles.detailCard} p { margin: 14px 0 0; color: rgba(0,0,0,.56); font-size: 15px; font-weight: 600; line-height: 1.6; }
    .${styles.contact} { width: min(1320px, calc(100% - 32px)); margin: 0 auto 74px; display: flex; align-items: flex-end; justify-content: space-between; gap: 30px; padding: 42px; border-radius: 28px; color: #fff; background: radial-gradient(circle at 86% 20%, rgba(250,49,162,.2), transparent 30%), #0a0a0a; }
    .${styles.contact} h2 { max-width: 780px; margin: 0; font-size: clamp(34px,4vw,62px); font-weight: 900; line-height: .98; letter-spacing: -.055em; }
    .${styles.contactActions} { display: flex; flex-direction: column; gap: 12px; min-width: 240px; }
    .${styles.footer} { background: #f5f5f5; }
    .${styles.footerTop} { width: min(1400px, calc(100% - 40px)); margin: 0 auto; display: grid; grid-template-columns: 1.2fr repeat(3,minmax(0,1fr)); gap: 44px; padding: 64px 0 54px; }
    .${styles.footerBrandIntro} { max-width: 280px; }
    .${styles.footerLogoDark} { display: block; width: 132px; height: auto; margin-bottom: 14px; }
    .${styles.footerTagline} { margin: 0 0 5px; color: #0a0a0a; font-size: 15px; font-weight: 800; letter-spacing: -.03em; }
    .${styles.footerProducts} { margin: 0 0 22px; color: rgba(10,10,10,.58); font-size: 13px; font-weight: 600; line-height: 1.55; }
    .${styles.socialRow} { display: flex; align-items: center; gap: 8px; }
    .${styles.socialRow} a { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; color: #0a0a0a; background: rgba(10,10,10,.06); font-size: 11px; font-weight: 900; text-decoration: none; }
    .${styles.footerTitle} { margin: 0 0 18px; color: rgba(10,10,10,.52); font-size: 12px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
    .${styles.footerNav}, .${styles.footerContact} { display: flex; flex-direction: column; gap: 11px; }
    .${styles.footerNav} a, .${styles.footerContact} p { margin: 0; color: rgba(10,10,10,.58); font-size: 14px; font-weight: 650; line-height: 1.4; text-decoration: none; }
    .${styles.accentLink} { color: #fa31a2; font-size: 14px; font-weight: 850; text-decoration: none; }
    .${styles.footerBrand} { padding: 34px 24px 24px; background: #040313; }
    .${styles.footerStats} { width: min(1400px,100%); margin: 0 auto 28px; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 26px; }
    .${styles.footerStats} div { text-align: center; }
    .${styles.footerStats} strong { display: block; color: #fff; font-size: clamp(32px,4vw,58px); font-weight: 780; line-height: .95; letter-spacing: -.055em; }
    .${styles.footerStats} span { display: block; margin-top: 9px; color: rgba(255,255,255,.34); font-size: 12px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
    .${styles.footerBigLogo} { display: block; width: min(1100px,94vw); height: auto; margin: 0 auto; opacity: .9; }
    .${styles.footerMeta} { width: min(1400px,100%); margin: 20px auto 0; padding-top: 18px; display: flex; align-items: center; justify-content: space-between; gap: 18px 28px; border-top: 1px solid rgba(255,255,255,.1); color: rgba(255,255,255,.36); font-size: 12px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
    .${styles.footerLegalRow} { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 18px; }
    .${styles.footerLegalRow} a, .${styles.footerInquiryCta} { color: rgba(255,255,255,.38); text-decoration: none; }
    .${styles.footerInquiryCta} { display: inline-flex; align-items: center; gap: 7px; letter-spacing: 0; text-transform: none; }
    @media (max-width: 1040px) { .${styles.nav}, .${styles.phoneLink} { display: none; } .${styles.hero} { grid-template-columns: 1fr; } .${styles.heroCopy}, .${styles.videoShell} { min-height: auto; } .${styles.details} { grid-template-columns: 1fr; } .${styles.contact} { align-items: flex-start; flex-direction: column; } .${styles.contactActions} { width: 100%; } .${styles.footerTop}, .${styles.footerStats} { grid-template-columns: repeat(2,minmax(0,1fr)); } }
    @media (max-width: 640px) { .${styles.header} { height: 58px; padding: 0 10px 0 14px; } .${styles.logo} { height: 28px; max-width: 126px; } .${styles.headerCta} { min-height: 38px; padding: 0 13px; font-size: 12px; } .${styles.hero} { width: calc(100% - 20px); padding: 76px 0 46px; gap: 14px; } .${styles.heroCopy} { padding: 28px 22px; border-radius: 24px; } .${styles.heroCopy} h1 { font-size: 44px; } .${styles.lead} { font-size: 16px; line-height: 1.5; } .${styles.heroActions} { flex-direction: column; } .${styles.primaryCta}, .${styles.secondaryCta}, .${styles.lightCta}, .${styles.darkCta} { width: 100%; } .${styles.videoShell} { border-radius: 24px; } .${styles.videoFrame} { padding: 10px; } .${styles.videoCaption} { height: auto; align-items: flex-start; flex-direction: column; padding: 14px 16px; } .${styles.details} { width: calc(100% - 20px); padding-bottom: 46px; } .${styles.contact} { width: calc(100% - 20px); margin-bottom: 46px; padding: 26px 22px; border-radius: 24px; } .${styles.footerTop} { width: calc(100% - 20px); grid-template-columns: 1fr 1fr; gap: 32px 22px; padding: 46px 0 38px; } .${styles.footerBrandIntro} { grid-column: 1 / -1; } .${styles.footerTitle} { margin-bottom: 13px; font-size: 11px; } .${styles.footerNav} a, .${styles.footerContact} p, .${styles.accentLink} { font-size: 13px; } .${styles.footerBrand} { padding: 30px 14px 20px; } .${styles.footerStats} { gap: 24px 14px; margin-bottom: 24px; } .${styles.footerStats} strong { font-size: 36px; } .${styles.footerStats} span { font-size: 10px; } .${styles.footerMeta} { align-items: flex-start; flex-direction: column; font-size: 10px; } .${styles.footerLegalRow} { justify-content: flex-start; gap: 7px 12px; } }
  `;

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

function Header({ offerUrl }: { offerUrl: string }) {
  return (
    <header className={styles.header}>
      <a href="/" aria-label="NEONTRIP Startseite" className={styles.logoLink}>
        <img
          src="/assets/logo_weiss_neontrip.png"
          alt="NEONTRIP"
          className={styles.logo}
        />
      </a>

      <nav className={styles.nav} aria-label="Vorschau Navigation">
        <a href="#vorschau">Vorschau</a>
        <a href="#details">Details</a>
        <a href="#kontakt">Kontakt</a>
      </nav>

      <div className={styles.headerActions}>
        <a href="tel:+4921154257240" className={styles.phoneLink}>
          <Phone size={16} />
          0211 54257240
        </a>
        <a href={offerUrl || "#kontakt"} className={styles.headerCta}>
          Angebot öffnen
          <ArrowUpRight size={16} />
        </a>
      </div>
    </header>
  );
}

function VideoPanel({ data }: { data: PreviewData }) {
  return (
    <div id="vorschau" className={styles.videoShell}>
      <div className={styles.videoTopbar}>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.videoFrame}>
        {data.videoUrl ? (
          <video
            className={styles.video}
            controls
            playsInline
            preload="metadata"
            poster={data.thumbnailUrl || undefined}
            src={data.videoUrl}
          />
        ) : (
          <div className={styles.videoFallback}>
            <div className={styles.playButton}>
              <Play size={34} fill="currentColor" />
            </div>
            <p>Das KI-Video erscheint hier, sobald es erstellt wurde.</p>
          </div>
        )}
      </div>
      <div className={styles.videoCaption}>
        <span>Persönliche Vorschau</span>
        <span>Erstellt für dieses Angebot</span>
      </div>
    </div>
  );
}

function Hero({ data }: { data: PreviewData }) {
  return (
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>NEONTRIP Vorschau</p>
        <h1>So wirkt Ihr Leuchtschild im Raum.</h1>
        <p className={styles.lead}>
          Wir haben Ihr Motiv als kurze Lichtvorschau vorbereitet. So sehen Sie
          die Wirkung besser, bevor Sie das Angebot freigeben oder Änderungen
          zurückmelden.
        </p>
        <div className={styles.heroActions}>
          <a
            href={data.offerUrl || "#kontakt"}
            className={`${styles.primaryCta} ${
              data.offerUrl ? "" : styles.disabledCta
            }`}
            aria-disabled={!data.offerUrl}
          >
            Angebot öffnen
            <ArrowUpRight size={18} />
          </a>
          <a href={data.changeRequestUrl} className={styles.secondaryCta}>
            Änderung wünschen
            <MessageCircle size={18} />
          </a>
        </div>
        <div className={styles.trustRow}>
          <span>
            <CheckCircle2 size={16} />
            Angebot bleibt verbindlich
          </span>
          <span>
            <Clock3 size={16} />
            Kurze Vorschau
          </span>
          <span>
            <ShieldCheck size={16} />
            Manuell prüfbar
          </span>
        </div>
      </div>
      <VideoPanel data={data} />
    </section>
  );
}

function Details() {
  const items = [
    {
      icon: Clock3,
      title: "Kurz nach dem Angebot",
      text: "Die Vorschau ergänzt das Angebot und macht die Wirkung greifbarer. Preise, Maße und Optionen bleiben im offiziellen Dokument.",
    },
    {
      icon: ShieldCheck,
      title: "Kein Blindflug",
      text: "Sie sehen vor der Freigabe, ob die Richtung passt. Falls Farbe, Größe oder Wirkung anders sein sollen, reicht eine kurze Rückmeldung.",
    },
    {
      icon: CheckCircle2,
      title: "Ein klarer nächster Schritt",
      text: "Wenn die Vorschau passt, können Sie das Angebot direkt öffnen. Wenn nicht, melden Sie den Änderungswunsch zurück.",
    },
  ];

  return (
    <section id="details" className={styles.details}>
      {items.map((item) => (
        <article key={item.title} className={styles.detailCard}>
          <item.icon size={22} />
          <h2>{item.title}</h2>
          <p>{item.text}</p>
        </article>
      ))}
    </section>
  );
}

function Contact({ offerUrl }: { offerUrl: string }) {
  return (
    <section id="kontakt" className={styles.contact}>
      <div>
        <p className={styles.eyebrow}>Nächster Schritt</p>
        <h2>Passt die Wirkung, kann das Angebot digital freigegeben werden.</h2>
      </div>
      <div className={styles.contactActions}>
        <a
          href={offerUrl || "#"}
          className={`${styles.lightCta} ${offerUrl ? "" : styles.disabledCta}`}
          aria-disabled={!offerUrl}
        >
          Angebot öffnen
          <ArrowUpRight size={18} />
        </a>
        <a href="mailto:support@neontrip.de" className={styles.darkCta}>
          Rückfrage senden
          <Mail size={18} />
        </a>
      </div>
    </section>
  );
}

function Footer() {
  const products = [
    ["LED Neonschild", "/anfrage.html?produkt=neonschild"],
    ["3D Buchstaben (Front)", "/anfrage.html?produkt=front-buchstaben"],
    ["3D Buchstaben (Rück)", "/anfrage.html?produkt=halo-buchstaben"],
    ["Leuchtkasten", "/anfrage.html?produkt=leuchtkasten"],
    ["Marquee-Buchstaben", "/anfrage.html?produkt=marquee"],
    ["Neon-Halo", "/anfrage.html?produkt=halo-lampe"],
  ];
  const pages = [
    ["Projekte", "/#projekte"],
    ["Bewertungen", "/#bewertungen"],
    ["Vorteile", "/#vorteile"],
    ["FAQ", "/#faq"],
    ["Kontakt", "/#kontakt"],
  ];
  const stats = [
    ["8.247+", "Projekte"],
    ["4,9/5", "Google Bewertung"],
    ["100%", "Pünktliche Lieferung"],
    ["3 Tage", "Express Lieferung"],
  ];

  return (
    <footer className={styles.footer}>
      <div className={styles.footerTop}>
        <div className={styles.footerBrandIntro}>
          <a href="/" aria-label="NEONTRIP Startseite">
            <img
              src="/assets/logo_schwarz_neontrip.png"
              alt="NEONTRIP"
              className={styles.footerLogoDark}
            />
          </a>
          <p className={styles.footerTagline}>Individuelle LED Neon Schilder</p>
          <p className={styles.footerProducts}>
            Leuchtschriften, Logos und Sonderanfertigungen aus Düsseldorf.
          </p>
          <div className={styles.socialRow} aria-label="NEONTRIP Social Links">
            <a href="https://instagram.com/neontrip.de" aria-label="Instagram">
              IG
            </a>
            <a href="https://linkedin.com/company/neontrip" aria-label="LinkedIn">
              IN
            </a>
            <a href="https://youtube.com/@neontrip" aria-label="YouTube">
              YT
            </a>
          </div>
        </div>

        <div className={styles.footerColumn}>
          <p className={styles.footerTitle}>Produkte</p>
          <nav className={styles.footerNav} aria-label="Produkte">
            {products.map(([label, href]) => (
              <a key={label} href={href}>
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className={styles.footerColumn}>
          <p className={styles.footerTitle}>Seiten</p>
          <nav className={styles.footerNav} aria-label="Seiten">
            {pages.map(([label, href]) => (
              <a key={label} href={href}>
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className={styles.footerColumn}>
          <p className={styles.footerTitle}>Kontakt</p>
          <div className={styles.footerContact}>
            <a href="tel:+4921154257240" className={styles.accentLink}>
              +49 211 54257240
            </a>
            <p>Montag - Freitag</p>
            <p>9:00 - 17:00 Uhr</p>
            <a href="mailto:support@neontrip.de" className={styles.accentLink}>
              support@neontrip.de
            </a>
            <p>
              NEONTRIP
              <br />
              Bilker Allee 29
              <br />
              40219 Düsseldorf
            </p>
          </div>
        </div>
      </div>

      <div className={styles.footerBrand}>
        <div className={styles.footerStats}>
          {stats.map(([number, label]) => (
            <div key={label}>
              <strong>{number}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <img
          src="/assets/logo_weiss_neontrip.png"
          alt="NEONTRIP"
          className={styles.footerBigLogo}
        />
        <div className={styles.footerMeta}>
          <span>© 2026 NEONTRIP</span>
          <nav className={styles.footerLegalRow} aria-label="Rechtliches">
            <a href="/agb.html">AGBs</a>
            <a href="/cookie-einstellungen.html">Cookies</a>
            <a href="/datenschutz.html">Datenschutz</a>
            <a href="/impressum.html">Impressum</a>
            <a href="/widerrufsrecht.html">Widerrufsrecht</a>
          </nav>
          <a href="/anfrage.html" className={styles.footerInquiryCta}>
            Noch kein Angebot? Jetzt kostenlos anfragen
            <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </footer>
  );
}

export default async function VideoPreviewPage({
  searchParams,
}: PreviewPageProps) {
  const resolvedSearchParams = (await searchParams) || {};
  const data = buildPreviewData(resolvedSearchParams);

  return (
    <main className={styles.page}>
      <CriticalStyles />
      <Header offerUrl={data.offerUrl} />
      <Hero data={data} />
      <Details />
      <Contact offerUrl={data.offerUrl} />
      <Footer />
    </main>
  );
}
