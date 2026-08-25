(() => {
  const panel = document.getElementById('bookingPanel');
  const loader = document.getElementById('bookingLoader');

  const state = {
    step: 1,
    locked: false,
    services: [],
    serviceId: null,
    date: '',
    slot: null,
    attendanceType: null,
    patient: null,
  };

  const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const OFFICE_ADDRESS = 'R. Dr. Aureliano Barreiros, 641 — Itaquera, São Paulo — SP, 08210-450';

  async function api(path, options = {}) {
    const res = await fetch(`/api/public${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Erro na requisição');
      err.code = data.code;
      err.suggestions = data.suggestions || [];
      err.payload = data;
      throw err;
    }
    return data;
  }

  function formatDateBR(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function minDate() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function attendanceLabel(type) {
    return type === 'online' ? 'Online' : 'Presencial';
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(email || '').trim());
  }

  function isValidPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) return true;
    return digits.length === 10 || digits.length === 11;
  }

  function renderSteps() {
    const labels = ['Serviço', 'Data', 'Horário', 'Dados', 'Confirmar'];
    return `<div class="booking__steps">${labels.map((l, i) => {
      const n = i + 1;
      const cls = n === state.step ? 'active' : n < state.step ? 'done' : '';
      return `<div class="booking__step ${cls}">${n}. ${l}</div>`;
    }).join('')}</div>`;
  }

  function renderLocked() {
    panel.innerHTML = `
      <div class="booking__locked">
        <div class="booking__locked-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h3>Agenda temporariamente fechada</h3>
        <p>No momento não há horários disponíveis. Entre na lista de espera e avisaremos quando abrirmos novas vagas.</p>
      </div>
      ${renderWaitingListForm()}
    `;
    bindWaitingListForm();
  }

  function renderWaitingListForm() {
    return `
      <form id="waitingListForm">
        <div class="booking__field">
          <label class="booking__label" for="wl-name">Nome completo *</label>
          <input type="text" id="wl-name" required placeholder="Seu nome">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="wl-phone">Telefone / WhatsApp *</label>
          <input type="tel" id="wl-phone" required placeholder="(11) 99999-9999">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="wl-email">E-mail</label>
          <input type="email" id="wl-email" placeholder="seu@email.com">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="wl-day">Dia preferido</label>
          <select id="wl-day">
            <option value="">Qualquer dia</option>
            ${DAY_NAMES.map((d) => `<option value="${d}">${d}-feira</option>`).join('')}
          </select>
        </div>
        <div class="booking__field">
          <label class="booking__label" for="wl-time">Horário preferido</label>
          <select id="wl-time">
            <option value="">Qualquer horário</option>
            <option value="manhã">Manhã (8h–12h)</option>
            <option value="tarde">Tarde (12h–18h)</option>
            <option value="noite">Noite (18h–20h)</option>
          </select>
        </div>
        <div class="booking__field">
          <label class="booking__label" for="wl-note">Observação (opcional)</label>
          <textarea id="wl-note" rows="3" placeholder="Alguma preferência ou informação adicional"></textarea>
        </div>
        <button type="submit" class="btn btn--primary btn--full">Entrar na lista de espera</button>
        <p class="booking__message" id="wlFeedback" role="status"></p>
      </form>
    `;
  }

  function bindWaitingListForm() {
    const form = document.getElementById('waitingListForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fb = document.getElementById('wlFeedback');
      fb.className = 'booking__message';
      try {
        const data = await api('/waiting-list', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('wl-name').value,
            phone: document.getElementById('wl-phone').value,
            email: document.getElementById('wl-email').value,
            preferred_day: document.getElementById('wl-day').value,
            preferred_time: document.getElementById('wl-time').value,
            note: document.getElementById('wl-note').value,
          }),
        });
        fb.textContent = data.message;
        fb.classList.add('success');
        form.reset();
      } catch (err) {
        fb.textContent = err.message;
        fb.classList.add('error');
      }
    });
  }

  function renderStep1() {
    panel.innerHTML = `
      ${renderSteps()}
      <label class="booking__label">Selecione o serviço</label>
      <div class="booking__services">
        ${state.services.map((s) => `
          <button type="button" class="booking__service ${state.serviceId === s.id ? 'selected' : ''}" data-id="${s.id}">
            <div>
              <strong>${s.name}</strong>
              <span>${s.duration_minutes || 50} min</span>
            </div>
          </button>
        `).join('')}
      </div>
      <div class="booking__actions">
        <button type="button" class="btn btn--primary" id="btnNext1" ${!state.serviceId ? 'disabled' : ''}>Continuar</button>
      </div>
    `;

    panel.querySelectorAll('.booking__service').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.serviceId = Number(btn.dataset.id);
        renderStep1();
      });
    });
    document.getElementById('btnNext1')?.addEventListener('click', () => {
      state.step = 2;
      render();
    });
  }

  function renderStep2() {
    panel.innerHTML = `
      ${renderSteps()}
      <label class="booking__label" for="bookDate">Escolha a data</label>
      <input type="date" id="bookDate" class="booking__date-input" min="${minDate()}" value="${state.date}">
      <div class="booking__actions">
        <button type="button" class="btn btn--outline" id="btnBack2">Voltar</button>
        <button type="button" class="btn btn--primary" id="btnNext2">Continuar</button>
      </div>
    `;

    document.getElementById('bookDate').addEventListener('change', (e) => {
      state.date = e.target.value;
      state.slot = null;
    });
    document.getElementById('btnBack2').addEventListener('click', () => { state.step = 1; render(); });
    document.getElementById('btnNext2').addEventListener('click', () => {
      state.date = document.getElementById('bookDate').value;
      if (!state.date) return alert('Selecione uma data.');
      state.step = 3;
      render();
    });
  }

  async function renderStep3() {
    panel.innerHTML = `${renderSteps()}<div class="booking__loader">Buscando horários...</div>`;

    try {
      const { locked, slots } = await api(`/slots?date=${state.date}`);
      if (locked) {
        state.locked = true;
        renderLocked();
        return;
      }

      if (!slots.length) {
        panel.innerHTML = `
          ${renderSteps()}
          <div class="booking__empty">Nenhum horário disponível nesta data. Tente outro dia.</div>
          <div class="booking__actions">
            <button type="button" class="btn btn--outline" id="btnBack3">Voltar</button>
          </div>
        `;
        document.getElementById('btnBack3').addEventListener('click', () => { state.step = 2; render(); });
        return;
      }

      panel.innerHTML = `
        ${renderSteps()}
        <label class="booking__label">Horários disponíveis — ${formatDateBR(state.date)}</label>
        <div class="booking__slots">
          ${slots.map((s) => `
            <button type="button" class="booking__slot ${state.slot === s.start_time ? 'selected' : ''}" data-time="${s.start_time}">
              ${s.start_time}
            </button>
          `).join('')}
        </div>
        <div class="booking__actions">
          <button type="button" class="btn btn--outline" id="btnBack3">Voltar</button>
          <button type="button" class="btn btn--primary" id="btnNext3" ${!state.slot ? 'disabled' : ''}>Continuar</button>
        </div>
      `;

      panel.querySelectorAll('.booking__slot').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.slot = btn.dataset.time;
          renderStep3();
        });
      });
      document.getElementById('btnBack3').addEventListener('click', () => { state.step = 2; render(); });
      document.getElementById('btnNext3')?.addEventListener('click', () => {
        state.step = 4;
        render();
      });
    } catch (err) {
      panel.innerHTML = `${renderSteps()}<div class="booking__message error">${err.message}</div>`;
    }
  }

  function renderStep4() {
    const service = state.services.find((s) => s.id === state.serviceId);
    const patient = state.patient || {};
    panel.innerHTML = `
      ${renderSteps()}
      <div class="booking__summary">
        <strong>${service?.name || 'Consulta'}</strong><br>
        ${formatDateBR(state.date)} às ${state.slot}
      </div>
      <form id="patientForm" novalidate>
        <fieldset class="booking__fieldset">
          <legend class="booking__label">Tipo de atendimento *</legend>
          <div class="booking__attendance" role="radiogroup" aria-label="Tipo de atendimento">
            <label class="booking__attendance-option">
              <input type="radio" name="attendance_type" value="presencial" ${state.attendanceType === 'presencial' ? 'checked' : ''} required>
              <span>
                <strong>Presencial</strong>
                <small>No consultório em Itaquera</small>
              </span>
            </label>
            <label class="booking__attendance-option">
              <input type="radio" name="attendance_type" value="online" ${state.attendanceType === 'online' ? 'checked' : ''}>
              <span>
                <strong>Online</strong>
                <small>Por videochamada</small>
              </span>
            </label>
          </div>
        </fieldset>
        <div class="booking__field">
          <label class="booking__label" for="p-name">Nome completo *</label>
          <input type="text" id="p-name" required placeholder="Seu nome" value="${escapeHtml(patient.name || '')}">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="p-phone">Telefone / WhatsApp *</label>
          <input type="tel" id="p-phone" required placeholder="(11) 99999-9999" value="${escapeHtml(patient.phone || '')}">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="p-email">E-mail *</label>
          <input type="email" id="p-email" required placeholder="seu@email.com" value="${escapeHtml(patient.email || '')}">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="p-notes">Observações (opcional)</label>
          <textarea id="p-notes" rows="2" placeholder="Alguma informação útil para o consultório">${escapeHtml(patient.notes || '')}</textarea>
        </div>
        <p class="booking__message" id="patientFeedback" role="status"></p>
        <div class="booking__actions">
          <button type="button" class="btn btn--outline" id="btnBack4">Voltar</button>
          <button type="submit" class="btn btn--primary">Revisar agendamento</button>
        </div>
      </form>
    `;

    document.getElementById('btnBack4').addEventListener('click', () => { state.step = 3; render(); });
    document.getElementById('patientForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fb = document.getElementById('patientFeedback');
      fb.className = 'booking__message';

      const attendance = document.querySelector('input[name="attendance_type"]:checked')?.value;
      const name = document.getElementById('p-name').value.trim();
      const phone = document.getElementById('p-phone').value.trim();
      const email = document.getElementById('p-email').value.trim();
      const notes = document.getElementById('p-notes').value.trim();

      if (!attendance) {
        fb.textContent = 'Selecione o tipo de atendimento.';
        fb.classList.add('error');
        return;
      }
      if (!name) {
        fb.textContent = 'Informe seu nome completo.';
        fb.classList.add('error');
        return;
      }
      if (!isValidPhone(phone)) {
        fb.textContent = 'Informe um telefone/WhatsApp válido com DDD.';
        fb.classList.add('error');
        return;
      }
      if (!isValidEmail(email)) {
        fb.textContent = 'Informe um e-mail válido.';
        fb.classList.add('error');
        return;
      }

      state.attendanceType = attendance;
      state.patient = { name, phone, email, notes };
      state.step = 5;
      render();
    });
  }

  function renderStep5() {
    const service = state.services.find((s) => s.id === state.serviceId);
    const locationLine = state.attendanceType === 'online'
      ? 'Local: Online (link enviado na confirmação)'
      : `Local: ${OFFICE_ADDRESS}`;

    panel.innerHTML = `
      ${renderSteps()}
      <div class="booking__summary">
        <strong>Confirme seus dados</strong><br><br>
        Serviço: ${escapeHtml(service?.name || '')}<br>
        Tipo: ${attendanceLabel(state.attendanceType)}<br>
        Data: ${formatDateBR(state.date)}<br>
        Horário: ${escapeHtml(state.slot)}<br>
        Nome: ${escapeHtml(state.patient.name)}<br>
        Telefone: ${escapeHtml(state.patient.phone)}<br>
        E-mail: ${escapeHtml(state.patient.email)}<br>
        ${escapeHtml(locationLine)}
      </div>
      <div class="booking__actions">
        <button type="button" class="btn btn--outline" id="btnBack5">Voltar</button>
        <button type="button" class="btn btn--primary" id="btnConfirm">Confirmar agendamento</button>
      </div>
      <p class="booking__message" id="bookFeedback" role="status" aria-live="polite"></p>
    `;

    document.getElementById('btnBack5').addEventListener('click', () => { state.step = 4; render(); });
    document.getElementById('btnConfirm').addEventListener('click', confirmBooking);
  }

  function renderSuccess(data) {
    const service = state.services.find((s) => s.id === state.serviceId);
    const n = data.notifications || {};
    const emailSent = Boolean(n.email?.sent);
    const mobileSent = Boolean(n.mobile?.sent);
    const partial = Boolean(n.partialFailure);
    const reference = data.appointment?.reference_code || '';

    let notifyHtml = '';
    if (!partial && (emailSent || mobileSent)) {
      notifyHtml = `
        <ul class="booking__success-channels">
          <li>${emailSent ? '✓' : '–'} Confirmação por e-mail ${emailSent ? 'enviada' : 'não enviada'}</li>
          <li>${mobileSent ? '✓' : '–'} Confirmação por celular ${mobileSent ? 'enviada' : 'não enviada'}${n.mobile?.channel && mobileSent ? ` (${n.mobile.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'})` : ''}</li>
        </ul>
      `;
    } else if (partial) {
      notifyHtml = `
        <p class="booking__success-note">
          Houve um problema ao enviar a confirmação automática.
          Sua consulta <strong>está registrada</strong>. Se precisar, fale conosco pelo WhatsApp
          <a href="https://wa.me/5511992789380" target="_blank" rel="noopener noreferrer">(11) 99278-9380</a>.
        </p>
        <ul class="booking__success-channels">
          <li>${emailSent ? '✓ E-mail enviado' : '✗ E-mail não enviado'}</li>
          <li>${mobileSent ? '✓ Celular enviado' : '✗ Celular não enviado'}</li>
        </ul>
      `;
    } else {
      notifyHtml = `
        <ul class="booking__success-channels">
          <li>– Confirmação por e-mail não enviada automaticamente</li>
          <li>– Confirmação por celular não enviada automaticamente</li>
        </ul>
      `;
    }

    panel.innerHTML = `
      <div class="booking__success" role="status" aria-live="polite">
        <div class="booking__success-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 12.5l2.5 2.5L16 9"/>
          </svg>
        </div>
        <h3>Agendamento registrado!</h3>
        <p>${escapeHtml(data.message)}</p>
        ${reference ? `<div class="booking__reference" title="Guarde este código">Ref. ${escapeHtml(reference)}</div>` : ''}
        <div class="booking__summary">
          <strong>${escapeHtml(service?.name || 'Consulta')}</strong><br>
          ${attendanceLabel(state.attendanceType)} · ${formatDateBR(state.date)} às ${escapeHtml(state.slot)}<br>
          ${escapeHtml(state.patient.name)}
        </div>
        ${notifyHtml}
        <a href="#contato" class="btn btn--outline btn--full">Falar com o consultório</a>
      </div>
    `;
  }

  function renderConflict(err) {
    const suggestions = err.suggestions || [];
    panel.innerHTML = `
      ${renderSteps()}
      <div class="booking__message error" role="alert">${escapeHtml(err.message)}</div>
      ${suggestions.length ? `
        <div class="booking__suggestions">
          <h4>Próximos horários disponíveis</h4>
          <div class="booking__suggestions-list">
            ${suggestions.map((s) => `
              <button type="button" class="booking__suggestion"
                data-date="${escapeHtml(s.date)}" data-time="${escapeHtml(s.start_time)}">
                ${formatDateBR(s.date)} · ${escapeHtml(s.start_time)}
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}
      <div class="booking__actions">
        <button type="button" class="btn btn--outline" id="btnBackConflict">Escolher outro horário</button>
      </div>
    `;

    document.getElementById('btnBackConflict').addEventListener('click', () => {
      state.step = 3;
      render();
    });

    panel.querySelectorAll('.booking__suggestion').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.date = btn.dataset.date;
        state.slot = btn.dataset.time;
        state.step = 5;
        render();
      });
    });
  }

  async function confirmBooking() {
    const fb = document.getElementById('bookFeedback');
    const btn = document.getElementById('btnConfirm');
    btn.disabled = true;
    fb.className = 'booking__message';
    fb.textContent = 'Registrando sua consulta...';

    try {
      const payload = {
        service_id: state.serviceId,
        date: state.date,
        start_time: state.slot,
        patient_name: state.patient.name,
        patient_phone: state.patient.phone,
        patient_email: state.patient.email,
        attendance_type: state.attendanceType,
      };
      if (state.patient.notes) payload.notes = state.patient.notes;

      const data = await api('/appointments', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      renderSuccess(data);
    } catch (err) {
      if (err.code === 'SLOT_TAKEN' || err.code === 'SLOT_UNAVAILABLE' || (err.suggestions && err.suggestions.length)) {
        renderConflict(err);
        return;
      }
      fb.textContent = err.message;
      fb.classList.add('error');
      btn.disabled = false;
      if (err.message.includes('indisponível') || err.message.includes('reservado')) {
        setTimeout(() => { state.step = 3; render(); }, 2000);
      }
    }
  }

  function render() {
    if (state.locked) return renderLocked();
    switch (state.step) {
      case 1: renderStep1(); break;
      case 2: renderStep2(); break;
      case 3: renderStep3(); break;
      case 4: renderStep4(); break;
      case 5: renderStep5(); break;
      default: renderStep1();
    }
  }

  async function init() {
    try {
      const [settings, services] = await Promise.all([
        api('/settings'),
        api('/services'),
      ]);
      state.locked = settings.schedule_locked;
      state.services = services;
      if (state.services.length === 1) state.serviceId = state.services[0].id;
      loader?.remove();
      if (state.locked) renderLocked();
      else render();
    } catch {
      const isLocalFile = window.location.protocol === 'file:';
      const wrongPort = window.location.port && window.location.port !== '3000';
      loader.innerHTML = `
        <div class="booking__offline">
          <p><strong>Não foi possível carregar a agenda.</strong></p>
          ${isLocalFile || wrongPort ? `
            <p>O agendamento online só funciona com o <strong>servidor ativo</strong>, não pelo Live Server.</p>
            <ol>
              <li>Dê duplo clique em <strong>iniciar.bat</strong> na pasta do projeto</li>
              <li>Deixe a janela aberta</li>
              <li>Acesse <a href="http://localhost:3000/#agendar">http://localhost:3000/#agendar</a></li>
            </ol>
          ` : `
            <p>Verifique se o <strong>iniciar.bat</strong> está rodando e recarregue a página.</p>
            <p><a href="http://localhost:3000/#agendar">http://localhost:3000/#agendar</a></p>
          `}
        </div>
      `;
    }
  }

  init();
})();
