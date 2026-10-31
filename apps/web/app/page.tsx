"use client";
import dynamic from "next/dynamic";
const EditorShell = dynamic(() => import("@/components/EditorShell").then((m) => m.EditorShell), { ssr: false });
export default function Page() { return <EditorShell />; }
