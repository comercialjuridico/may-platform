// ─── markdown.js — Renderizador de Markdown leve ─────────────────────────────
// Sem dependência externa. Cobre os casos usados pela May.

function renderMarkdown(texto) {
  if (!texto) return '';

  let html = texto
    // Escapa HTML perigoso
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

    // Blocos de código
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`
    )

    // Código inline
    .replace(/`([^`]+)`/g, '<code>$1</code>')

    // Negrito + itálico
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')

    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')

    // Listas não-ordenadas
    .replace(/^\s*[-*+] (.+)$/gm, '<li>$1</li>')

    // Listas ordenadas
    .replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>')

    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')

    // Separadores
    .replace(/^---+$/gm, '<hr />')

    // Links [texto](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    )

    // Quebras de linha → parágrafos
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // Agrupa <li> em <ul>
  html = html.replace(/(<li>.*?<\/li>(\s*<br>)*)+/gs, match =>
    `<ul>${match.replace(/<br>/g, '')}</ul>`
  );

  // Envolve em parágrafo se não começar com tag de bloco
  if (!html.match(/^<(h[1-6]|ul|ol|pre|blockquote|hr)/)) {
    html = `<p>${html}</p>`;
  }

  return html;
}

window.renderMarkdown = renderMarkdown;
