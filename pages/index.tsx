import Head from "next/head";
import { Inter } from "next/font/google";
import styles from "@/styles/Home.module.css";
import Link from "next/link";

// ✅ Inter é compatível com Next.js 14
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export default function Home() {
  return (
    <>
      <Head>
        <title>SICOSI Backend API</title>
        <meta name="description" content="SICOSI - Sistema de Compras Sustentáveis Inteligente" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className={`${styles.main} ${inter.variable}`}>
        <div className={styles.container}>
          <h1 className={styles.title}>
            SICOSI Backend API
          </h1>
          
          <p className={styles.description}>
            Sistema de Compras Sustentáveis Inteligente
          </p>

          <div className={styles.grid}>
            <Link href="/api/search" className={styles.card}>
              <h2>Search API &rarr;</h2>
              <p>Web search for sustainable products</p>
            </Link>

            <Link href="/api/analyze-product" className={styles.card}>
              <h2>Analyze API &rarr;</h2>
              <p>Analyze product sustainability</p>
            </Link>

            <Link href="/api/find-alternatives" className={styles.card}>
              <h2>Alternatives API &rarr;</h2>
              <p>Find sustainable alternatives</p>
            </Link>

            <Link href="/api/verify-claims" className={styles.card}>
              <h2>Verify API &rarr;</h2>
              <p>Verify sustainability claims</p>
            </Link>
          </div>

          <div className={styles.footer}>
            <p>
              Powered by{" "}
              <a href="https://vercel.com" target="_blank" rel="noopener noreferrer">
                Vercel
              </a>
              {" "}&{" "}
              <a href="https://nextjs.org" target="_blank" rel="noopener noreferrer">
                Next.js
              </a>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}