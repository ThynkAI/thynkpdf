"use client";
import dynamic from "next/dynamic";
const Dashboard = dynamic(() => import("@/components/Dashboard").then((m) => m.Dashboard), { ssr: false });
export default function Page() { return <Dashboard />; }
