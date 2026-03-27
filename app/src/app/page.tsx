"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import styles from "./landing.module.css";

export default function HomePage() {
  const router = useRouter();
  const [adminType, setAdminType] = useState<"citizen_admin" | "hr_admin" | "company_admin">("citizen_admin");

  const adminEmail = useMemo(() => {
    if (adminType === "citizen_admin") return "citizen_admin@pragya.local";
    if (adminType === "hr_admin") return "hr_admin@pragya.local";
    return "company_admin@pragya.local";
  }, [adminType]);

  return (
    <section className={styles.brandLanding}>
      <header className={styles.brandHero}>
        <div className={styles.brandHeroCopy}>
          <p className={styles.brandKicker}>Legal Intelligence Platform</p>
          <h1>Pragya</h1>
          <p>
            One workspace for legal chat, governed ingestion, and memory-graph exploration across citizen, HR, and
            company law.
          </p>
          <div className={styles.brandHeroActions}>
            <button type="button" className="primary-btn" onClick={() => router.push("/chat")}>
              Open User Chat
            </button>
            <button
              type="button"
              className={`secondary-btn ${styles.heroSecondaryBtn}`}
              onClick={() => router.push(`/admin?tab=ingestion&email=${encodeURIComponent(adminEmail)}`)}
            >
              Open Admin
            </button>
          </div>
        </div>
        <div className={styles.brandHeroGraph} aria-hidden>
          <div className={`${styles.miniNode} ${styles.miniQuery}`}>Query: theft</div>
          <div className={`${styles.miniNode} ${styles.miniSection}`}>Sec 305 Theft</div>
          <div className={`${styles.miniNode} ${styles.miniDef}`}>Wrongful gain</div>
          <div className={`${styles.miniNode} ${styles.miniPunish}`}>Punishment</div>
          <div className={`${styles.miniEdge} ${styles.edgeA}`} />
          <div className={`${styles.miniEdge} ${styles.edgeB}`} />
          <div className={`${styles.miniEdge} ${styles.edgeC}`} />
        </div>
      </header>

      <section className={styles.brandMiniGrid}>
        <article className={styles.brandMiniCard}>
          <h3>Sample Chat</h3>
          <p>Retrieval-grounded responses with domain routing and citations.</p>
          <div className={styles.miniChat}>
            <div className={`${styles.miniMsg} ${styles.miniUser}`}>Under this Act, what is wrongful gain?</div>
            <div className={`${styles.miniMsg} ${styles.miniAssistant}`}>
              Wrongful gain means gain by unlawful means of property not legally entitled to.
            </div>
          </div>
          <button type="button" className="ghost-btn" onClick={() => router.push("/chat")}>
            Try Chat
          </button>
        </article>

        <article className={styles.brandMiniCard}>
          <h3>Sample Memory Graph</h3>
          <p>Interactive legal concept graph with node expansion and definitions.</p>
          <div className={styles.miniMap}>
            <span className={`${styles.miniPill} ${styles.pillQ}`}>Query</span>
            <span className={`${styles.miniPill} ${styles.pillS}`}>Section</span>
            <span className={`${styles.miniPill} ${styles.pillD}`}>Definition</span>
            <span className={`${styles.miniPill} ${styles.pillP}`}>Punishment</span>
          </div>
          <button type="button" className="ghost-btn" onClick={() => router.push("/chat")}>
            Build Mindmap
          </button>
        </article>

        <article className={styles.brandMiniCard}>
          <h3>Sample Admin Portal</h3>
          <p>Domain-scoped ingestion, file registry, and retrieval-ready chunk stats.</p>
          <label>
            Admin type
            <select value={adminType} onChange={(event) => setAdminType(event.target.value as typeof adminType)}>
              <option value="citizen_admin">Citizen Admin</option>
              <option value="hr_admin">HR Admin</option>
              <option value="company_admin">Company Admin</option>
            </select>
          </label>
          <div className={styles.miniAdminStats}>
            <span>Stored: 12 files</span>
            <span>Chunks: 2,184</span>
            <span>Embedded: 2,184/2,184</span>
          </div>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => router.push(`/admin?tab=ingestion&email=${encodeURIComponent(adminEmail)}`)}
          >
            Continue as {adminType}
          </button>
        </article>
      </section>
    </section>
  );
}
