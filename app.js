(() => {
  'use strict';

  const EXAM_LENGTH = 20;
  const EXAM_SECONDS = 20 * 60;
  const PASS_MARK = 16;
  const STORAGE_SESSION = 'examen-e-simulador-sesion-v1';
  const TOPIC_NAMES = {
    1: 'Funcionamiento y seguridad',
    2: 'Categorías y tipos de armas',
    3: 'Circulación y revista',
    4: 'Licencias y documentación',
    5: 'Infracciones y sanciones',
    6: 'Reparación y depósito',
    7: 'Armas de colección'
  };

  let bank = [];
  let bankById = new Map();
  let session = null;
  let reviewFilter = 'errors';
  let timerInterval = null;
  const app = document.getElementById('app');

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const letter = index => ['A', 'B', 'C'][index] || '?';
  const plural = (number, one, many) => `${number} ${number === 1 ? one : many}`;

  function readStorage(key, defaultValue) {
    try { return JSON.parse(localStorage.getItem(key)) ?? defaultValue; }
    catch { return defaultValue; }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* almacenamiento opcional */ }
  }
  function saveSession() { if (session) writeStorage(STORAGE_SESSION, session); }

  function shuffle(items) {
    const output = [...items];
    for (let i = output.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [output[i], output[j]] = [output[j], output[i]];
    }
    return output;
  }

  function cleanTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  function startSession(mode, topic = null) {
    const candidates = topic ? bank.filter(question => question.tema === topic) : bank;
    if (candidates.length < EXAM_LENGTH) return;
    if (session && !session.finished && !window.confirm('¿Empezar de nuevo? Se perderán las respuestas del examen en curso.')) return;
    cleanTimer();
    const ids = shuffle(candidates).slice(0, EXAM_LENGTH).map(q => q.id);
    session = {
      mode, topic, ids, answers: ids.map(() => null), current: 0,
      startedAt: Date.now(), deadline: mode === 'exam' ? Date.now() + EXAM_SECONDS * 1000 : null,
      finished: false, finishedAt: null, reason: null
    };
    saveSession();
    renderQuestion();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function getCurrentQuestions() { return session.ids.map(id => bankById.get(id)); }
  function scoreSession() {
    const questions = getCurrentQuestions();
    const right = questions.reduce((acc, q, i) => acc + Number(session.answers[i] === q.correcta), 0);
    const unanswered = session.answers.filter(answer => answer === null).length;
    return { right, wrong: EXAM_LENGTH - right - unanswered, unanswered, passed: right >= PASS_MARK };
  }

  function finishSession(reason = 'manual') {
    if (!session || session.finished) return;
    session.finished = true;
    session.reason = reason;
    session.finishedAt = Date.now();
    saveSession();
    cleanTimer();
    reviewFilter = 'errors';
    renderResults();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderHome() {
    cleanTimer();
    app.innerHTML = `
      <section class="home">
        <div class="hero">
          <h1>Examen de Licencia de armas E</h1>
          <p class="lead">Simulacros y práctica por temas con preguntas tipo test. La corrección se muestra al finalizar.</p>
        </div>
        <div class="info-grid" aria-label="Características del examen">
          <div class="info"><div class="value">20</div><div class="label">preguntas</div></div>
          <div class="info"><div class="value">20 minutos</div><div class="label">de duración</div></div>
          <div class="info"><div class="value">16 aciertos</div><div class="label">para aprobar</div></div>
        </div>
        <div class="launch-panel">
          <div><h2>Simulacro de examen</h2><p class="small-muted">20 preguntas aleatorias de los 7 temas. Tiempo limitado a 20 minutos.</p></div>
          <div class="actions">
            ${session && !session.finished ? '<button class="btn btn-outline" data-action="resume">Continuar anterior</button>' : ''}
            <button class="btn btn-primary" data-action="start-exam">Empezar simulacro</button>
          </div>
        </div>
        <div class="practice-panel">
          <div><h2>Practicar por tema</h2><p class="small-muted">20 preguntas del tema que elijas, sin límite de tiempo.</p></div>
          <div class="practice-controls">
            <select id="topic" aria-label="Seleccionar tema">
              ${Object.entries(TOPIC_NAMES).map(([number, name]) => `<option value="${number}">Tema ${number} · ${escapeHtml(name)}</option>`).join('')}
            </select>
            <button class="btn btn-outline" data-action="start-practice">Practicar</button>
          </div>
        </div>
        <p class="bank-note">${bank.length} preguntas disponibles en 7 temas.</p>
      </section>`;
  }

  function timerText() {
    const seconds = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000));
    const mins = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return `${String(mins).padStart(2,'0')}:${String(rem).padStart(2,'0')}`;
  }

  function updateTimer() {
    if (!session || session.finished || !session.deadline) return;
    const seconds = Math.ceil((session.deadline - Date.now()) / 1000);
    if (seconds <= 0) {
      finishSession('time');
      return;
    }
    const time = document.getElementById('time-left');
    if (time) {
      time.textContent = timerText();
      time.parentElement.classList.toggle('urgent', seconds <= 60);
    }
  }

  function renderQuestion() {
    if (!session || session.finished) return;
    cleanTimer();
    if (session.deadline && Date.now() >= session.deadline) { finishSession('time'); return; }
    const questions = getCurrentQuestions();
    const idx = session.current;
    const question = questions[idx];
    const selected = session.answers[idx];
    const answered = session.answers.filter(a => a !== null).length;
    const lastQuestion = idx === EXAM_LENGTH - 1;
    const label = session.mode === 'exam' ? 'Simulacro de examen' : `Práctica · Tema ${session.topic}`;
    app.innerHTML = `
      <section class="exam">
        <div class="exam-toolbar">
          <div><div class="exam-title">${escapeHtml(label)}</div><div class="exam-subtitle">${answered} de ${EXAM_LENGTH} respondidas</div></div>
          ${session.deadline ? `<div class="timer" role="timer" aria-label="Tiempo restante"><span class="circle" aria-hidden="true"></span><span id="time-left">${timerText()}</span></div>` : '<div class="timer">Sin límite de tiempo</div>'}
        </div>
        <div class="progress-strip" role="progressbar" aria-valuemin="0" aria-valuemax="20" aria-valuenow="${answered}" aria-label="Preguntas respondidas"><div style="width:${answered / EXAM_LENGTH * 100}%"></div></div>
        <article class="question-card">
          <div class="q-overline"><span class="q-badge">Pregunta ${idx + 1} de ${EXAM_LENGTH}</span><span>Tema ${question.tema} · ${escapeHtml(TOPIC_NAMES[question.tema])}</span></div>
          <h2 class="q-title">${escapeHtml(question.pregunta)}</h2>
          <div class="options" role="group" aria-label="Selecciona una respuesta">
            ${question.opciones.map((text, i) => `
              <button class="option ${selected === i ? 'selected' : ''}" type="button" data-action="choose" data-choice="${i}" aria-pressed="${selected === i}">
                <span class="option-key" aria-hidden="true">${letter(i)}</span>
                <span class="option-text">${escapeHtml(text)}</span>
              </button>`).join('')}
          </div>
        </article>
        <nav class="bottom-nav" aria-label="Navegación por preguntas">
          <button class="btn btn-outline" data-action="previous" ${idx === 0 ? 'disabled' : ''}>← Anterior</button>
          <div class="nav-center" aria-label="Ir a pregunta">
            ${questions.map((_, i) => `<button class="dot ${i === idx ? 'current' : ''} ${session.answers[i] !== null ? 'answered' : ''}" data-action="goto" data-index="${i}" aria-label="Pregunta ${i + 1}${session.answers[i] === null ? ' sin responder' : ' respondida'}" ${i === idx ? 'aria-current="step"' : ''}></button>`).join('')}
          </div>
          <button class="btn ${lastQuestion ? 'btn-primary' : 'btn-outline'}" data-action="${lastQuestion ? 'finish' : 'next'}">${lastQuestion ? 'Terminar examen' : 'Siguiente →'}</button>
        </nav>
        <p class="nav-bottom-text">${session.mode === 'exam' ? 'Puedes cambiar tus respuestas antes de terminar.' : 'Las soluciones aparecerán al finalizar la práctica.'} ${!lastQuestion ? '<button class="inline-finish" data-action="finish">Finalizar ahora</button>' : ''}</p>
      </section>`;
    if (session.deadline) {
      updateTimer();
      timerInterval = setInterval(updateTimer, 1000);
    }
  }

  function renderResults() {
    cleanTimer();
    if (!session) return renderHome();
    const score = scoreSession();
    const questions = getCurrentQuestions();
    const examPassed = score.passed;
    const title = examPassed ? 'Aprobado' : 'No aprobado';
    const subtitle = session.reason === 'time' ? 'Tiempo agotado. Se han corregido las respuestas registradas.' : examPassed ? 'Has alcanzado el mínimo de 16 aciertos.' : 'No has alcanzado el mínimo de 16 aciertos.';
    const mistakes = questions.map((q, idx) => ({ q, idx })).filter(({q,idx}) => session.answers[idx] !== q.correcta);
    const shown = reviewFilter === 'errors' ? mistakes : questions.map((q, idx) => ({q,idx}));
    app.innerHTML = `
      <section class="results">
        <div class="result-hero">
          <div>
            <p class="result-label">${session.mode === 'exam' ? 'Resultado del simulacro' : 'Resultado de la práctica'}</p>
            <h1>${title}</h1>
            <p class="small-muted">${subtitle}</p>
            <div class="result-counts" style="margin-top:20px"><span><b>${score.right}</b> correctas</span><span><b>${score.wrong}</b> incorrectas</span><span><b>${score.unanswered}</b> en blanco</span></div>
          </div>
          <div class="result-score ${examPassed ? '' : 'fail'}" aria-label="${score.right} aciertos de 20"><strong>${score.right}</strong><small>de 20</small></div>
        </div>
        <div class="result-actions">
          <button class="btn btn-primary" data-action="start-exam">Otro simulacro</button>
          <button class="btn btn-outline" data-action="home">Volver al inicio</button>
        </div>
        <div class="review-header"><h2>Revisión de respuestas</h2><button class="btn btn-subtle" data-action="toggle-review">${reviewFilter === 'errors' ? 'Ver todas' : 'Solo errores'}</button></div>
        ${shown.length ? shown.map(({q,idx}) => {
            const chosen = session.answers[idx];
            const isCorrect = chosen === q.correcta;
            return `<article class="review-card ${isCorrect ? 'correct' : 'wrong'}">
              <div class="review-tag">Pregunta ${idx + 1} · Tema ${q.tema} · ${isCorrect ? 'Correcta' : chosen === null ? 'Sin responder' : 'Incorrecta'}</div>
              <h3>${escapeHtml(q.pregunta)}</h3>
              <div class="review-options" role="list" aria-label="Opciones de respuesta">
                ${q.opciones.map((option, i) => {
                  const correct = i === q.correcta;
                  const selectedWrong = chosen === i && !correct;
                  const state = correct ? 'is-correct' : selectedWrong ? 'is-wrong' : '';
                  const status = correct ? (chosen === i ? 'Correcta · Tu respuesta' : 'Respuesta correcta') : selectedWrong ? 'Tu respuesta' : '';
                  return `<div class="review-option ${state}" role="listitem">
                    <span class="review-letter">${letter(i)}</span>
                    <span class="review-option-text">${escapeHtml(option)}</span>
                    ${status ? `<span class="review-status">${status}</span>` : ''}
                  </div>`;
                }).join('')}
              </div>
            </article>`;
          }).join('') : '<div class="empty-state">¡Muy bien! No has tenido ningún error ni has dejado preguntas sin contestar.</div>'}
      </section>`;
  }

  // Todos los controles usan un único manejador para funcionar en móvil y ordenador.
  app.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    switch (button.dataset.action) {
      case 'start-exam': startSession('exam'); break;
      case 'start-practice': startSession('practice', Number(document.getElementById('topic').value)); break;
      case 'resume': renderQuestion(); break;
      case 'choose': {
        if (!session || session.finished) break;
        session.answers[session.current] = Number(button.dataset.choice);
        saveSession();
        renderQuestion();
        break;
      }
      case 'next':
      case 'previous':
      case 'goto': {
        if (!session || session.finished) break;
        if (button.dataset.action === 'goto') session.current = Number(button.dataset.index);
        else session.current += button.dataset.action === 'next' ? 1 : -1;
        session.current = Math.max(0, Math.min(EXAM_LENGTH-1, session.current));
        saveSession();
        renderQuestion();
        break;
      }
      case 'finish': {
        if (!session || session.finished) break;
        const missing = session.answers.filter(a => a === null).length;
        if (missing && !window.confirm(`Tienes ${plural(missing,'pregunta sin responder','preguntas sin responder')}. ¿Terminar y corregir ahora?`)) break;
        finishSession();
        break;
      }
      case 'toggle-review': reviewFilter = reviewFilter === 'errors' ? 'all' : 'errors'; renderResults(); break;
      case 'home': renderHome(); break;
      default: break;
    }
  });

  async function init() {
    try {
      const response = await fetch('./preguntas.json');
      if (!response.ok) throw new Error(`Error ${response.status}`);
      bank = await response.json();
      if (!Array.isArray(bank) || bank.length < EXAM_LENGTH || bank.some(q => !q.id || !Array.isArray(q.opciones) || q.opciones.length !== 3 || !Number.isInteger(q.correcta))) {
        throw new Error('El banco de preguntas no tiene el formato esperado.');
      }
      bankById = new Map(bank.map(q => [q.id, q]));
      const saved = readStorage(STORAGE_SESSION, null);
      if (saved && Array.isArray(saved.ids) && saved.ids.length === EXAM_LENGTH && saved.ids.every(id => bankById.has(id)) && Array.isArray(saved.answers) && saved.answers.length === EXAM_LENGTH) {
        session = saved;
        if (session.finished) renderResults();
        else if (session.deadline && session.deadline <= Date.now()) finishSession('time');
        else renderQuestion();
      } else renderHome();
    } catch (error) {
      console.error('No se pudieron cargar las preguntas', error);
      app.innerHTML = `<div class="loading-panel"><h2>No se pudo abrir el cuestionario</h2><p>Comprueba tu conexión y vuelve a cargar la página. Si has descargado los archivos, ábrela desde la web publicada en GitHub Pages.</p><button class="btn btn-primary" data-action="reload">Reintentar</button></div>`;
      const btn = app.querySelector('[data-action="reload"]');
      btn?.addEventListener('click', () => location.reload());
    }
  }

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(error => console.info('Modo sin conexión no disponible', error));
    });
  }
  init();
})();
