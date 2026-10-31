// THYNKPDF desktop launcher: tiles open the web app with ?tool=<id> (the editor opens; tool deep-links are a hint until the web app reads them).
const TILES = [
  ["edit", "✏️", "Edit PDF", "Change text, rotate and rearrange pages"],
  ["merge", "🧩", "Merge / Split", "Combine files or pull pages out"],
  ["compress", "🗜️", "Compress", "Make big PDFs smaller"],
  ["sign", "✍️", "Sign", "Add your signature or request signatures"],
  ["forms", "📝", "Forms", "Fill, create and flatten form fields"],
  ["annotate", "💬", "Comment", "Highlight, notes, drawings, stamps"],
  ["ai", "✨", "AI Ask", "Ask questions and summarize, with page citations"],
  ["documents", "📁", "Documents", "Folders, tags, trash and sharing"],
];
document.getElementById("tiles").innerHTML = TILES.map(([id, ic, t, d]) =>
  `<a class="tile" href="/?tool=${id}" data-tool="${id}"><div class="ic">${ic}</div><h2>${t}</h2><p>${d}</p></a>`).join("");

const RELEASES = "https://api.github.com/repos/ThynkAI/thynkpdf/releases/latest";
const newer = (a, b) => { const p = s => s.replace(/^v/, "").split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
(async () => {
  let version = "dev";
  try { version = (await (await fetch("/desktop/info")).json()).version; } catch {}
  document.getElementById("ver").textContent = "v" + version;
  try {
    const r = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return;
    const rel = await r.json();
    if (rel.tag_name && version !== "dev" && newer(rel.tag_name, version)) {
      const el = document.getElementById("update");
      el.innerHTML = `Update available: ${rel.tag_name} — <a href="${rel.html_url}" target="_blank" rel="noopener">download</a>`;
      el.hidden = false;
    }
  } catch { /* offline: no update check */ }
})();
