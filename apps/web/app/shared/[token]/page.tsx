"use client";
import dynamic from "next/dynamic";
const SharedView = dynamic(() => import("@/components/SharedView").then((m) => m.SharedView), { ssr: false });
export default function Page() { return <SharedView />; }
