(() => {
  'use strict';

  const target = document.getElementById('print-document');
  const printButton = document.getElementById('print-button');
  const selectionLabel = document.getElementById('print-selection');
  const params = new URLSearchParams(window.location.search);
  const topicParam = params.get('tema');
  const topicNumber = topicParam === null ? null : Number(topicParam);

  // Se imprime el contenido original de temario.json: no hay una copia distinta
  // del manual ni se mezclan las preguntas del simulador con el temario.
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const formatted = value => safe(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  function sectionHtml(section, index, total, topicNumber) {
    const numbers = Array.isArray(section.preguntas) ? section.preguntas.join(', ') : '';
    return `<section class="chapter" id="${safe(section.id)}">
      <p class="chapter-label">Apartado ${index + 1} de ${total}</p>
      <h3>${safe(section.titulo)}</h3>
      <p class="chapter-intro">${formatted(section.intro)}</p>
      <div class="chapter-points">${(section.puntos || []).map(item => `<p>${formatted(item)}</p>`).join('')}</div>
      ${section.clave ? `<aside class="remember"><strong>Para recordar</strong><p>${formatted(section.clave)}</p></aside>` : ''}
      ${section.nota ? `<aside class="note"><strong>Aclaración</strong><p>${formatted(section.nota)}</p></aside>` : ''}
      ${numbers ? `<p class="question-ref">Preguntas relacionadas: ${safe(numbers)} del tema ${topicNumber}</p>` : ''}
    </section>`;
  }

  function topicHtml(topic) {
    const sections = topic.secciones || [];
    return `<section class="topic" id="tema-${topic.numero}">
      <header class="topic-heading">
        <p class="topic-kicker">Tema ${topic.numero}</p>
        <h2>${safe(topic.titulo)}</h2>
        <p>${sections.length} apartados · ${topic.preguntas_totales ?? ''} preguntas relacionadas</p>
      </header>
      ${sections.map((section, index) => sectionHtml(section, index, sections.length, topic.numero)).join('')}
    </section>`;
  }

  function sourceHtml(source) {
    // El texto del enlace queda visible si se imprime en papel.
    const url = String(source.url || '');
    const safeUrl = /^https:\/\//i.test(url) ? safe(url) : '';
    return `<li><span>${safe(source.nombre)}</span>${safeUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>` : ''}</li>`;
  }

  function render(guide, topics) {
    const full = topicNumber === null;
    const title = full ? guide.titulo || 'Manual de estudio · Licencia de armas E'
      : `Tema ${topics[0].numero} · ${topics[0].titulo}`;
    const date = new Intl.DateTimeFormat('es-ES', {day: 'numeric', month: 'long', year: 'numeric'}).format(new Date());
    const toc = full ? `<nav class="toc" aria-label="Índice de temas">
      <h2>Índice del temario</h2>
      <ol>${topics.map(topic => `<li><a href="#tema-${topic.numero}"><span>Tema ${topic.numero}. ${safe(topic.titulo)}</span></a></li>`).join('')}</ol>
    </nav>` : '';
    target.innerHTML = `<div class="cover">
      <p class="cover-eyebrow">Material de preparación · Licencia de armas E</p>
      <h1>${safe(title)}</h1>
      <p class="cover-intro">${full ? `${topics.length} temas · Edición para lectura e impresión` : 'Edición para lectura e impresión'}</p>
      <p class="cover-date">Preparado para impresión el ${safe(date)}</p>
      <div class="cover-warning">
        <strong>Importante</strong>
        <p>Este es un material independiente de preparación. No es un documento oficial de la Guardia Civil. Las respuestas de los cuestionarios pueden reflejar redacciones antiguas; consulta las aclaraciones del manual y la normativa vigente para distinguirlas.</p>
      </div>
    </div>
    ${toc}
    ${topics.map(topicHtml).join('')}
    <section class="sources"><h2>Fuentes y referencias</h2>
      <ol>${(guide.fuentes || []).map(sourceHtml).join('')}</ol>
      <p class="final-note">El temario no sustituye las instrucciones oficiales ni la formación práctica. Las normas pueden cambiar después de la edición de este manual.</p>
    </section>`;
    document.title = full ? 'Temario completo · Licencia de armas E' : `${title} · Licencia de armas E`;
    selectionLabel.textContent = full ? 'Temario completo · 7 temas' : `Tema ${topics[0].numero}`;
    printButton.disabled = false;
  }

  printButton.addEventListener('click', () => window.print());

  async function init() {
    try {
      if (topicParam !== null && (!Number.isInteger(topicNumber) || topicNumber < 1 || topicNumber > 7)) {
        throw new Error('El tema solicitado no existe.');
      }
      const response = await fetch('./temario.json');
      if (!response.ok) throw new Error(`No se pudo cargar el temario (${response.status}).`);
      const guide = await response.json();
      if (!Array.isArray(guide.temas) || !guide.temas.length) throw new Error('El temario no tiene el formato esperado.');
      const topics = topicNumber === null ? guide.temas : guide.temas.filter(topic => topic.numero === topicNumber);
      if (!topics.length) throw new Error('No se encuentra el tema solicitado.');
      render(guide, topics);
    } catch (error) {
      target.innerHTML = `<div class="loading error"><h1>Impresión no disponible</h1><p>${safe(error.message)}</p><p>Vuelve a abrir el temario desde la aplicación.</p></div>`;
      selectionLabel.textContent = 'Error al preparar el temario';
    }
  }

  init();
})();
