"use client";
import dynamic from "next/dynamic";
const SignerPage = dynamic(() => import("@/components/SignerPage").then((m) => m.SignerPage), { ssr: false });
export default function Page() { return <SignerPage />; }
