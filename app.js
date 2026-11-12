(() => {
  'use strict';

  const EXAM_LENGTH = 20;
  const EXAM_SECONDS = 20 * 60;
  const PASS_MARK = 16;
  const STORAGE_SESSION = 'examen-e-simulador-sesion-v1';
  const STORAGE_UNUSED = 'examen-e-preguntas-pendientes-v1';
  const STORAGE_REVIEW = 'examen-e-repaso-errores-v1';
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
  let studyGuide = null;
  let timerInterval = null;
  let progressResetNotice = false;
  const app = document.getElementById('app');

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const letter = index => ['A', 'B', 'C'][index] || '?';
  const plural = (number, one, many) => `${number} ${number === 1 ? one : many}`;
  const formatStudyText = (value) => escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const studyTopic = number => studyGuide?.temas?.find(t => t.numero === Number(number));
  const findStudySection = id => {
    for (const topic of studyGuide?.temas || []) {
      const section = topic.secciones?.find(item => item.id === id);
      if (section) return { ...section, tema: topic.numero };
    }
    return null;
  };

  function readStorage(key, defaultValue) {
    try { return JSON.parse(localStorage.getItem(key)) ?? defaultValue; }
    catch { return defaultValue; }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* almacenamiento opcional */ }
  }
  function saveSession() { if (session) writeStorage(STORAGE_SESSION, session); }

  // Solo se borran las claves de esta aplicación, nunca todo el almacenamiento del navegador.
  function resetProgress() {
    const message = '¿Borrar todo el progreso guardado en este dispositivo?\n\n' +
      'Se eliminarán el examen en curso, las respuestas guardadas, los errores pendientes ' +
      'y el historial de preguntas vistas.\n\n' +
      'Las 423 preguntas y el temario seguirán disponibles. Esta acción no se puede deshacer.';
    if (!window.confirm(message)) return;
    try {
      [STORAGE_SESSION, STORAGE_UNUSED, STORAGE_REVIEW].forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.warn('No se pudo borrar el progreso guardado', error);
      window.alert('No se ha podido borrar el progreso de este dispositivo. Inténtalo de nuevo.');
      return;
    }
    cleanTimer();
    session = null;
    reviewFilter = 'errors';
    progressResetNotice = true;
    renderHome();
  }

  // Solo se guardan los errores pendientes y su racha de aciertos.
  // Nunca se envían datos personales ni respuestas a un servidor.
  function getReviewProgress() {
    const saved = readStorage(STORAGE_REVIEW, {});
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { items: {}, lastProcessedSessionId: null };
    const items = saved.items && typeof saved.items === 'object' && !Array.isArray(saved.items) ? saved.items : {};
    return { items, lastProcessedSessionId: saved.lastProcessedSessionId ?? null };
  }

  function errorIds() {
    return Object.keys(getReviewProgress().items).filter(id => bankById.has(id));
  }

  // Cuenta solo un acierto por pregunta y por sesión, al finalizarla.
  // Un fallo o una pregunta en blanco reinicia el progreso de esa pregunta.
  // Tras dos sesiones distintas acertando consecutivamente, sale del repaso.
  function recordFinishedSession() {
    if (!session || !session.finished || !Array.isArray(session.ids)) return;
    const sessionId = session.id || `legacy-${session.startedAt}-${session.finishedAt}-${session.ids.join(',')}`;
    const progress = getReviewProgress();
    if (progress.lastProcessedSessionId === sessionId) return;
    session.ids.forEach((id, i) => {
      const question = bankById.get(id);
      if (!question) return;
      const correct = session.answers[i] === question.correcta;
      if (!correct) {
        progress.items[id] = { streak: 0, lastCorrectSession: null };
      } else if (Object.prototype.hasOwnProperty.call(progress.items, id)) {
        const entry = progress.items[id];
        if (entry.lastCorrectSession === sessionId) return;
        const streak = Math.max(0, Number(entry.streak) || 0) + 1;
        if (streak >= 2) delete progress.items[id];
        else progress.items[id] = { streak, lastCorrectSession: sessionId };
      }
    });
    progress.lastProcessedSessionId = sessionId;
    writeStorage(STORAGE_REVIEW, progress);
  }

  function shuffle(items) {
    const output = [...items];
    for (let i = output.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [output[i], output[j]] = [output[j], output[i]];
    }
    return output;
  }

  // En cada modalidad se agotan las preguntas pendientes antes de empezar otra vuelta.
  // El orden permanece en este dispositivo aunque el usuario cierre la aplicación.
  function chooseUnseenQuestions(candidates, mode, topic, count) {
    const key = mode === 'exam' ? 'exam' : mode === 'exam-practice' ? 'exam-practice' : mode === 'review' ? 'review-errors' : mode === 'study' ? `study-${topic}` : `practice-${topic}`;
    const allIds = candidates.map(question => question.id);
    const validIds = new Set(allIds);
    const saved = readStorage(STORAGE_UNUSED, {});
    const history = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    const unique = new Set();
    let pending = (Array.isArray(history[key]) ? history[key] : []).filter(id => {
      if (!validIds.has(id) || unique.has(id)) return false;
      unique.add(id);
      return true;
    });
    const chosen = [];
    while (chosen.length < count) {
      if (pending.length === 0) {
        // En el límite entre dos vueltas nunca se repite una pregunta
        // dentro del mismo examen, aunque falten menos de 20.
        const newRound = shuffle(allIds);
        pending = [
          ...newRound.filter(id => !chosen.includes(id)),
          ...newRound.filter(id => chosen.includes(id))
        ];
      }
      chosen.push(pending.shift());
    }
    history[key] = pending;
    writeStorage(STORAGE_UNUSED, history);
    return chosen;
  }

  function cleanTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  function startSession(mode, topic = null) {
    const section = mode === 'study' ? findStudySection(topic) : null;
    const candidates = mode === 'study' ? (section?.preguntas || []).map(num => bankById.get(`${section.tema}-${num}`)).filter(Boolean)
      : mode === 'review' ? errorIds().map(id => bankById.get(id))
      : topic ? bank.filter(question => question.tema === topic) : bank;
    const count = mode === 'review' || mode === 'study' ? Math.min(EXAM_LENGTH, candidates.length) : EXAM_LENGTH;
    if (count === 0 || candidates.length < count) return renderHome();
    if (session && !session.finished && !window.confirm('¿Empezar de nuevo? Se perderán las respuestas del examen en curso.')) return;
    cleanTimer();
    const ids = chooseUnseenQuestions(candidates, mode, topic, count);
    progressResetNotice = false;
    session = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    return { right, wrong: questions.length - right - unanswered, unanswered, passed: right >= PASS_MARK };
  }

  function finishSession(reason = 'manual') {
    if (!session || session.finished) return;
    session.finished = true;
    session.reason = reason;
    session.finishedAt = Date.now();
    saveSession();
    recordFinishedSession();
    cleanTimer();
    reviewFilter = session.mode === 'review' ? 'all' : 'errors';
    renderResults();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderHome() {
    cleanTimer();
    const hasErrors = errorIds().length > 0;
    app.innerHTML = `
      <section class="home">
        <div class="info-grid" aria-label="Características del examen">
          <div class="info"><div class="value">20</div><div class="label">preguntas</div></div>
          <div class="info"><div class="value">20 minutos</div><div class="label">de duración</div></div>
          <div class="info"><div class="value">16 aciertos</div><div class="label">para aprobar</div></div>
        </div>
        <div class="study-panel">
          <div><h2>Estudiar temario</h2><p class="small-muted">Lee las explicaciones de los siete temas y practica las preguntas relacionadas con cada apartado.</p></div>
          <button class="btn btn-primary" data-action="study-index" ${studyGuide?.temas?.length ? '' : 'disabled'}>Abrir temario</button>
        </div>
        <div class="launch-panel">
          <div><h2>Simulacro de examen</h2><p class="small-muted">20 preguntas aleatorias de los 7 temas. Tiempo limitado a 20 minutos.</p></div>
          <div class="actions">
            ${session && !session.finished ? '<button class="btn btn-outline" data-action="resume">Continuar anterior</button>' : ''}
            <button class="btn btn-primary" data-action="start-exam">Empezar simulacro</button>
          </div>
        </div>
        <div class="training-panel">
          <div><h2>Practicar examen</h2><p class="small-muted">20 preguntas de todos los temas, sin límite de tiempo. Verás si aciertas o fallas al responder.</p></div>
          <button class="btn btn-outline" data-action="start-exam-practice">Empezar práctica</button>
        </div>
        <div class="practice-panel">
          <div><h2>Practicar por tema</h2><p class="small-muted">20 preguntas del tema que elijas, sin límite de tiempo y con corrección inmediata.</p></div>
          <div class="practice-controls">
            <select id="topic" aria-label="Seleccionar tema">
              ${Object.entries(TOPIC_NAMES).map(([number, name]) => `<option value="${number}">Tema ${number} · ${escapeHtml(name)}</option>`).join('')}
            </select>
            <button class="btn btn-outline" data-action="start-practice">Practicar</button>
          </div>
        </div>
        <div class="review-panel">
          <div><h2>Repasar errores</h2><p class="small-muted">${hasErrors ? 'Practica las preguntas falladas o dejadas en blanco. Saldrán de este repaso al acertarlas en dos sesiones distintas.' : 'Las preguntas falladas o dejadas en blanco aparecerán aquí para repasarlas.'}</p></div>
          <button class="btn btn-outline" data-action="start-review" ${hasErrors ? '' : 'disabled'}>Repasar errores</button>
        </div>
        ${progressResetNotice ? '<p class="progress-cleared" role="status">Progreso borrado. Puedes empezar de nuevo cuando quieras.</p>' : ''}
        <div class="progress-controls">
          <p class="bank-note">${bank.length} preguntas disponibles en 7 temas. El progreso se guarda solo en este dispositivo.</p>
          <button class="btn btn-reset" type="button" data-action="reset-progress">Borrar progreso</button>
        </div>
      </section>`;
  }

  function renderStudyIndex() {
    cleanTimer();
    app.innerHTML = `<section class="study" aria-label="Temario de estudio">
      <div class="study-top"><button class="btn btn-subtle" data-action="home">← Volver al inicio</button><span>Temario de estudio</span></div>
      <h2 class="study-heading">Estudiar temario</h2>
      <p class="study-lead">Siete temas explicados con palabras sencillas. Puedes leer cada apartado y practicar sus preguntas con corrección inmediata.</p>
      <div class="study-topic-list">
        ${Object.entries(TOPIC_NAMES).map(([number, name]) => {
          const topic = studyTopic(number);
          return topic ? `<button class="study-topic-card available" data-action="study-topic" data-topic="${number}"><span><b>Tema ${number} · ${escapeHtml(name)}</b><small>${topic.secciones.length} apartados · ${topic.preguntas_totales} preguntas</small></span><span class="study-chevron">Leer →</span></button>`
            : `<div class="study-topic-card unavailable"><span><b>Tema ${number} · ${escapeHtml(name)}</b><small>No disponible</small></span></div>`;
        }).join('')}
      </div>
      <p class="study-disclaimer">Material de estudio basado en los cuestionarios facilitados. Las notas indican cuándo alguna regla o cifra puede estar desactualizada.</p>
    </section>`;
    window.scrollTo({top:0,behavior:'instant'});
  }

  function renderStudyTopic(topicNumber, jumpTo = '') {
    cleanTimer();
    const topic = studyTopic(topicNumber);
    if (!topic) return renderStudyIndex();
    const roman = ['','I','II','III','IV','V','VI','VII'][topic.numero] || topic.numero;
    const labels = topic.secciones.map((section, i) => `<a href="#${escapeHtml(section.id)}">${i + 1}. ${escapeHtml(section.titulo)}</a>`).join('');
    app.innerHTML = `<section class="study" aria-label="Tema ${roman}">
      <div class="study-top"><button class="btn btn-subtle" data-action="study-index">← Todos los temas</button><span>Tema ${roman} · ${topic.preguntas_totales} preguntas</span></div>
      <h2 class="study-heading">${escapeHtml(topic.titulo)}</h2>
      <p class="study-lead">${topic.secciones.length} apartados para estudiar las ${topic.preguntas_totales} preguntas de este tema. Después de cada apartado puedes practicar sus preguntas con corrección inmediata.</p>
      <nav class="study-outline" aria-label="Apartados del Tema ${roman}"><b>Contenido</b>${labels}</nav>
      ${topic.secciones.map((section,i) => `<article id="${escapeHtml(section.id)}" class="study-chapter">
        <div class="study-chapter-label">Apartado ${i + 1} de ${topic.secciones.length}</div>
        <h3>${escapeHtml(section.titulo)}</h3>
        <p class="study-intro">${formatStudyText(section.intro)}</p>
        <div class="study-points">${section.puntos.map(item=>`<p>${formatStudyText(item)}</p>`).join('')}</div>
        <div class="study-memory"><strong>Para recordar</strong><p>${formatStudyText(section.clave)}</p></div>
        ${section.nota ? `<div class="study-note"><strong>Aclaración</strong><p>${formatStudyText(section.nota)}</p></div>` : ''}
        <div class="study-chapter-actions"><span>Preguntas ${section.preguntas.join(', ')} del Tema ${roman}</span>
          <button class="btn btn-outline" data-action="start-study" data-section="${escapeHtml(section.id)}">Practicar ${section.preguntas.length} preguntas</button></div>
      </article>`).join('')}
      <div class="study-sources"><h3>Fuentes</h3>${studyGuide.fuentes.map(source => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.nombre)} ↗</a>`).join('')}<p>El temario no sustituye las instrucciones oficiales ni la formación práctica.</p></div>
      <button class="btn btn-subtle" data-action="study-index">← Todos los temas</button>
    </section>`;
    if (jumpTo) document.getElementById(jumpTo)?.scrollIntoView({block:'start',behavior:'instant'});
    else window.scrollTo({top:0,behavior:'instant'});
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
    // En ejercicios de aprendizaje se corrige al responder y se bloquea la elección.
    // En simulacros no se muestra la solución hasta terminar.
    const immediateFeedback = session.mode !== 'exam';
    const hasReplied = selected !== null;
    const answered = session.answers.filter(a => a !== null).length;
    const total = questions.length;
    const lastQuestion = idx === total - 1;
    const label = session.mode === 'exam' ? 'Simulacro de examen'
      : session.mode === 'exam-practice' ? 'Practicar examen'
      : session.mode === 'review' ? 'Repaso de errores'
      : session.mode === 'study' ? `Estudio · ${findStudySection(session.topic)?.titulo || 'Temario'}`
      : `Práctica · Tema ${session.topic}`;
    app.innerHTML = `
      <section class="exam">
        <div class="exam-toolbar">
          <div><div class="exam-title">${escapeHtml(label)}</div><div class="exam-subtitle">${answered} de ${total} respondidas</div></div>
          ${session.deadline ? `<div class="timer" role="timer" aria-label="Tiempo restante"><span class="circle" aria-hidden="true"></span><span id="time-left">${timerText()}</span></div>` : '<div class="timer">Sin límite de tiempo</div>'}
        </div>
        <div class="progress-strip" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${answered}" aria-label="Preguntas respondidas"><div style="width:${answered / total * 100}%"></div></div>
        <article class="question-card">
          <div class="q-overline"><span class="q-badge">Pregunta ${idx + 1} de ${total}</span><span>Tema ${question.tema} · ${escapeHtml(TOPIC_NAMES[question.tema])}</span></div>
          <h2 class="q-title">${escapeHtml(question.pregunta)}</h2>
          <div class="options" role="group" aria-label="Selecciona una respuesta">
            ${question.opciones.map((text, i) => {
              const state = immediateFeedback && hasReplied
                ? i === question.correcta ? 'is-correct' : i === selected ? 'is-wrong' : ''
                : selected === i ? 'selected' : '';
              return `<button class="option ${state}" type="button" data-action="choose" data-choice="${i}" aria-pressed="${selected === i}" ${immediateFeedback && hasReplied ? 'disabled' : ''}>
                <span class="option-key" aria-hidden="true">${letter(i)}</span>
                <span class="option-text">${escapeHtml(text)}</span>
              </button>`;
            }).join('')}
          </div>
          ${immediateFeedback && hasReplied ? `<p class="answer-feedback ${selected === question.correcta ? 'is-correct' : 'is-wrong'}" role="status">${selected === question.correcta ? 'Correcta.' : `Incorrecta. La respuesta correcta es la ${letter(question.correcta)}.`}</p>` : ''}
        </article>
        <nav class="bottom-nav" aria-label="Navegación por preguntas">
          <button class="btn btn-outline" data-action="previous" ${idx === 0 ? 'disabled' : ''}>← Anterior</button>
          <div class="nav-center" aria-label="Ir a pregunta">
            ${questions.map((_, i) => `<button class="dot ${i === idx ? 'current' : ''} ${session.answers[i] !== null ? 'answered' : ''}" data-action="goto" data-index="${i}" aria-label="Pregunta ${i + 1}${session.answers[i] === null ? ' sin responder' : ' respondida'}" ${i === idx ? 'aria-current="step"' : ''}></button>`).join('')}
          </div>
          <button class="btn ${lastQuestion ? 'btn-primary' : 'btn-outline'}" data-action="${lastQuestion ? 'finish' : 'next'}">${lastQuestion ? session.mode === 'review' ? 'Terminar repaso' : session.mode === 'exam' ? 'Terminar examen' : 'Terminar práctica' : 'Siguiente →'}</button>
        </nav>
        <p class="nav-bottom-text">${session.mode === 'exam' ? 'Puedes cambiar tus respuestas antes de terminar. Las soluciones aparecerán al final.' : 'Al elegir una opción verás la corrección inmediatamente. Después no podrás cambiarla.'} ${!lastQuestion ? '<button class="inline-finish" data-action="finish">Finalizar ahora</button>' : ''}</p>
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
    const isReview = session.mode === 'review';
    const isStudy = session.mode === 'study';
    const isPracticeExam = session.mode === 'exam-practice';
    const isTopicPractice = session.mode === 'practice';
    const isLearning = session.mode !== 'exam';
    const title = isReview ? 'Repaso terminado' : isLearning ? 'Práctica terminada' : examPassed ? 'Aprobado' : 'No aprobado';
    const subtitle = isReview ? 'Las preguntas que falles seguirán pendientes. Las acertadas salen del repaso después de dos sesiones distintas con acierto.'
      : isStudy ? 'Has terminado las preguntas de este apartado. Revisa las respuestas y vuelve al temario cuando quieras.'
      : isPracticeExam ? 'Has completado una práctica de examen con corrección inmediata. Puedes revisar todas las respuestas.'
      : isTopicPractice ? 'Has terminado las preguntas de este tema. Puedes revisar tus aciertos y errores.'
      : session.reason === 'time' ? 'Tiempo agotado. Se han corregido las respuestas registradas.'
      : examPassed ? 'Has alcanzado el mínimo de 16 aciertos.' : 'No has alcanzado el mínimo de 16 aciertos.';
    const mistakes = questions.map((q, idx) => ({ q, idx })).filter(({q,idx}) => session.answers[idx] !== q.correcta);
    const shown = reviewFilter === 'errors' ? mistakes : questions.map((q, idx) => ({q,idx}));
    app.innerHTML = `
      <section class="results">
        <div class="result-hero">
          <div>
            <p class="result-label">${isReview ? 'Resultado del repaso' : isStudy ? 'Práctica del temario' : isPracticeExam ? 'Práctica de examen' : session.mode === 'exam' ? 'Resultado del simulacro' : 'Resultado de la práctica'}</p>
            <h2>${title}</h2>
            <p class="small-muted">${subtitle}</p>
            <div class="result-counts" style="margin-top:20px"><span><b>${score.right}</b> correctas</span><span><b>${score.wrong}</b> incorrectas</span><span><b>${score.unanswered}</b> en blanco</span></div>
          </div>
          <div class="result-score ${!isLearning && !examPassed ? 'fail' : ''}" aria-label="${score.right} aciertos de ${questions.length}"><strong>${score.right}</strong><small>de ${questions.length}</small></div>
        </div>
        <div class="result-actions">
          ${isStudy ? '<button class="btn btn-primary" data-action="study-topic">Volver al apartado</button>'
            : isPracticeExam ? '<button class="btn btn-primary" data-action="start-exam-practice">Otra práctica de examen</button>'
            : isTopicPractice ? '<button class="btn btn-primary" data-action="repeat-topic">Practicar este tema</button>'
            : isReview ? ''
            : '<button class="btn btn-primary" data-action="start-exam">Otro simulacro</button>'}
          ${errorIds().length ? '<button class="btn btn-outline" data-action="start-review">Repasar errores</button>' : ''}
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
      case 'start-exam-practice': startSession('exam-practice'); break;
      case 'start-practice': startSession('practice', Number(document.getElementById('topic').value)); break;
      case 'repeat-topic': startSession('practice', session.topic); break;
      case 'start-review': startSession('review'); break;
      case 'study-index': renderStudyIndex(); break;
      case 'study-topic': {
        if (button.dataset.topic) renderStudyTopic(Number(button.dataset.topic));
        else if (session?.mode === 'study') {
          const section = findStudySection(session.topic);
          if (section) renderStudyTopic(section.tema, section.id);
          else renderStudyIndex();
        } else renderStudyIndex();
        break;
      }
      case 'start-study': startSession('study', button.dataset.section); break;
      case 'resume': renderQuestion(); break;
      case 'choose': {
        if (!session || session.finished) break;
        if (session.mode !== 'exam' && session.answers[session.current] !== null) break;
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
        session.current = Math.max(0, Math.min(session.ids.length-1, session.current));
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
      case 'reset-progress': resetProgress(); break;
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
      try {
        const guideResponse = await fetch('./temario.json');
        if (guideResponse.ok) {
          const guide = await guideResponse.json();
          if (Array.isArray(guide?.temas) && guide.temas.some(t => Array.isArray(t.secciones))) studyGuide = guide;
        }
      } catch (error) { console.info('Temario no disponible', error); }
      const saved = readStorage(STORAGE_SESSION, null);
      if (saved && Array.isArray(saved.ids) && saved.ids.length >= 1 && saved.ids.length <= EXAM_LENGTH && saved.ids.every(id => bankById.has(id)) && Array.isArray(saved.answers) && saved.answers.length === saved.ids.length) {
        session = saved;
        if (session.finished) { recordFinishedSession(); renderResults(); }
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
